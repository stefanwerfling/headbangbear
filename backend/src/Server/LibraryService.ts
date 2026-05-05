import { join } from 'node:path';
import type { Request, Response } from 'express';
import { ServiceAbstract } from 'figtree';
import { ServiceStatus } from 'figtree-schemas';
import type { LibrarySource, ScanStatus } from '@headbangbear/schemas';
import { JellyfinLibrary, type ScanProgress } from '../Library/JellyfinLibrary.js';
import { TrackLibrary, type AnalyzedTrack } from '../Library/TrackLibrary.js';
import { CoverArtCache } from '../Metadata/CoverArtCache.js';
import { Id3TagExtractor } from '../Metadata/Id3TagExtractor.js';
import { LibraryMetadataEnricher } from '../Metadata/LibraryMetadataEnricher.js';
import { TrackMetadataCache } from '../Metadata/TrackMetadataCache.js';
import { JellyfinClient } from '../Provider/JellyfinClient.js';
import { SettingsStore } from '../Settings/SettingsStore.js';
import { LazyEssentiaAnalyzer } from './LazyEssentiaAnalyzer.js';

/**
 * Storage-agnostic view of the library — every route reads through this. Routes don't
 * care whether the bytes live on the local filesystem or on a Jellyfin server.
 */
export interface LibraryFacade {
    tracks(): AnalyzedTrack[];
    findByPath(path: string): AnalyzedTrack | null;
    compatible(track: AnalyzedTrack): AnalyzedTrack[];
}

type ScanPhase = 'analyse' | 'cache' | 'error' | null;

/**
 * figtree service that owns the active library — either local (`TrackLibrary` over
 * a configured directory of MP3s) or remote (`JellyfinLibrary` over a Jellyfin server).
 * The choice is driven by `SettingsStore` at `start()` time. Routes look up the service
 * via the singleton, then call `serveAudio()` / `serveCover()` for binary streaming
 * (each variant knows how to reach its bytes — local sendFile vs Jellyfin proxy).
 *
 * **Background scan**: `start()` constructs the library + caches synchronously, marks
 * itself ready (so `HttpService` can proceed and routes accept requests), and kicks the
 * scan off in a fire-and-forget promise. The scan's progress is exposed via
 * `getScanStatus()` so the frontend can poll, render a progress bar, and refresh the
 * track table as more tracks come in. The libraries themselves populate
 * `tracksByPath` per iteration so `tracks()` is a live view of the in-progress scan.
 */
export class LibraryService extends ServiceAbstract {
    public static readonly NAME: string = 'library';

    private static singleton: LibraryService | null = null;

    private readonly rootDir: string;

    /** When `librarySource === 'local'` */
    private localLibrary: TrackLibrary | null = null;

    private localCoverCache: CoverArtCache | null = null;

    private localEnricher: LibraryMetadataEnricher | null = null;

    /** When `librarySource === 'jellyfin'` */
    private jellyfinLibrary: JellyfinLibrary | null = null;

    private librarySource: LibrarySource = 'local';

    private loaded: boolean = false;

    // Background-scan state, served via `getScanStatus()`.
    private scanState: ScanStatus['state'] = 'idle';

    private scanCurrent: number = 0;

    private scanTotal: number = 0;

    private scanCurrentName: string = '';

    private scanCurrentPhase: ScanPhase = null;

    private scanError: string | null = null;

    private scanStartedAtMs: number | null = null;

    private scanFinishedAtMs: number | null = null;

    public constructor(rootDir: string) {
        super(LibraryService.NAME);
        this.rootDir = rootDir;
        LibraryService.singleton = this;
    }

    public static getInstance(): LibraryService {
        if (LibraryService.singleton === null) {
            throw new Error('LibraryService has not been instantiated yet');
        }
        return LibraryService.singleton;
    }

