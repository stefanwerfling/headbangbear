import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Request, Response } from 'express';
import { ServiceAbstract } from 'figtree';
import { ServiceStatus } from 'figtree-schemas';
import type { Repository } from 'typeorm';
import type {
    LibraryProvider,
    LocalLibraryProvider,
    JellyfinLibraryProvider,
    ScanStatus,
    TrackRef,
} from '@headbangbear/schemas';
import { AudioCache } from '../Audio/AudioCache.js';
import { AnalyzedTrackEntity } from '../Database/Entity/AnalyzedTrackEntity.js';
import { TrackMetadataEntity } from '../Database/Entity/TrackMetadataEntity.js';
import { DatabaseService } from '../Database/DatabaseService.js';
import {
    JellyfinLibrary,
    type ScanProgress as JellyfinScanProgress,
} from '../Library/JellyfinLibrary.js';
import {
    TrackLibrary,
    type AnalyzedTrack,
    type ScanProgress as LocalScanProgress,
} from '../Library/TrackLibrary.js';
import { CoverArtCache } from '../Metadata/CoverArtCache.js';
import { Id3TagExtractor } from '../Metadata/Id3TagExtractor.js';
import { LibraryMetadataEnricher } from '../Metadata/LibraryMetadataEnricher.js';
import { JellyfinClient } from '../Provider/JellyfinClient.js';
import { SettingsStore } from '../Settings/SettingsStore.js';
import { EssentiaAudioAnalyzer } from '../Analysis/EssentiaAudioAnalyzer.js';

/**
 * Storage-agnostic view of a single library — every route reads through this.
 * Both `TrackLibrary` and `JellyfinLibrary` implement it structurally so per-provider
 * dispatch in the service is just `Map<providerId, LibraryFacade>` lookups.
 */
export interface LibraryFacade {
    getProviderId(): string;
    tracks(): AnalyzedTrack[];
    findByPath(path: string): AnalyzedTrack | null;
    compatible(track: AnalyzedTrack): AnalyzedTrack[];
}

type ScanPhase = 'analyse' | 'cache' | 'error' | null;

/**
 * Multi-provider library manager. At `start()` time it reads the providers list from
 * `SettingsStore`, builds one library instance per entry (with its own cover-art /
 * metadata-enricher stack for `local` providers), and kicks off a single background
 * scan that walks the providers **sequentially** (essentia is single-threaded WASM,
 * parallel scans only saturate CPU without speeding things up). Routes look up the
 * service via the singleton, then call `serveAudio()` / `serveCover()` (which dispatch
 * by `providerId`) for binary streaming.
 *
 * Track identity in this layer is `(providerId, path)` — `path` is the
 * **per-provider source-id** (relative path under `local.rootDir`, item-UUID for
 * Jellyfin), not an absolute filesystem path.
 *
 * The track-row population lives inside each library's own `scan()` so `tracks()`
 * is a live view of the in-progress scan — same per-iteration behaviour the
 * background-scan banner relies on.
 */
export class LibraryService extends ServiceAbstract {

    public static readonly NAME: string = 'library';

    private static singleton: LibraryService | null = null;

    private readonly dataDir: string;

    private readonly audioCacheMaxBytes: number | undefined;

    private audioCache: AudioCache | null = null;

    private readonly libraries: Map<string, LibraryFacade> = new Map();

    private readonly localLibraries: Map<string, TrackLibrary> = new Map();

    private readonly localCoverCaches: Map<string, CoverArtCache> = new Map();

    private readonly localEnrichers: Map<string, LibraryMetadataEnricher> = new Map();

    private readonly jellyfinLibraries: Map<string, JellyfinLibrary> = new Map();

    /** Tracks the active DJ-set prefetch window so window-slide POSTs can diff
     *  against the previous state and delete tracks that left the window. The
     *  scanner's prefetch is independent — both share the audio cache, both
     *  pin during their work, so windows can overlap without corruption. */
    private djSetPrefetchWindow: TrackRef[] = [];

    private loaded: boolean = false;

    // Background-scan state, served via `getScanStatus()`.
    private scanState: ScanStatus['state'] = 'idle';

    private scanCurrent: number = 0;

    private scanTotal: number = 0;

    private scanCurrentName: string = '';

