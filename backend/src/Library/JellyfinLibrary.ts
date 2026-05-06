import { Readable } from 'node:stream';
import type { Request, Response } from 'express';
import type { Repository } from 'typeorm';
import type { TrackMetadata } from '@headbangbear/schemas';
import { AudioAnalyzer } from '../Analysis/AudioAnalyzer.js';
import { Camelot } from '../Analysis/Camelot.js';
import { OpenKey } from '../Analysis/OpenKey.js';
import type { AnalysisResult } from '../Analysis/schemas.js';
import { AudioCache } from '../Audio/AudioCache.js';
import { AnalyzedTrackEntity } from '../Database/Entity/AnalyzedTrackEntity.js';
import { TrackMetadataEntity } from '../Database/Entity/TrackMetadataEntity.js';
import {
    JellyfinClient,
    type JellyfinAudioItem,
} from '../Provider/JellyfinClient.js';
import type { AnalyzedTrack } from './TrackLibrary.js';

/** Per-track progress event during `JellyfinLibrary.scan()`. `current` is 1-based;
 *  `total` is the full item count returned by the listing call (cached items count
 *  too, so the bar moves even when only a handful need re-analysis). `phase` is
 *  `'analyse'` for streaming pipeline runs, `'cache'` for DB-hit fast-path,
 *  `'error'` for a single-track failure. */
export interface ScanProgress {
    readonly current: number;
    readonly total: number;
    readonly name: string;
    readonly phase: 'analyse' | 'cache' | 'error';
    readonly detail?: string;
}

export type ProgressFn = (event: ScanProgress) => void;

/**
 * Jellyfin-backed equivalent of `TrackLibrary`. Lists audio items via the Jellyfin
 * API, runs every track that's missing from the DB through the configured
 * `AudioAnalyzer` *as a stream* (no temp files — bytes flow `Jellyfin → fetch →
 * ffmpeg stdin → essentia → result`), upserts the analysis into the DB
 * per-track, and exposes `serveAudio` / `serveCover` proxies that pipe Jellyfin's
 * responses straight to the browser.
 *
 * Cache freshness is keyed by `(mtime, size)`:
 *   - `mtime` = `Item.DateModified` parsed to ms-since-epoch
 *   - `size`  = `Item.MediaSources[0].Size` in bytes
 * If either differs from the stored entity, the track is re-analysed.
 *
 * `sourceId` in the DB is the Jellyfin item-UUID (stable across server restarts).
 */
export class JellyfinLibrary {

    /** Rolling-window size for in-flight audio downloads. The scan loop keeps the
     *  next N items pre-fetched into the audio cache while the worker analyses the
     *  current one — saturating CPU and network in parallel without letting the
     *  cache grow past N+1 tracks (the analysed one + the look-ahead set). */
    private static readonly PREFETCH_AHEAD: number = 5;

    private readonly providerId: string;

    private readonly client: JellyfinClient;

    private readonly analyzer: AudioAnalyzer;

    private readonly repo: Repository<AnalyzedTrackEntity>;

    private readonly metaRepo: Repository<TrackMetadataEntity>;

    private readonly audioCache: AudioCache | null;

    private readonly onProgress: ProgressFn | undefined;

    /** Lower-cased exclude substrings; an item is dropped if any of these appears
     *  in its name/artist/album/genre. Empty array = keep everything. */
    private readonly excludePatterns: readonly string[];

    private readonly tracksByPath: Map<string, AnalyzedTrack> = new Map();

    public constructor(
        providerId: string,
        client: JellyfinClient,
        analyzer: AudioAnalyzer,
        repo: Repository<AnalyzedTrackEntity>,
        metaRepo: Repository<TrackMetadataEntity>,
        audioCache: AudioCache | null,
        excludePatterns: readonly string[] = [],
        onProgress?: ProgressFn,
    ) {
        this.providerId = providerId;
        this.client = client;
        this.analyzer = analyzer;
        this.repo = repo;
        this.metaRepo = metaRepo;
        this.audioCache = audioCache;
        this.excludePatterns = excludePatterns
            .map((p: string): string => p.trim().toLowerCase())
            .filter((p: string): boolean => p.length > 0);
        this.onProgress = onProgress;
    }

