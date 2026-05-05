import { join } from 'node:path';
import { ServiceAbstract } from 'figtree';
import { ServiceStatus } from 'figtree-schemas';
import { TrackLibrary } from '../Library/TrackLibrary.js';
import { CoverArtCache } from '../Metadata/CoverArtCache.js';
import { Id3TagExtractor } from '../Metadata/Id3TagExtractor.js';
import { LibraryMetadataEnricher } from '../Metadata/LibraryMetadataEnricher.js';
import { TrackMetadataCache } from '../Metadata/TrackMetadataCache.js';
import { LazyEssentiaAnalyzer } from './LazyEssentiaAnalyzer.js';

/**
 * figtree service that holds the in-memory `TrackLibrary` for the lifetime of the process.
 * Routes look up the singleton via {@link LibraryService.getInstance} so they can stay
 * thin wrappers — no per-request rescans, no per-request analyzer construction.
 *
 * Owns the metadata-enrichment pipeline (`Id3TagExtractor` + `CoverArtCache` +
 * `TrackMetadataCache` glued by `LibraryMetadataEnricher`) which runs after every audio scan
 * to populate `metadata` + `hasCover` on each `AnalyzedTrack`.
 */
export class LibraryService extends ServiceAbstract {
    public static readonly NAME: string = 'library';

    private static singleton: LibraryService | null = null;

    private readonly library: TrackLibrary;

    private readonly rootDir: string;

    private readonly coverCache: CoverArtCache;

    private readonly enricher: LibraryMetadataEnricher;

    private loaded: boolean = false;

    public constructor(rootDir: string) {
        super(LibraryService.NAME);
        this.rootDir = rootDir;
        this.library = new TrackLibrary(
            new LazyEssentiaAnalyzer(),
            join(rootDir, '.analysis-cache.json'),
        );
        this.coverCache = new CoverArtCache(rootDir);
        this.enricher = new LibraryMetadataEnricher(
            new Id3TagExtractor(),
            this.coverCache,
            new TrackMetadataCache(join(rootDir, '.metadata-cache.json')),
        );
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
            const tracks = await this.library.scan(this.rootDir);
            await this.enricher.enrich(tracks);
            this.loaded = true;
            this._status = ServiceStatus.Success;
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

    public getLibrary(): TrackLibrary {
        if (!this.loaded) {
            throw new Error('LibraryService.start() has not completed yet');
        }
        return this.library;
    }

    /**
     * Re-runs the underlying `TrackLibrary.scan()` against the configured root directory.
     * Picks up newly-added or modified `.mp3` files without restarting the server. Already-
     * cached entries with matching `mtime`/`size` are reused, so the typical rescan after
     * dropping in a few new tracks finishes in well under a second. Metadata enrichment
     * is re-run on the same tracks so retagged files surface their new fields immediately.
     */
    public async rescan(): Promise<void> {
        const tracks = await this.library.scan(this.rootDir);
        await this.enricher.enrich(tracks);
    }

    public getRootDir(): string {
        return this.rootDir;
    }

    public getCoverArtCache(): CoverArtCache {
        return this.coverCache;
    }

    /** Test seam: inject a pre-loaded library without going through `start()`. */
    public static override(
        rootDir: string,
        library: TrackLibrary,
        coverCache?: CoverArtCache,
    ): LibraryService {
        const svc: LibraryService = Object.create(LibraryService.prototype) as LibraryService;
        // Bypass constructor to avoid spawning EssentiaAudioAnalyzer in tests.
        Object.defineProperty(svc, 'rootDir', { value: rootDir });
        Object.defineProperty(svc, 'library', { value: library });
        Object.defineProperty(svc, 'coverCache', {
            value: coverCache ?? new CoverArtCache(rootDir),
        });
        Object.defineProperty(svc, 'loaded', { value: true, writable: true });
        LibraryService.singleton = svc;
        return svc;
    }
}