    private scanCurrentPhase: ScanPhase = null;

    private scanError: string | null = null;

    private scanCurrentProviderId: string = '';

    private scanProviderIndex: number = 0;

    private scanProviderCount: number = 0;

    private scanStartedAtMs: number | null = null;

    private scanFinishedAtMs: number | null = null;

    public constructor(dataDir: string, audioCacheMaxBytes?: number) {
        // Depends on DatabaseService — start() needs the DataSource ready before we
        // hand out repositories to TrackLibrary / JellyfinLibrary.
        super(LibraryService.NAME, [DatabaseService.NAME]);
        // Resolve to absolute upfront — `res.sendFile()` (audio cache, cover cache)
        // throws on relative paths, and `process.cwd()` may shift if anything
        // chdir's later in the lifecycle. One canonical absolute string everywhere.
        this.dataDir = resolve(dataDir);
        this.audioCacheMaxBytes = audioCacheMaxBytes;
        LibraryService.singleton = this;
    }

    public static getInstance(): LibraryService {
        if (LibraryService.singleton === null) {
            throw new Error('LibraryService has not been instantiated yet');
        }
        return LibraryService.singleton;
    }

    public override async start(): Promise<void> {
        this._inProcess = true;
        this._status = ServiceStatus.Progress;
        try {
            const settings = await SettingsStore.getInstance().load();
            await fs.mkdir(this.dataDir, { recursive: true });
            await this.wipeLegacyCachesOnce(settings.providers);
            // Audio cache lives next to the cover-art cache; per-provider purges are a
            // single `rm -rf <root>/<providerId>`. Used only by Jellyfin libraries —
            // local libraries already have the bytes on disk so a copy would just waste
            // space.
            this.audioCache = new AudioCache(
                join(this.dataDir, 'audio-cache'),
                this.audioCacheMaxBytes,
            );
            const db: DatabaseService = DatabaseService.getInstance();
            const trackRepo: Repository<AnalyzedTrackEntity>
                = db.getRepository(AnalyzedTrackEntity);
            const metaRepo: Repository<TrackMetadataEntity>
                = db.getRepository(TrackMetadataEntity);
            for (const provider of settings.providers) {
                this.bindProvider(provider, trackRepo, metaRepo);
            }
            // Eager DB-load BEFORE returning from start() so the very first
            // `/api/library/list` request the HTTP layer serves already has the
            // previously-analysed tracks. Otherwise the user sees an empty
            // Library / DJ-Set page during the (slow) first scan-paging window.
            await this.preloadAllFromDatabase();
            this.loaded = true;
            this._status = ServiceStatus.Success;
            // Fire-and-forget — bg-scan must not be awaited from start() because that
            // would block HttpService from coming up. Catch errors locally.
            void this.runBackgroundScan();
        } catch (err) {
            this._status = ServiceStatus.Error;
            this._statusMsg = `LibraryService::start: ${String(err)}`;
            throw err;
        } finally {
            this._inProcess = false;
        }
    }

    public override async stop(_forced?: boolean): Promise<void> {
        this._status = ServiceStatus.None;
    }

    public listProviderIds(): string[] {
        return Array.from(this.libraries.keys());
    }

    public getLibrary(providerId: string): LibraryFacade | null {
        return this.libraries.get(providerId) ?? null;
    }

    public allTracks(): AnalyzedTrack[] {
        const out: AnalyzedTrack[] = [];
        for (const lib of this.libraries.values()) {
            out.push(...lib.tracks());
        }
        return out;
    }

    /** Subset of `allTracks()` that excludes soft-disabled tracks. Used by the
     *  DJ-Set planner and the cross-provider compatibility lookup so disabled
     *  tracks never appear in mixes. The Library list still gets `allTracks()`
     *  (the UI greys disabled rows out). */
    public enabledTracks(): AnalyzedTrack[] {
        return this.allTracks().filter((t: AnalyzedTrack): boolean => !t.disabled);
    }

