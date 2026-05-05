import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { Request, Response } from 'express';
import type { TrackMetadata } from '@headbangbear/schemas';
import { Vts, type ExtractSchemaResultType, type SchemaErrors } from 'vts';
import { AudioAnalyzer } from '../Analysis/AudioAnalyzer.js';
import { Camelot } from '../Analysis/Camelot.js';
import { OpenKey } from '../Analysis/OpenKey.js';
import {
    SerializedAnalysisResultSchema,
    type AnalysisResult,
    type SerializedAnalysisResult,
} from '../Analysis/schemas.js';
import {
    JellyfinClient,
    type JellyfinAudioItem,
} from '../Provider/JellyfinClient.js';
import type { AnalyzedTrack } from './TrackLibrary.js';

const CACHE_VERSION: number = 1;

const CachedTrackSchema = Vts.object({
    path: Vts.string(),
    mtime: Vts.number(),
    size: Vts.number(),
    result: SerializedAnalysisResultSchema,
});
type CachedTrack = ExtractSchemaResultType<typeof CachedTrackSchema>;

const CacheFileSchema = Vts.object({
    version: Vts.number(),
    entries: Vts.array(CachedTrackSchema),
});
type CacheFile = ExtractSchemaResultType<typeof CacheFileSchema>;

/** Per-track progress event during `JellyfinLibrary.scan()`. `current` is 1-based; `total`
 *  is the full item count returned by the listing call (so cached items count too — the
 *  bar moves even when only a handful of tracks need re-analysis). `phase` is `'analyse'`
 *  for tracks that go through the streaming pipeline, `'cache'` for ones served from
 *  `.analysis-cache.json`, `'error'` if a single track failed. */
export interface ScanProgress {
    readonly current: number;
    readonly total: number;
    readonly name: string;
    readonly phase: 'analyse' | 'cache' | 'error';
    readonly detail?: string;
}

export type ProgressFn = (event: ScanProgress) => void;

/**
 * Jellyfin-backed equivalent of `TrackLibrary`. Lists audio items via the Jellyfin API,
 * runs every track that's missing from the analysis cache through the configured
 * `AudioAnalyzer` *as a stream* (no temp files — bytes flow `Jellyfin → fetch → ffmpeg
 * stdin → essentia → result`), persists the analysis to a per-server JSON cache, and
 * exposes `serveAudio` / `serveCover` proxies that pipe Jellyfin's responses straight
 * to the browser.
 *
 * Cache freshness is keyed by `(path, mtime, size)` where:
 *   - `path` = Jellyfin item ID
 *   - `mtime` = `Item.DateModified` parsed to ms-since-epoch
 *   - `size`  = `Item.MediaSources[0].Size` in bytes
 * If either differs, the track gets re-analysed.
 *
 * The track field used as identifier is `path`, just like the local provider — kept
 * the same name so `RouteTrack` and the frontend stay opaque about source.
 */
export class JellyfinLibrary {

    private readonly client: JellyfinClient;

    private readonly analyzer: AudioAnalyzer;

    private readonly dataDir: string;

    private readonly onProgress: ProgressFn | undefined;

    private readonly tracksByPath: Map<string, AnalyzedTrack> = new Map();

    public constructor(
        client: JellyfinClient,
        analyzer: AudioAnalyzer,
        dataDir: string,
        onProgress?: ProgressFn,
    ) {
        this.client = client;
        this.analyzer = analyzer;
        this.dataDir = dataDir;
        this.onProgress = onProgress;
    }