    public getProviderId(): string {
        return this.providerId;
    }

    /**
     * Single-pass scan + analysis. Items that fail to analyse (network blip,
     * ffmpeg crash on a single track) are logged via `onProgress` but skipped —
     * one bad track doesn't abort the whole scan.
     */
    /**
     * Hydrate the in-memory `tracksByPath` from the DB. Called by `LibraryService`
     * directly after binding the provider so `tracks()` returns the previously-
     * analysed set even before the (potentially slow) Jellyfin paging completes.
     * Idempotent — `scan()` calls it again at the top to re-sync after wipes.
     */
    public async loadFromDatabase(): Promise<void> {
        await this.loadAnalysisMaps();
    }

    public async scan(): Promise<AnalyzedTrack[]> {
        // DB-load comes FIRST — before the (slow, paginated) Jellyfin items list.
        // Without this ordering the Library / DJ-Set UIs see an empty list during
        // the seconds-to-minutes window while `listAudioItems()` paginates the
        // server, even though every track is in the local DB.
        const { existingAnalysis, existingMeta } = await this.loadAnalysisMaps();
        const allItems: JellyfinAudioItem[] = await this.client.listAudioItems();
        // Apply user-defined exclude patterns (audiobooks etc. that got dropped
        // into a Music library by mistake). Done client-side because Jellyfin's
        // API filters are a blunt instrument; substring matching across multiple
        // metadata fields is what users actually want.
        const items: JellyfinAudioItem[] = this.excludePatterns.length === 0
            ? allItems
            : allItems.filter((it: JellyfinAudioItem): boolean => !this.matchesExclude(it));
        const skippedCount: number = allItems.length - items.length;
        if (skippedCount > 0) {
            // eslint-disable-next-line no-console
            console.log(
                `[scan/${this.providerId}/jellyfin] excludePatterns dropped `
                + `${skippedCount.toString()} of ${allItems.length.toString()} items`,
            );
        }
        const seenIds: Set<string> = new Set();
        const total: number = items.length;

        // True iff the item needs a fresh download + analysis (i.e. DB cache miss).
        // Used by both the prefetch worker and the main loop to skip work that the
        // DB already covers.
        const needsAnalysis = (item: JellyfinAudioItem): boolean => {
            const prev: AnalyzedTrackEntity | undefined = existingAnalysis.get(item.id);
            if (prev === undefined) {
                return true;
            }
            const mtime: number = item.dateModifiedMs ?? 0;
            const size: number = item.sizeBytes ?? 0;
            return prev.mtime !== mtime || prev.size !== size;
        };

        // Prefetch one item into the audio cache. No-op when the cache is disabled,
        // when the item is a DB cache-hit (no analysis needed), or when the bytes
        // are already cached. Pinned during download so a stray `evictIfOverCapacity`
        // can't yank the half-written file.
        const prefetchOne = async (idx: number): Promise<void> => {
            const item: JellyfinAudioItem | undefined = items[idx];
            if (item === undefined) {
                return;
            }
            if (this.audioCache === null) {
                return;
            }
            if (!needsAnalysis(item)) {
                return;
            }
            if (await this.audioCache.has(this.providerId, item.id)) {
                return;
            }
            const unpin: () => void = this.audioCache.pin(this.providerId, item.id);
            try {
                const upstream: Response_ = (await this.client.openAudioStream(item.id)) as Response_;
                if (!upstream.ok || upstream.body === null) {
                    throw new Error(
                        `Jellyfin /Items/${item.id}/Download → ${upstream.status.toString()} ${upstream.statusText}`,
                    );
                }
                const ct: string | undefined = upstream.headers.get('content-type') ?? undefined;
                const stream: Readable = JellyfinLibrary.toNodeReadable(upstream.body);
                await this.audioCache.writeFromStream(this.providerId, item.id, stream, ct);
            } finally {
                unpin();
            }
        };

        // Map of items-index → in-flight prefetch promise. Errors are swallowed
        // here so awaiting the promise from the main loop doesn't reject — if
        // prefetch failed, the main loop calls `analyseItem` which retries the
        // download inline and surfaces the real error via the `error` phase.
        const prefetches: Map<number, Promise<void>> = new Map();
        const ensurePrefetch = (idx: number): void => {
            if (idx < 0 || idx >= items.length || prefetches.has(idx)) {
                return;
            }
            prefetches.set(idx, prefetchOne(idx).catch((): void => {
                // swallowed — main loop will surface the error if needed
            }));
        };

        // Seed the rolling window. With `PREFETCH_AHEAD = 5` and the current
        // analysis, the cache holds at most ~6 audio files at any moment — the
        // user-visible cache size stays small instead of growing unboundedly.
        for (let j = 0; j < Math.min(JellyfinLibrary.PREFETCH_AHEAD, items.length); j++) {
            ensurePrefetch(j);
        }

        for (let idx = 0; idx < items.length; idx++) {
            const item: JellyfinAudioItem = items[idx] as JellyfinAudioItem;
            const current: number = idx + 1;
            seenIds.add(item.id);
            const mtime: number = item.dateModifiedMs ?? 0;
            const size: number = item.sizeBytes ?? 0;
            const previous: AnalyzedTrackEntity | undefined = existingAnalysis.get(item.id);

            let result: AnalysisResult;
            if (
                previous !== undefined
                && previous.mtime === mtime
                && previous.size === size
            ) {
                result = JellyfinLibrary.deserialize(previous);
                this.onProgress?.({
                    current: current,
                    total: total,
                    name: item.name,
                    phase: 'cache',
                });
            } else {
                this.onProgress?.({
                    current: current,
                    total: total,
                    name: item.name,
                    phase: 'analyse',
                });
                // Wait for the prefetch — if it succeeded, `analyseItem` will hit
                // the cache without re-downloading; if it failed, `analyseItem`
                // does its own inline download as a fallback.
                const inflight: Promise<void> | undefined = prefetches.get(idx);
                if (inflight !== undefined) {
                    await inflight;
                }
                let analysed: AnalysisResult;
                try {
                    analysed = await this.analyseItem(item);
                } catch (err) {
                    this.onProgress?.({
                        current: current,
                        total: total,
                        name: item.name,
                        phase: 'error',
                        detail: err instanceof Error ? err.message : String(err),
                    });
                    // Drop any half-written cache entry from a failed analyse so the
                    // next attempt re-downloads cleanly.
                    if (this.audioCache !== null) {
                        await this.audioCache.delete(this.providerId, item.id);
                    }
                    prefetches.delete(idx);
                    ensurePrefetch(idx + JellyfinLibrary.PREFETCH_AHEAD);
                    continue;
                }
                result = analysed;
                const entity: AnalyzedTrackEntity = JellyfinLibrary.toEntity(
                    this.providerId,
                    item.id,
                    mtime,
                    size,
                    result,
                );
                await this.repo.upsert(entity, ['providerId', 'sourceId']);
                // DB now has the analysis — drop the audio bytes. Per-track delete
                // keeps the on-disk cache to a rolling window (currently-analysed
                // track + the prefetched ones) instead of accumulating.
                if (this.audioCache !== null) {
                    await this.audioCache.delete(this.providerId, item.id);
                }
            }

            // Top up the prefetch window so the next analyse() lands on a hot file.
            prefetches.delete(idx);
            ensurePrefetch(idx + JellyfinLibrary.PREFETCH_AHEAD);

            // Persist metadata (artist/title/album/year/genre/hasCover) on every iteration —
            // even for cache hits, because Jellyfin metadata is the source of truth and
            // could have been edited server-side without bumping `DateModified` (e.g. tag fix).
            const metaEntity: TrackMetadataEntity = JellyfinLibrary.metadataToEntity(
                this.providerId,
                item,
            );
            await this.metaRepo.upsert(metaEntity, ['providerId', 'sourceId']);
            existingMeta.set(item.id, metaEntity);

            const track: AnalyzedTrack = {
                providerId: this.providerId,
                path: item.id,
                result: result,
                hasCover: item.hasCover,
                disabled: existingAnalysis.get(item.id)?.disabled ?? false,
            };
            const metadata: TrackMetadata = JellyfinLibrary.metadataFromItem(item);
            if (Object.keys(metadata).length > 0) {
                track.metadata = metadata;
            }
            this.tracksByPath.set(track.path, track);
            // Per-iteration macrotask yield — `await this.repo.upsert()` only flushes
            // microtasks (better-sqlite3 is synchronous), so without this any HTTP
            // request that lands during the scan waits for the whole iteration's CPU
            // window to finish. `setImmediate` lets pending I/O run between tracks.
            await JellyfinLibrary.yieldEventLoop();
        }

        // Drain any prefetches that haven't been consumed (only happens if the loop
        // bailed early); the cache files they write are released by the safety-net
        // size-cap eviction or on next scan.
        await Promise.allSettled(prefetches.values());

        // Prune entities for items that disappeared from the Jellyfin server.
        for (const sid of existingAnalysis.keys()) {
            if (!seenIds.has(sid)) {
                await this.repo.delete({ providerId: this.providerId, sourceId: sid });
                await this.metaRepo.delete({ providerId: this.providerId, sourceId: sid });
            }
        }
        return Array.from(this.tracksByPath.values());
    }