    /** Toggle the soft-disable flag on a single track. Updates the DB row and
     *  the in-memory `tracksByPath` entry so subsequent reads reflect the new
     *  state without a full rescan. Returns the resulting flag (echo of the
     *  request — confirms the persistence). */
    public async setTrackDisabled(
        providerId: string,
        path: string,
        disabled: boolean,
    ): Promise<boolean> {
        const db: DatabaseService = DatabaseService.getInstance();
        const repo: Repository<AnalyzedTrackEntity> = db.getRepository(AnalyzedTrackEntity);
        await repo.update({ providerId: providerId, sourceId: path }, { disabled: disabled });
        const lib: LibraryFacade | undefined = this.libraries.get(providerId);
        const track: AnalyzedTrack | null = lib?.findByPath(path) ?? null;
        if (track !== null) {
            track.disabled = disabled;
        }
        return disabled;
    }

    public findByRef(providerId: string, path: string): AnalyzedTrack | null {
        return this.libraries.get(providerId)?.findByPath(path) ?? null;
    }

    /**
     * Cross-provider compatible matches: a track from any provider can be mixed with
     * a Camelot-compatible track from any other provider. Returns matches sorted by
     * BPM proximity to the input track.
     */
    public compatibleAcross(track: AnalyzedTrack): AnalyzedTrack[] {
        const targetCodes: Set<string> = new Set(
            track.result.camelot.compatibleKeys().map((c): string => c.toString()),
        );
        const targetBpm: number = track.result.bpm;
        // Drop disabled tracks here so the user-facing "compatible matches"
        // list mirrors what the planner would consider — never show a track
        // we'd refuse to actually mix.
        return this.enabledTracks()
            .filter((t: AnalyzedTrack): boolean => {
                if (t.providerId === track.providerId && t.path === track.path) {
                    return false;
                }
                return targetCodes.has(t.result.camelot.toString());
            })
            .sort(
                (a: AnalyzedTrack, b: AnalyzedTrack): number =>
                    Math.abs(a.result.bpm - targetBpm) - Math.abs(b.result.bpm - targetBpm),
            );
    }

    public getScanStatus(): ScanStatus {
        const status: ScanStatus = {
            state: this.scanState,
            current: this.scanCurrent,
            total: this.scanTotal,
            currentName: this.scanCurrentName,
            currentProviderId: this.scanCurrentProviderId,
            providerIndex: this.scanProviderIndex,
            providerCount: this.scanProviderCount,
        };
        if (this.scanCurrentPhase !== null) {
            status.currentPhase = this.scanCurrentPhase;
        }
        if (this.scanError !== null) {
            status.error = this.scanError;
        }
        if (this.scanStartedAtMs !== null) {
            status.startedAtMs = this.scanStartedAtMs;
        }
        if (this.scanFinishedAtMs !== null) {
            status.finishedAtMs = this.scanFinishedAtMs;
        }
        return status;
    }

    /**
     * Re-run all configured providers' scans in the background — fire-and-forget so
     * the HTTP request returns immediately and the UI polls `getScanStatus()`.
     */
    public async rescan(): Promise<void> {
        await this.runBackgroundScan();
    }

    /**
     * Re-bind the in-memory provider list from the persisted settings file. Called by
     * `SettingsRoute.save` after a successful save so newly-added / removed / re-
     * configured providers take effect without restarting the backend. Wipes all
     * provider maps and rebuilds from scratch — simpler than diffing and avoids edge
     * cases when an existing provider's URL/rootDir changed (the same id with new
     * config still needs the underlying library + cache instances rebuilt).
     *
     * Triggers a fresh `runBackgroundScan()` so freshly-added providers actually
     * get scanned, matching the UX expectation "I added a library, scan should run".
     */
    public async reloadProviders(): Promise<void> {
        const settings = await SettingsStore.getInstance().load();
        this.libraries.clear();
        this.localLibraries.clear();
        this.localCoverCaches.clear();
        this.localEnrichers.clear();
        this.jellyfinLibraries.clear();
        const db: DatabaseService = DatabaseService.getInstance();
        const trackRepo: Repository<AnalyzedTrackEntity>
            = db.getRepository(AnalyzedTrackEntity);
        const metaRepo: Repository<TrackMetadataEntity>
            = db.getRepository(TrackMetadataEntity);
        for (const provider of settings.providers) {
            this.bindProvider(provider, trackRepo, metaRepo);
        }
        // Same DB-pre-load as `start()` — newly-bound libraries should expose their
        // existing analyses immediately, before the kicked rescan even starts.
        await this.preloadAllFromDatabase();
        void this.runBackgroundScan();
    }