    /**
     * Single-pass scan + analysis. Mutates the in-memory map and returns the freshly
     * loaded tracks. Items that fail to analyse (network blip, ffmpeg crash on a single
     * track) are logged via `onProgress` but skipped — one bad track doesn't abort the
     * whole scan.
     */
    public async scan(): Promise<AnalyzedTrack[]> {
        await fs.mkdir(this.dataDir, { recursive: true });
        const items: JellyfinAudioItem[] = await this.client.listAudioItems();
        const cached: Map<string, CachedTrack> = await this.loadCache();
        const fresh: CachedTrack[] = [];
        const tracks: AnalyzedTrack[] = [];
        // Clear up front, populate per iteration — `tracks()` stays a live view of the
        // in-progress scan so the frontend can render rows as they land.
        this.tracksByPath.clear();

        const total: number = items.length;
        for (let idx = 0; idx < items.length; idx++) {
            const item: JellyfinAudioItem = items[idx] as JellyfinAudioItem;
            const current: number = idx + 1;
            const mtime: number = item.dateModifiedMs ?? 0;
            const size: number = item.sizeBytes ?? 0;
            const previous: CachedTrack | undefined = cached.get(item.id);
            let cacheEntry: CachedTrack;
            let result: AnalysisResult;
            if (
                previous !== undefined
                && previous.mtime === mtime
                && previous.size === size
            ) {
                cacheEntry = previous;
                result = JellyfinLibrary.deserialize(previous.result);
                this.onProgress?.({ current: current, total: total, name: item.name, phase: 'cache' });
            } else {
                this.onProgress?.({ current: current, total: total, name: item.name, phase: 'analyse' });
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
                    continue;
                }
                result = analysed;
                cacheEntry = {
                    path: item.id,
                    mtime: mtime,
                    size: size,
                    result: JellyfinLibrary.serialize(analysed),
                };
            }
            fresh.push(cacheEntry);
            const track: AnalyzedTrack = {
                path: item.id,
                result: result,
                hasCover: item.hasCover,
            };
            const metadata: TrackMetadata = JellyfinLibrary.metadataFromItem(item);
            if (Object.keys(metadata).length > 0) {
                track.metadata = metadata;
            }
            tracks.push(track);
            this.tracksByPath.set(track.path, track);
        }

        await this.saveCache(fresh);
        return tracks;
    }

    public tracks(): AnalyzedTrack[] {
        return Array.from(this.tracksByPath.values());
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
                    t.path !== track.path && targetCodes.has(t.result.camelot.toString()),
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
        const upstream: Response_ = (await this.client.openAudioStream(item.id)) as Response_;
        if (!upstream.ok || upstream.body === null) {
            throw new Error(
                `Jellyfin /Items/${item.id}/Download → ${upstream.status.toString()} ${upstream.statusText}`,
            );
        }
        const stream: Readable = JellyfinLibrary.toNodeReadable(upstream.body);
        return this.analyzer.analyze(stream);
    }

    private async loadCache(): Promise<Map<string, CachedTrack>> {
        const cachePath: string = this.cacheFilePath();
        let raw: string;
        try {
            raw = await fs.readFile(cachePath, 'utf8');
        } catch {
            return new Map();
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch {
            return new Map();
        }
        const errors: SchemaErrors = [];
        if (!CacheFileSchema.validate(parsed, errors)) {
            return new Map();
        }
        const validated: CacheFile = parsed;
        if (validated.version !== CACHE_VERSION) {
            return new Map();
        }
        const map: Map<string, CachedTrack> = new Map();
        for (const entry of validated.entries) {
            map.set(entry.path, entry);
        }
        return map;
    }

    private async saveCache(entries: CachedTrack[]): Promise<void> {
        const data: CacheFile = { version: CACHE_VERSION, entries: entries };
        await fs.writeFile(this.cacheFilePath(), JSON.stringify(data, null, 2), 'utf8');
    }

    private cacheFilePath(): string {
        return join(this.dataDir, '.analysis-cache.json');
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

    private static serialize(r: AnalysisResult): SerializedAnalysisResult {
        return {
            key: r.key,
            camelot: r.camelot.toString(),
            openKey: r.openKey.toString(),
            bpm: r.bpm,
            energy: r.energy,
            durationSec: r.durationSec,
            beats: r.beats,
            energyTimeline: r.energyTimeline,
            drops: r.drops,
        };
    }

    private static deserialize(s: SerializedAnalysisResult): AnalysisResult {
        const camelot: Camelot | null = Camelot.fromString(s.camelot);
        const openKey: OpenKey | null = OpenKey.fromString(s.openKey);
        if (camelot === null || openKey === null) {
            throw new Error(`Corrupt cache entry: camelot="${s.camelot}" openKey="${s.openKey}"`);
        }
        return {
            key: s.key,
            camelot: camelot,
            openKey: openKey,
            bpm: s.bpm,
            energy: s.energy,
            durationSec: s.durationSec,
            beats: s.beats,
            energyTimeline: s.energyTimeline,
            drops: s.drops,
        };
    }

}

/** Alias for the global `fetch` Response so we don't shadow Express's `Response` —
 *  both names collide otherwise and Express wins because it's in the imports. */
type Response_ = globalThis.Response;