    public tracks(): AnalyzedTrack[] {
        return Array.from(this.tracksByPath.values());
    }

    /**
     * Idempotent: ensures the audio bytes for `itemId` are present in the audio
     * cache, downloading from Jellyfin if not. Pinned during the download so a
     * concurrent eviction can't yank the half-written file. Used by the DJ-set
     * prefetch endpoint to warm the cache before playback starts.
     */
    public async prefetchAudio(itemId: string): Promise<void> {
        if (this.audioCache === null) {
            return;
        }
        if (await this.audioCache.has(this.providerId, itemId)) {
            return;
        }
        const unpin: () => void = this.audioCache.pin(this.providerId, itemId);
        try {
            const upstream: Response_ = (await this.client.openAudioStream(itemId)) as Response_;
            if (!upstream.ok || upstream.body === null) {
                throw new Error(
                    `Jellyfin /Items/${itemId}/Download → ${upstream.status.toString()} ${upstream.statusText}`,
                );
            }
            const ct: string | undefined = upstream.headers.get('content-type') ?? undefined;
            const stream: Readable = JellyfinLibrary.toNodeReadable(upstream.body);
            await this.audioCache.writeFromStream(this.providerId, itemId, stream, ct);
        } finally {
            unpin();
        }
    }

    public findByPath(path: string): AnalyzedTrack | null {
        return this.tracksByPath.get(path) ?? null;
    }