    /**
     * Set the active DJ-set prefetch window. Replaces the prior window — any
     * tracks that left are dropped from the audio cache (pin-aware), any tracks
     * that entered are downloaded into the cache in parallel. Returns when every
     * fetch has resolved (or failed), so the caller can `await` before play
     * starts to guarantee the first tracks are hot.
     *
     * Safe to call repeatedly with overlapping windows — already-cached tracks
     * are no-ops; pinned tracks (currently streaming) survive the diff-delete.
     * Local-provider tracks count as "always cached" (file is on disk anyway).
     */
    public async setDjSetPrefetchWindow(
        window: readonly TrackRef[],
    ): Promise<{ prefetched: number; failed: number }> {
        const previous: TrackRef[] = this.djSetPrefetchWindow;
        const newKeys: Set<string> = new Set(
            window.map((t: TrackRef): string => `${t.providerId}|${t.path}`),
        );
        this.djSetPrefetchWindow = [...window];

        // Drop tracks that left the window. delete() is pin-aware so a track that
        // also happens to be streamed by an active player won't be yanked.
        if (this.audioCache !== null) {
            for (const old of previous) {
                const key: string = `${old.providerId}|${old.path}`;
                if (newKeys.has(key)) {
                    continue;
                }
                await this.audioCache.delete(old.providerId, old.path);
            }
        }

        // Fetch new + already-window tracks in parallel. Local providers don't
        // need cache (audio is on disk) but still count as "prefetched" for the
        // response so the frontend can treat the window uniformly.
        const fetches: Promise<boolean>[] = window.map(async (ref: TrackRef): Promise<boolean> => {
            const jellyfin: JellyfinLibrary | undefined = this.jellyfinLibraries.get(ref.providerId);
            if (jellyfin === undefined) {
                // Local provider, or unknown provider id. Local: success. Unknown: skip.
                return this.localLibraries.has(ref.providerId);
            }
            try {
                await jellyfin.prefetchAudio(ref.path);
                return true;
            } catch (err) {
                // eslint-disable-next-line no-console
                console.warn(
                    `[djset-prefetch] ${ref.providerId}|${ref.path}: ${err instanceof Error ? err.message : String(err)}`,
                );
                return false;
            }
        });
        const results: boolean[] = await Promise.all(fetches);
        const prefetched: number = results.filter((ok: boolean): boolean => ok).length;
        return { prefetched: prefetched, failed: results.length - prefetched };
    }

    /** Walk every bound library and hydrate its in-memory map from the DB. Failures
     *  on a single provider don't abort the rest — best-effort preload. */
    private async preloadAllFromDatabase(): Promise<void> {
        for (const lib of this.localLibraries.values()) {
            try {
                await lib.loadFromDatabase();
            } catch (err) {
                // eslint-disable-next-line no-console
                console.warn(`[library] preload failed for ${lib.getProviderId()}:`, err);
            }
        }
        for (const lib of this.jellyfinLibraries.values()) {
            try {
                await lib.loadFromDatabase();
            } catch (err) {
                // eslint-disable-next-line no-console
                console.warn(`[library] preload failed for ${lib.getProviderId()}:`, err);
            }
        }
    }

    public getDataDir(): string {
        return this.dataDir;
    }

    public getCoverArtCache(providerId: string): CoverArtCache | null {
        return this.localCoverCaches.get(providerId) ?? null;
    }

    /** Resolved on-disk root for a `local` provider, or null if the providerId is
     *  not configured / is a non-local provider. Used by routes that need to read
     *  per-provider sidecar files (`truth.json` for key-labels, etc.). */
    public getLocalRootDir(providerId: string): string | null {
        return this.localLibraries.get(providerId)?.getRootDir() ?? null;
    }

    /** Get the in-memory `TrackLibrary` for a local provider, or null. Exposed so
     *  routes that need to drive a fresh analysis pass against alternate profiles
     *  (KeyProfileSweep) can resolve absolute paths through the same code that
     *  populated the DB. */
    public getLocalLibrary(providerId: string): TrackLibrary | null {
        return this.localLibraries.get(providerId) ?? null;
    }