    /**
     * Build the library in front, kick off the scan in the background. `start()`
     * resolves quickly so the figtree-managed `HttpService` can mount routes and the
     * frontend can fetch (and poll the scan-status endpoint to render progress).
     */
    public override async start(): Promise<void> {
        this._inProcess = true;
        this._status = ServiceStatus.Progress;
        try {
            const settings = await SettingsStore.getInstance().load();
            this.librarySource = settings.librarySource;
            if (this.librarySource === 'jellyfin') {
                this.jellyfinLibrary = new JellyfinLibrary(
                    new JellyfinClient(settings.jellyfin),
                    new LazyEssentiaAnalyzer(),
                    join(this.rootDir, '.jellyfin-data'),
                    (event: ScanProgress): void => this.recordScanProgress('jellyfin', event),
                );
            } else {
                this.localLibrary = new TrackLibrary(
                    new LazyEssentiaAnalyzer(),
                    join(this.rootDir, '.analysis-cache.json'),
                    (event: ScanProgress): void => this.recordScanProgress('local', event),
                );
                this.localCoverCache = new CoverArtCache(this.rootDir);
                this.localEnricher = new LibraryMetadataEnricher(
                    new Id3TagExtractor(),
                    this.localCoverCache,
                    new TrackMetadataCache(join(this.rootDir, '.metadata-cache.json')),
                    (filePath: string): void => {
                        // eslint-disable-next-line no-console
                        console.log(`[scan/local] reading tags ${filePath}`);
                    },
                );
            }
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

    public getLibrary(): LibraryFacade {
        if (!this.loaded) {
            throw new Error('LibraryService.start() has not completed yet');
        }
        if (this.jellyfinLibrary !== null) {
            return this.jellyfinLibrary;
        }
        if (this.localLibrary !== null) {
            return this.localLibrary;
        }
        throw new Error('LibraryService: no library bound');
    }

    public getLibrarySource(): LibrarySource {
        return this.librarySource;
    }

    public getScanStatus(): ScanStatus {
        const status: ScanStatus = {
            state: this.scanState,
            current: this.scanCurrent,
            total: this.scanTotal,
            currentName: this.scanCurrentName,
            librarySource: this.librarySource,
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
     * Re-run the active scan in the background — same fire-and-forget pattern as
     * `start()` so the HTTP request that triggered the rescan can return immediately
     * and the frontend polls `getScanStatus()` for progress. Returns the synchronous
     * "scan kicked off" promise; the actual scan runs after.
     */
    public async rescan(): Promise<void> {
        await this.runBackgroundScan();
    }

    public getRootDir(): string {
        return this.rootDir;
    }

    /** Local-only — Jellyfin mode has no on-disk cover cache to expose. */
    public getCoverArtCache(): CoverArtCache | null {
        return this.localCoverCache;
    }

    /**
     * Stream a track's audio bytes to the browser. Local mode uses Express's
     * `res.sendFile()` (Range-aware) on the validated absolute path; Jellyfin mode
     * proxies the upstream `Items/{id}/Download` response with the browser's Range
     * header forwarded.
     */
    public async serveAudio(path: string, req: Request, res: Response): Promise<void> {
        if (this.jellyfinLibrary !== null) {
            if (this.jellyfinLibrary.findByPath(path) === null) {
                res.status(404).send('Track not found in library');
                return;
            }
            await this.jellyfinLibrary.serveAudio(path, req, res);
            return;
        }
        if (this.localLibrary !== null) {
            if (this.localLibrary.findByPath(path) === null) {
                res.status(404).send('Track not found in library');
                return;
            }
            await new Promise<void>((resolve): void => {
                res.sendFile(path, {}, (err: Error | undefined): void => {
                    if (err !== undefined && !res.headersSent) {
                        res.status(500).send('Failed to stream audio');
                    }
                    resolve();
                });
            });
            return;
        }
        res.status(500).send('No library bound');
    }

    /** Stream a cover image. Local: read from `CoverArtCache` (sha1-keyed jpg/png file).
     *  Jellyfin: proxy `/Items/{id}/Images/Primary`. */
    public async serveCover(path: string, res: Response): Promise<void> {
        if (this.jellyfinLibrary !== null) {
            if (this.jellyfinLibrary.findByPath(path) === null) {
                res.status(404).send('Track not found in library');
                return;
            }
            await this.jellyfinLibrary.serveCover(path, res);
            return;
        }
        if (this.localLibrary !== null && this.localCoverCache !== null) {
            if (this.localLibrary.findByPath(path) === null) {
                res.status(404).send('Track not found in library');
                return;
            }
            const coverFile: string | null = await this.localCoverCache.coverPath(path);
            if (coverFile === null) {
                res.status(404).send('No cover art for this track');
                return;
            }
            await new Promise<void>((resolve): void => {
                res.sendFile(coverFile, { dotfiles: 'allow' }, (err: Error | undefined): void => {
                    if (err !== undefined && !res.headersSent) {
                        res.status(500).send('Failed to stream cover');
                    }
                    resolve();
                });
            });
            return;
        }
        res.status(500).send('No library bound');
    }

    /**
     * Background scan runner — shared by `start()` and `rescan()`. Resets the scan
     * state, drives the underlying library scan, and converts thrown errors into the
     * `error` state instead of leaving them as unhandled rejections.
     */
    private async runBackgroundScan(): Promise<void> {
        this.scanState = 'scanning';
        this.scanCurrent = 0;
        this.scanTotal = 0;
        this.scanCurrentName = '';
        this.scanCurrentPhase = null;
        this.scanError = null;
        this.scanStartedAtMs = Date.now();
        this.scanFinishedAtMs = null;
        // eslint-disable-next-line no-console
        console.log(`[scan/${this.librarySource}] starting…`);
        try {
            if (this.jellyfinLibrary !== null) {
                await this.jellyfinLibrary.scan();
            } else if (this.localLibrary !== null && this.localEnricher !== null) {
                const tracks = await this.localLibrary.scan(this.rootDir);
                await this.localEnricher.enrich(tracks);
            }
            this.scanState = 'done';
            // eslint-disable-next-line no-console
            console.log(`[scan/${this.librarySource}] done.`);
        } catch (err) {
            this.scanState = 'error';
            this.scanError = err instanceof Error ? err.message : String(err);
            // eslint-disable-next-line no-console
            console.error(`[scan/${this.librarySource}] failed:`, err);
        } finally {
            this.scanFinishedAtMs = Date.now();
        }
    }

    /** Receives every per-track progress event from the active library, updates the
     *  service's scan state (so `/scan-status` is fresh) and logs a single line to
     *  the backend terminal. */
    private recordScanProgress(source: string, event: ScanProgress): void {
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
            `[scan/${source}] ${event.current.toString().padStart(4)}/${event.total.toString()} `
            + `[${tag}] ${event.name}${detail}`,
        );
    }

    /** Test seam: inject a pre-loaded local library without going through `start()`. */
    public static override(
        rootDir: string,
        library: TrackLibrary,
        coverCache?: CoverArtCache,
    ): LibraryService {
        const svc: LibraryService = Object.create(LibraryService.prototype) as LibraryService;
        Object.defineProperty(svc, 'rootDir', { value: rootDir });
        Object.defineProperty(svc, 'localLibrary', { value: library, writable: true });
        Object.defineProperty(svc, 'localCoverCache', {
            value: coverCache ?? new CoverArtCache(rootDir),
            writable: true,
        });
        Object.defineProperty(svc, 'localEnricher', { value: null, writable: true });
        Object.defineProperty(svc, 'jellyfinLibrary', { value: null, writable: true });
        Object.defineProperty(svc, 'librarySource', { value: 'local', writable: true });
        Object.defineProperty(svc, 'loaded', { value: true, writable: true });
        Object.defineProperty(svc, 'scanState', { value: 'done', writable: true });
        Object.defineProperty(svc, 'scanCurrent', { value: 0, writable: true });
        Object.defineProperty(svc, 'scanTotal', { value: 0, writable: true });
        Object.defineProperty(svc, 'scanCurrentName', { value: '', writable: true });
        Object.defineProperty(svc, 'scanCurrentPhase', { value: null, writable: true });
        Object.defineProperty(svc, 'scanError', { value: null, writable: true });
        Object.defineProperty(svc, 'scanStartedAtMs', { value: null, writable: true });
        Object.defineProperty(svc, 'scanFinishedAtMs', { value: null, writable: true });
        LibraryService.singleton = svc;
        return svc;
    }
}