    /**
     * Camelot-compatible matches sorted by BPM proximity — same contract as
     * `TrackLibrary.compatible` so route handlers can stay storage-agnostic.
     */
    public compatible(track: AnalyzedTrack): AnalyzedTrack[] {
        const targetCodes: Set<string> = new Set(
            track.result.camelot.compatibleKeys().map((c: Camelot): string => c.toString()),
        );
        const targetBpm: number = track.result.bpm;
        return this.tracks()
            .filter(
                (t: AnalyzedTrack): boolean =>
                    !t.disabled
                    && t.path !== track.path
                    && targetCodes.has(t.result.camelot.toString()),
            )
            .sort(
                (a: AnalyzedTrack, b: AnalyzedTrack): number =>
                    Math.abs(a.result.bpm - targetBpm) - Math.abs(b.result.bpm - targetBpm),
            );
    }

    /**
     * Pipe Jellyfin's audio bytes through to the browser, forwarding the Range header
     * for seekable playback. Status code + Content-Type + Content-Length / Content-Range
     * are mirrored 1:1 from the upstream response.
     */
    public async serveAudio(itemId: string, req: Request, res: Response): Promise<void> {
        // Cache hit — local file, range-aware via Express's `sendFile`. Pin protects
        // the file from eviction for the lifetime of the response so a parallel
        // scanner hitting `evictIfOverCapacity` can't yank it mid-stream. The
        // explicit Content-Type is critical: cache files use a generic `.bin`
        // extension so without override Express sets `application/octet-stream`,
        // which `<audio>` refuses to play. The sidecar holds the original upstream
        // MIME (audio/mpeg, audio/flac, …); the fallback only kicks in for entries
        // written before sidecar persistence landed.
        if (this.audioCache !== null && await this.audioCache.has(this.providerId, itemId)) {
            const cachedPath: string = this.audioCache.pathFor(this.providerId, itemId);
            const contentType: string = (await this.audioCache.getContentType(this.providerId, itemId))
                ?? 'audio/mpeg';
            await this.audioCache.touch(cachedPath);
            const unpin: () => void = this.audioCache.pin(this.providerId, itemId);
            try {
                await new Promise<void>((resolveFn): void => {
                    res.sendFile(
                        cachedPath,
                        {
                            // `dotfiles: 'allow'` is non-negotiable — the cache lives
                            // under `<dataDir>/audio-cache/...` and `dataDir` is
                            // typically `./.hbb-data`, so the path contains a dotted
                            // segment. Without this Express 500's with a generic
                            // "Failed to stream cached audio".
                            dotfiles: 'allow',
                            headers: { 'Content-Type': contentType },
                        },
                        (err: Error | undefined): void => {
                            if (err !== undefined && !res.headersSent) {
                                res.status(500).send('Failed to stream cached audio');
                            }
                            resolveFn();
                        },
                    );
                });
            } finally {
                unpin();
            }
            return;
        }
        // Cache miss — proxy directly. We don't write-through here because a Range
        // request gets only partial bytes (can't seed a correct cache file). The
        // scanner is the canonical cache writer; first plays of a not-yet-analysed
        // track go straight through Jellyfin.
        const range: string | undefined = JellyfinLibrary.requestHeader(req, 'range');
        const upstream: Response_ = (await this.client.openAudioStream(itemId, range)) as Response_;
        JellyfinLibrary.relayResponse(upstream, res);
    }