    /**
     * Stream a track's audio bytes to the browser. Local mode uses Express's
     * `res.sendFile()` (Range-aware) on the validated absolute path; Jellyfin mode
     * proxies the upstream `Items/{id}/Download` response with the browser's Range
     * header forwarded.
     */
    public async serveAudio(
        providerId: string,
        path: string,
        req: Request,
        res: Response,
    ): Promise<void> {
        const jellyfin: JellyfinLibrary | undefined = this.jellyfinLibraries.get(providerId);
        if (jellyfin !== undefined) {
            if (jellyfin.findByPath(path) === null) {
                res.status(404).send('Track not found in library');
                return;
            }
            await jellyfin.serveAudio(path, req, res);
            return;
        }
        const local: TrackLibrary | undefined = this.localLibraries.get(providerId);
        if (local !== undefined) {
            if (local.findByPath(path) === null) {
                res.status(404).send('Track not found in library');
                return;
            }
            const absPath: string = local.absolutePathFor(path);
            await new Promise<void>((resolveFn): void => {
                res.sendFile(absPath, {}, (err: Error | undefined): void => {
                    if (err !== undefined && !res.headersSent) {
                        res.status(500).send('Failed to stream audio');
                    }
                    resolveFn();
                });
            });
            return;
        }
        res.status(404).send('Provider not found');
    }

    /** Stream a cover image. Local: read from `CoverArtCache` (sha1-keyed jpg/png file).
     *  Jellyfin: proxy `/Items/{id}/Images/Primary`. */
    public async serveCover(
        providerId: string,
        path: string,
        res: Response,
    ): Promise<void> {
        const jellyfin: JellyfinLibrary | undefined = this.jellyfinLibraries.get(providerId);
        if (jellyfin !== undefined) {
            if (jellyfin.findByPath(path) === null) {
                res.status(404).send('Track not found in library');
                return;
            }
            await jellyfin.serveCover(path, res);
            return;
        }
        const local: TrackLibrary | undefined = this.localLibraries.get(providerId);
        const cache: CoverArtCache | undefined = this.localCoverCaches.get(providerId);
        if (local !== undefined && cache !== undefined) {
            if (local.findByPath(path) === null) {
                res.status(404).send('Track not found in library');
                return;
            }
            const coverFile: string | null = await cache.coverPath(path);
            if (coverFile === null) {
                res.status(404).send('No cover art for this track');
                return;
            }
            await new Promise<void>((resolveFn): void => {
                res.sendFile(coverFile, { dotfiles: 'allow' }, (err: Error | undefined): void => {
                    if (err !== undefined && !res.headersSent) {
                        res.status(500).send('Failed to stream cover');
                    }
                    resolveFn();
                });
            });
            return;
        }
        res.status(404).send('Provider not found');
    }

    private bindProvider(
        provider: LibraryProvider,
        trackRepo: Repository<AnalyzedTrackEntity>,
        metaRepo: Repository<TrackMetadataEntity>,
    ): void {
        if (provider.kind === 'local') {
            this.bindLocalProvider(provider, trackRepo, metaRepo);
            return;
        }
        this.bindJellyfinProvider(provider, trackRepo, metaRepo);
    }

    private bindLocalProvider(
        provider: LocalLibraryProvider,
        trackRepo: Repository<AnalyzedTrackEntity>,
        metaRepo: Repository<TrackMetadataEntity>,
    ): void {
        const lib: TrackLibrary = new TrackLibrary(
            provider.id,
            provider.rootDir,
            new EssentiaAudioAnalyzer(),
            trackRepo,
            metaRepo,
            (event: LocalScanProgress): void =>
                this.recordScanProgress(provider.id, 'local', event),
        );
        const coverDir: string = join(this.dataDir, 'covers', provider.id);
        const coverCache: CoverArtCache = new CoverArtCache(coverDir);
        const enricher: LibraryMetadataEnricher = new LibraryMetadataEnricher(
            provider.id,
            provider.rootDir,
            new Id3TagExtractor(),
            coverCache,
            metaRepo,
            (relPath: string): void => {
                // eslint-disable-next-line no-console
                console.log(`[scan/${provider.id}] reading tags ${relPath}`);
            },
        );
        this.libraries.set(provider.id, lib);
        this.localLibraries.set(provider.id, lib);
        this.localCoverCaches.set(provider.id, coverCache);
        this.localEnrichers.set(provider.id, enricher);
    }