    /** Pipe Jellyfin's cover bytes (Primary image) to the browser. No Range — covers
     *  are tiny and the browser fetches them in one shot. */
    public async serveCover(itemId: string, res: Response): Promise<void> {
        const upstream: Response_ = (await this.client.openCoverStream(itemId)) as Response_;
        JellyfinLibrary.relayResponse(upstream, res);
    }

    private async analyseItem(item: JellyfinAudioItem): Promise<AnalysisResult> {
        // Cacheless path — used by tests and any deployment that disables the cache.
        // Analyses straight from the upstream stream without ever touching disk.
        if (this.audioCache === null) {
            const upstream: Response_ = (await this.client.openAudioStream(item.id)) as Response_;
            if (!upstream.ok || upstream.body === null) {
                throw new Error(
                    `Jellyfin /Items/${item.id}/Download → ${upstream.status.toString()} ${upstream.statusText}`,
                );
            }
            const stream: Readable = JellyfinLibrary.toNodeReadable(upstream.body);
            return this.analyzer.analyze(stream);
        }
        // Cached path — pin across the whole download+analyze window so a concurrent
        // eviction can't drop the file between the write and the read. After analyze
        // completes, kick a best-effort eviction so a 7k-track scan doesn't blow past
        // the cache cap unbounded.
        const unpin: () => void = this.audioCache.pin(this.providerId, item.id);
        try {
            const cachedPath: string = this.audioCache.pathFor(this.providerId, item.id);
            if (!await this.audioCache.has(this.providerId, item.id)) {
                const upstream: Response_ = (await this.client.openAudioStream(item.id)) as Response_;
                if (!upstream.ok || upstream.body === null) {
                    throw new Error(
                        `Jellyfin /Items/${item.id}/Download → ${upstream.status.toString()} ${upstream.statusText}`,
                    );
                }
                // Preserve the upstream Content-Type so subsequent serve-from-cache
                // responses set the right MIME — without it the browser refuses
                // to play the bytes.
                const contentType: string | undefined = upstream.headers.get('content-type') ?? undefined;
                const stream: Readable = JellyfinLibrary.toNodeReadable(upstream.body);
                await this.audioCache.writeFromStream(this.providerId, item.id, stream, contentType);
            } else {
                // Already cached (maybe from a prior interrupted scan) — bump mtime so
                // LRU treats it as fresh, then analyse from the local file.
                await this.audioCache.touch(cachedPath);
            }
            const result: AnalysisResult = await this.analyzer.analyze(cachedPath);
            void this.audioCache.evictIfOverCapacity().catch((err: unknown): void => {
                // eslint-disable-next-line no-console
                console.warn('AudioCache eviction failed:', err);
            });
            return result;
        } finally {
            unpin();
        }
    }

    /** Mirror status code + Content-Type / Content-Length / Content-Range from Jellyfin
     *  to the client and pipe the body through. */
    private static relayResponse(upstream: Response_, downstream: Response): void {
        downstream.status(upstream.status);
        for (const header of ['content-type', 'content-length', 'content-range', 'accept-ranges'] as const) {
            const value: string | null = upstream.headers.get(header);
            if (value !== null) {
                downstream.setHeader(header, value);
            }
        }
        if (upstream.body === null) {
            downstream.end();
            return;
        }
        const node: Readable = JellyfinLibrary.toNodeReadable(upstream.body);
        node.pipe(downstream);
    }

    /** Bridge a web `ReadableStream` (from the global `fetch` Response) into a Node
     *  `Readable` so it composes with `pipe()` and `proc.stdin`. Available in Node 18+. */
    private static toNodeReadable(body: ReadableStream<Uint8Array>): Readable {
        return Readable.fromWeb(body as never);
    }

    private static requestHeader(req: Request, name: string): string | undefined {
        const value: string | string[] | undefined = req.headers[name];
        if (value === undefined) {
            return undefined;
        }
        return Array.isArray(value) ? value[0] : value;
    }

    /** See `EssentiaAudioAnalyzer.yieldEventLoop` — same pattern, kept local so each
     *  scan loop can yield without importing the analyzer. */
    private static yieldEventLoop(): Promise<void> {
        return new Promise<void>((resolve): void => {
            setImmediate(resolve);
        });
    }

    /** True iff any configured exclude pattern occurs (case-insensitive) in the
     *  item's name / artist / album / genre. The patterns are pre-lowercased in
     *  the constructor so the per-item work is just `.includes()`. */
    private matchesExclude(item: JellyfinAudioItem): boolean {
        const haystack: string = [
            item.name,
            item.artist ?? '',
            item.album ?? '',
            item.genre ?? '',
        ].join('\n').toLowerCase();
        for (const pattern of this.excludePatterns) {
            if (haystack.includes(pattern)) {
                return true;
            }
        }
        return false;
    }