    private bindJellyfinProvider(
        provider: JellyfinLibraryProvider,
        trackRepo: Repository<AnalyzedTrackEntity>,
        metaRepo: Repository<TrackMetadataEntity>,
    ): void {
        const client: JellyfinClient = new JellyfinClient({
            url: provider.url,
            apiKey: provider.apiKey,
            userId: provider.userId,
        });
        const lib: JellyfinLibrary = new JellyfinLibrary(
            provider.id,
            client,
            new EssentiaAudioAnalyzer(),
            trackRepo,
            metaRepo,
            this.audioCache,
            provider.excludePatterns ?? [],
            (event: JellyfinScanProgress): void =>
                this.recordScanProgress(provider.id, 'jellyfin', event),
        );
        this.libraries.set(provider.id, lib);
        this.jellyfinLibraries.set(provider.id, lib);
    }

    /**
     * Sequential scan across all providers. State is reset upfront, then each
     * provider's scan runs to completion before the next starts. Errors from a single
     * provider are surfaced into `scanError` and abort the rest of the run — that
     * matches the figtree convention "fail loud" rather than "best-effort partial".
     */
    private async runBackgroundScan(): Promise<void> {
        const providers: string[] = Array.from(this.libraries.keys());
        this.scanState = 'scanning';
        this.scanCurrent = 0;
        this.scanTotal = 0;
        this.scanCurrentName = '';
        this.scanCurrentPhase = null;
        this.scanError = null;
        this.scanCurrentProviderId = '';
        this.scanProviderIndex = 0;
        this.scanProviderCount = providers.length;
        this.scanStartedAtMs = Date.now();
        this.scanFinishedAtMs = null;
        // eslint-disable-next-line no-console
        console.log(`[scan] starting across ${providers.length.toString()} provider(s)…`);
        try {
            for (let i = 0; i < providers.length; i++) {
                const providerId: string = providers[i] as string;
                this.scanProviderIndex = i + 1;
                this.scanCurrentProviderId = providerId;
                this.scanCurrent = 0;
                this.scanTotal = 0;
                this.scanCurrentName = '';
                this.scanCurrentPhase = null;
                const local: TrackLibrary | undefined = this.localLibraries.get(providerId);
                if (local !== undefined) {
                    const tracks: AnalyzedTrack[] = await local.scan();
                    const enricher: LibraryMetadataEnricher | undefined
                        = this.localEnrichers.get(providerId);
                    if (enricher !== undefined) {
                        await enricher.enrich(tracks);
                    }
                    continue;
                }
                const jellyfin: JellyfinLibrary | undefined
                    = this.jellyfinLibraries.get(providerId);
                if (jellyfin !== undefined) {
                    await jellyfin.scan();
                }
            }
            this.scanState = 'done';
            // eslint-disable-next-line no-console
            console.log('[scan] done.');
        } catch (err) {
            this.scanState = 'error';
            this.scanError = err instanceof Error ? err.message : String(err);
            // eslint-disable-next-line no-console
            console.error('[scan] failed:', err);
        } finally {
            this.scanFinishedAtMs = Date.now();
        }
    }

    /** Receives every per-track progress event from any active library and updates
     *  the service's scan state. The provider id is mirrored into `currentProviderId`
     *  so the banner shows which library is currently producing the events. */
    private recordScanProgress(
        providerId: string,
        kind: 'local' | 'jellyfin',
        event: LocalScanProgress | JellyfinScanProgress,
    ): void {
        this.scanCurrentProviderId = providerId;
        this.scanCurrent = event.current;
        this.scanTotal = event.total;
        this.scanCurrentName = event.name;
        this.scanCurrentPhase = event.phase;
        const tag: string = event.phase === 'analyse'
            ? 'analyse'
            : event.phase === 'cache'
                ? 'cache  '
                : 'error  ';
        const detail: string = event.detail !== undefined ? ` — ${event.detail}` : '';
        // eslint-disable-next-line no-console
        console.log(
            `[scan/${providerId}/${kind}] ${event.current.toString().padStart(4)}`
            + `/${event.total.toString()} [${tag}] ${event.name}${detail}`,
        );
    }