    /** Load existing analysis + metadata rows for this provider into `tracksByPath`.
     *  Returns the maps so the scan loop can use them for `(mtime, size)` cache-
     *  freshness lookups without a second DB read. */
    private async loadAnalysisMaps(): Promise<{
        existingAnalysis: Map<string, AnalyzedTrackEntity>;
        existingMeta: Map<string, TrackMetadataEntity>;
    }> {
        const existingAnalysis: Map<string, AnalyzedTrackEntity> = new Map();
        for (const e of await this.repo.find({ where: { providerId: this.providerId } })) {
            existingAnalysis.set(e.sourceId, e);
        }
        const existingMeta: Map<string, TrackMetadataEntity> = new Map();
        for (const m of await this.metaRepo.find({ where: { providerId: this.providerId } })) {
            existingMeta.set(m.sourceId, m);
        }
        this.tracksByPath.clear();
        for (const [sid, entity] of existingAnalysis) {
            const cachedTrack: AnalyzedTrack = {
                providerId: this.providerId,
                path: sid,
                result: JellyfinLibrary.deserialize(entity),
                hasCover: existingMeta.get(sid)?.hasCover ?? false,
                disabled: entity.disabled,
            };
            const cachedMeta: TrackMetadataEntity | undefined = existingMeta.get(sid);
            if (cachedMeta !== undefined) {
                const meta: TrackMetadata = {};
                if (cachedMeta.artist !== null) {
                    meta.artist = cachedMeta.artist;
                }
                if (cachedMeta.title !== null) {
                    meta.title = cachedMeta.title;
                }
                if (cachedMeta.album !== null) {
                    meta.album = cachedMeta.album;
                }
                if (cachedMeta.year !== null) {
                    meta.year = cachedMeta.year;
                }
                if (cachedMeta.genre !== null) {
                    meta.genre = cachedMeta.genre;
                }
                if (Object.keys(meta).length > 0) {
                    cachedTrack.metadata = meta;
                }
            }
            this.tracksByPath.set(sid, cachedTrack);
        }
        return { existingAnalysis: existingAnalysis, existingMeta: existingMeta };
    }

    private static metadataFromItem(item: JellyfinAudioItem): TrackMetadata {
        const metadata: TrackMetadata = {};
        if (item.artist !== undefined) {
            metadata.artist = item.artist;
        }
        if (item.name !== '') {
            metadata.title = item.name;
        }
        if (item.album !== undefined) {
            metadata.album = item.album;
        }
        if (item.year !== undefined) {
            metadata.year = item.year;
        }
        if (item.genre !== undefined) {
            metadata.genre = item.genre;
        }
        return metadata;
    }

    private static metadataToEntity(
        providerId: string,
        item: JellyfinAudioItem,
    ): TrackMetadataEntity {
        const e: TrackMetadataEntity = new TrackMetadataEntity();
        e.providerId = providerId;
        e.sourceId = item.id;
        e.artist = item.artist ?? null;
        e.title = item.name === '' ? null : item.name;
        e.album = item.album ?? null;
        e.year = item.year ?? null;
        e.genre = item.genre ?? null;
        e.hasCover = item.hasCover;
        return e;
    }

    private static toEntity(
        providerId: string,
        sourceId: string,
        mtime: number,
        size: number,
        r: AnalysisResult,
    ): AnalyzedTrackEntity {
        const e: AnalyzedTrackEntity = new AnalyzedTrackEntity();
        e.providerId = providerId;
        e.sourceId = sourceId;
        e.mtime = mtime;
        e.size = size;
        e.musicalKey = r.key;
        e.camelot = r.camelot.toString();
        e.openKey = r.openKey.toString();
        e.bpm = r.bpm;
        e.energy = r.energy;
        e.durationSec = r.durationSec;
        e.beats = r.beats;
        e.energyTimeline = r.energyTimeline;
        e.drops = r.drops;
        return e;
    }

    private static deserialize(e: AnalyzedTrackEntity): AnalysisResult {
        const camelot: Camelot | null = Camelot.fromString(e.camelot);
        const openKey: OpenKey | null = OpenKey.fromString(e.openKey);
        if (camelot === null || openKey === null) {
            throw new Error(
                `Corrupt analysis row: providerId="${e.providerId}" sourceId="${e.sourceId}" `
                + `camelot="${e.camelot}" openKey="${e.openKey}"`,
            );
        }
        return {
            key: e.musicalKey,
            camelot: camelot,
            openKey: openKey,
            bpm: e.bpm,
            energy: e.energy,
            durationSec: e.durationSec,
            beats: e.beats,
            energyTimeline: e.energyTimeline,
            drops: e.drops,
        };
    }

}

/** Alias for the global `fetch` Response so we don't shadow Express's `Response` —
 *  both names collide otherwise and Express wins because it's in the imports. */
type Response_ = globalThis.Response;