    /**
     * One-time wipe of the legacy JSON / cover caches. Idempotent via a sentinel file
     * `<dataDir>/.legacy-wiped` so subsequent boots are no-ops. Targets every known
     * legacy path under each `local` provider's `rootDir` and the per-`local`-rootDir
     * `.jellyfin-data/` directory (Iter 49 stored Jellyfin caches there). After the
     * sentinel is written the service never probes the filesystem for legacy state
     * again — the DB is now the source of truth.
     */
    private async wipeLegacyCachesOnce(providers: readonly LibraryProvider[]): Promise<void> {
        const sentinel: string = join(this.dataDir, '.legacy-wiped');
        try {
            await fs.access(sentinel);
            return;
        } catch {
            // sentinel missing → first-run wipe
        }
        const wiped: string[] = [];
        for (const provider of providers) {
            if (provider.kind !== 'local') {
                continue;
            }
            const root: string = resolve(provider.rootDir);
            for (const rel of ['.analysis-cache.json', '.metadata-cache.json', '.covers', '.jellyfin-data']) {
                const target: string = join(root, rel);
                try {
                    await fs.rm(target, { recursive: true, force: true });
                    wiped.push(target);
                } catch {
                    // already absent or unreadable; nothing to do
                }
            }
        }
        // eslint-disable-next-line no-console
        if (wiped.length > 0) {
            // eslint-disable-next-line no-console
            console.log(`[startup] wiped ${wiped.length.toString()} legacy cache path(s):`);
            for (const w of wiped) {
                // eslint-disable-next-line no-console
                console.log(`  - ${w}`);
            }
        }
        await fs.writeFile(sentinel, `${new Date().toISOString()}\n`, 'utf8');
    }

    /** Test seam: bind a pre-loaded local library without going through `start()`.
     *  Single-provider only — multi-provider tests should construct providers
     *  directly. The override forces `scanState = 'done'` so the routes-test isn't
     *  waiting on scan progress. */
    public static override(
        dataDir: string,
        providerId: string,
        library: TrackLibrary,
        coverCache?: CoverArtCache,
    ): LibraryService {
        const svc: LibraryService = Object.create(LibraryService.prototype) as LibraryService;
        const libraries: Map<string, LibraryFacade> = new Map();
        libraries.set(providerId, library);
        const localLibraries: Map<string, TrackLibrary> = new Map();
        localLibraries.set(providerId, library);
        const localCoverCaches: Map<string, CoverArtCache> = new Map();
        const cache: CoverArtCache = coverCache ?? new CoverArtCache(join(dataDir, 'covers', providerId));
        localCoverCaches.set(providerId, cache);
        Object.defineProperty(svc, 'dataDir', { value: dataDir });
        Object.defineProperty(svc, 'libraries', { value: libraries });
        Object.defineProperty(svc, 'localLibraries', { value: localLibraries });
        Object.defineProperty(svc, 'localCoverCaches', { value: localCoverCaches });
        Object.defineProperty(svc, 'localEnrichers', { value: new Map() });
        Object.defineProperty(svc, 'jellyfinLibraries', { value: new Map() });
        Object.defineProperty(svc, 'loaded', { value: true, writable: true });
        Object.defineProperty(svc, 'scanState', { value: 'done', writable: true });
        Object.defineProperty(svc, 'scanCurrent', { value: 0, writable: true });
        Object.defineProperty(svc, 'scanTotal', { value: 0, writable: true });
        Object.defineProperty(svc, 'scanCurrentName', { value: '', writable: true });
        Object.defineProperty(svc, 'scanCurrentPhase', { value: null, writable: true });
        Object.defineProperty(svc, 'scanError', { value: null, writable: true });
        Object.defineProperty(svc, 'scanCurrentProviderId', { value: '', writable: true });
        Object.defineProperty(svc, 'scanProviderIndex', { value: 0, writable: true });
        Object.defineProperty(svc, 'scanProviderCount', { value: 1, writable: true });
        Object.defineProperty(svc, 'scanStartedAtMs', { value: null, writable: true });
        Object.defineProperty(svc, 'scanFinishedAtMs', { value: null, writable: true });
        LibraryService.singleton = svc;
        return svc;
    }
}