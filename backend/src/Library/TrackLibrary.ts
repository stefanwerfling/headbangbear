import { promises as fs } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Repository } from 'typeorm';
import type { TrackMetadata } from '@headbangbear/schemas';
import { AudioAnalyzer } from '../Analysis/AudioAnalyzer.js';
import { Camelot } from '../Analysis/Camelot.js';
import { OpenKey } from '../Analysis/OpenKey.js';
import type { AnalysisResult } from '../Analysis/schemas.js';
import { AnalyzedTrackEntity } from '../Database/Entity/AnalyzedTrackEntity.js';
import { TrackMetadataEntity } from '../Database/Entity/TrackMetadataEntity.js';

const AUDIO_PATTERN: RegExp = /\.mp3$/i;

/**
 * In-memory view of a single track. `path` is the **per-provider source-id**:
 * for `local` providers it's the file's path *relative to* `rootDir` (forward
 * slashes), so the value is the same string the API exposes and the DB stores.
 * Code that needs the absolute on-disk path must `join(rootDir, path)`.
 */
export interface AnalyzedTrack {
    readonly providerId: string;
    readonly path: string;
    readonly result: AnalysisResult;
    /** Embedded-tag metadata. Filled in by the metadata-enrichment pass. */
    metadata?: TrackMetadata;
    /** True iff a cover image was extracted (and persisted by `CoverArtCache`) for this track. */
    hasCover: boolean;
    /** Soft-disable: kept in the library but excluded from `compatible()` /
     *  `DjSetPlanner`. Toggled by the per-row deactivate button. */
    disabled: boolean;
}

/** Per-track progress event during `TrackLibrary.scan()`. Mirrors `JellyfinLibrary.ScanProgress`
 *  so `LibraryService` can store one shape regardless of source. */
export interface ScanProgress {
    readonly current: number;
    readonly total: number;
    readonly name: string;
    readonly phase: 'analyse' | 'cache' | 'error';
    readonly detail?: string;
}

export type ProgressFn = (event: ScanProgress) => void;

/**
 * Local-folder library backed by the SQLite/MariaDB analysis cache. Tracks are
 * keyed by `(providerId, relativePath)` everywhere — there is no longer a JSON
 * cache file, every analysed track is upserted into the DB as it lands so an
 * interrupted scan only loses the track currently being analysed.
 *
 * `findByPath`, `compatible` etc. operate on the *relative* path string. The
 * `rootDir` is needed only by the scan loop and by the audio-serving route
 * (which lives in `LibraryService`).
 */
export class TrackLibrary {

    private readonly providerId: string;

    private readonly rootDir: string;

    private readonly analyzer: AudioAnalyzer;

    private readonly repo: Repository<AnalyzedTrackEntity>;

    private readonly metaRepo: Repository<TrackMetadataEntity>;

    private readonly onProgress: ProgressFn | undefined;

    private readonly tracksByPath: Map<string, AnalyzedTrack> = new Map();

    public constructor(
        providerId: string,
        rootDir: string,
        analyzer: AudioAnalyzer,
        repo: Repository<AnalyzedTrackEntity>,
        metaRepo: Repository<TrackMetadataEntity>,
        onProgress?: ProgressFn,
    ) {
        this.providerId = providerId;
        this.rootDir = rootDir;
        this.analyzer = analyzer;
        this.repo = repo;
        this.metaRepo = metaRepo;
        this.onProgress = onProgress;
    }

    public getProviderId(): string {
        return this.providerId;
    }

    public getRootDir(): string {
        return this.rootDir;
    }

    /** Resolve a per-provider relative path back to the absolute on-disk path. */
    public absolutePathFor(relativePath: string): string {
        return join(this.rootDir, relativePath);
    }

    /**
     * Hydrate the in-memory `tracksByPath` from the DB. Called by `LibraryService`
     * directly after binding the provider so `tracks()` returns the previously-
     * analysed set even before the (potentially slow) file walk completes.
     * Idempotent — `scan()` calls it again at the top to re-sync after wipes.
     */
    public async loadFromDatabase(): Promise<void> {
        await this.loadAnalysisMaps();
    }

    public async scan(): Promise<AnalyzedTrack[]> {
        // DB-load comes FIRST — before the filesystem walk. For local providers
        // the walk is normally fast, but on slow disks (NFS, USB) it isn't, and
        // the Library UI would briefly show an empty list during a rescan.
        const { existingAnalysis, existingMeta } = await this.loadAnalysisMaps();
        const files: string[] = await TrackLibrary.findAudioFiles(this.rootDir);
        const seenSourceIds: Set<string> = new Set();
        const total: number = files.length;

        for (let i = 0; i < files.length; i++) {
            const absPath: string = files[i] as string;
            const relPath: string = TrackLibrary.toRelativeKey(this.rootDir, absPath);
            seenSourceIds.add(relPath);
            const stat = await fs.stat(absPath);
            const mtime: number = stat.mtimeMs;
            const size: number = stat.size;
            const existing: AnalyzedTrackEntity | undefined = existingAnalysis.get(relPath);

            let result: AnalysisResult;
            if (
                existing !== undefined
                && existing.mtime === mtime
                && existing.size === size
            ) {
                result = TrackLibrary.deserialize(existing);
                this.onProgress?.({
                    current: i + 1,
                    total: total,
                    name: relPath,
                    phase: 'cache',
                });
            } else {
                this.onProgress?.({
                    current: i + 1,
                    total: total,
                    name: relPath,
                    phase: 'analyse',
                });
                result = await this.analyzer.analyze(absPath);
                const entity: AnalyzedTrackEntity = TrackLibrary.toEntity(
                    this.providerId,
                    relPath,
                    mtime,
                    size,
                    result,
                );
                // `upsert` is single-statement (`INSERT ... ON CONFLICT DO UPDATE`) on both
                // sqlite and mariadb — half the round-trips of repo.save() and atomic per row,
                // so a kill mid-scan only loses the track currently being analysed.
                await this.repo.upsert(entity, ['providerId', 'sourceId']);
                // File content changed (or never seen before) ⇒ any cached metadata is now
                // suspect; drop it so the enricher re-extracts on the next pass. The cover
                // file is keyed by `sha1(sourceId)` so it survives the mtime change — the
                // enricher's re-extract will overwrite it if the cover still exists.
                if (existing !== undefined) {
                    await this.metaRepo.delete({
                        providerId: this.providerId,
                        sourceId: relPath,
                    });
                    existingMeta.delete(relPath);
                }
            }

            const metaEntity: TrackMetadataEntity | undefined = existingMeta.get(relPath);
            const track: AnalyzedTrack = {
                providerId: this.providerId,
                path: relPath,
                result: result,
                hasCover: metaEntity?.hasCover ?? false,
                disabled: existingAnalysis.get(relPath)?.disabled ?? false,
            };
            const metadata: TrackMetadata | null
                = metaEntity !== undefined ? TrackLibrary.metadataFromEntity(metaEntity) : null;
            if (metadata !== null) {
                track.metadata = metadata;
            }
            this.tracksByPath.set(relPath, track);
            // Per-iteration macrotask yield so HTTP requests that land mid-scan don't
            // wait for the whole iteration's CPU window. See `EssentiaAudioAnalyzer.yieldEventLoop`.
            await TrackLibrary.yieldEventLoop();
        }

        // Prune entities for files that no longer exist on disk so the DB doesn't
        // accumulate orphaned rows. Done after the loop because deleting mid-scan
        // could orphan rows we haven't visited yet (e.g. on a partial scan abort).
        for (const sid of existingAnalysis.keys()) {
            if (!seenSourceIds.has(sid)) {
                await this.repo.delete({ providerId: this.providerId, sourceId: sid });
                await this.metaRepo.delete({ providerId: this.providerId, sourceId: sid });
            }
        }

        return Array.from(this.tracksByPath.values());
    }

    public tracks(): AnalyzedTrack[] {
        return Array.from(this.tracksByPath.values());
    }

    /** Lookup by per-provider relative path. Absolute paths or paths from a different
     *  provider return null — this is the API contract. */
    public findByPath(path: string): AnalyzedTrack | null {
        return this.tracksByPath.get(path) ?? null;
    }

    /**
     * Camelot-compatible tracks for a given entry, sorted by BPM proximity to the input.
     * Excludes the input track itself.
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

    /** See `EssentiaAudioAnalyzer.yieldEventLoop` — same pattern, kept local so the
     *  scan loop can yield without importing the analyzer. */
    private static yieldEventLoop(): Promise<void> {
        return new Promise<void>((resolve): void => {
            setImmediate(resolve);
        });
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
                result: TrackLibrary.deserialize(entity),
                hasCover: existingMeta.get(sid)?.hasCover ?? false,
                disabled: entity.disabled,
            };
            const cachedMeta: TrackMetadataEntity | undefined = existingMeta.get(sid);
            if (cachedMeta !== undefined) {
                const meta: TrackMetadata | null = TrackLibrary.metadataFromEntity(cachedMeta);
                if (meta !== null) {
                    cachedTrack.metadata = meta;
                }
            }
            this.tracksByPath.set(sid, cachedTrack);
        }
        return { existingAnalysis: existingAnalysis, existingMeta: existingMeta };
    }

    /** Path normalisation for the `sourceId` column: forward-slashes, regardless of
     *  the host OS. Stored consistently so a Windows-built DB roundtrips on Linux
     *  (and the cross-provider compare in the API doesn't accidentally distinguish
     *  `a/b.mp3` from `a\b.mp3`). */
    private static toRelativeKey(rootDir: string, absPath: string): string {
        const rel: string = relative(rootDir, absPath);
        return sep === '/' ? rel : rel.split(sep).join('/');
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

    private static metadataFromEntity(m: TrackMetadataEntity): TrackMetadata | null {
        const out: TrackMetadata = {};
        if (m.artist !== null) {
            out.artist = m.artist;
        }
        if (m.title !== null) {
            out.title = m.title;
        }
        if (m.album !== null) {
            out.album = m.album;
        }
        if (m.year !== null) {
            out.year = m.year;
        }
        if (m.genre !== null) {
            out.genre = m.genre;
        }
        return Object.keys(out).length > 0 ? out : null;
    }

    /** Recursive scan of `dir`, collecting every `*.mp3` (case-insensitive). Hidden
     *  directories (`.covers/`, `.git/`, `.hbb-data/` if accidentally placed under
     *  the library root) are skipped — `findAudioFiles` is unsuitable for symlink
     *  loops, but we don't follow symlinks anyway. */
    private static async findAudioFiles(dir: string): Promise<string[]> {
        const result: string[] = [];
        const walk = async (d: string): Promise<void> => {
            const entries = await fs.readdir(d, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.name.startsWith('.')) {
                    continue;
                }
                const p: string = join(d, entry.name);
                if (entry.isDirectory()) {
                    await walk(p);
                } else if (entry.isFile() && AUDIO_PATTERN.test(entry.name)) {
                    result.push(p);
                }
            }
        };
        await walk(dir);
        return result.sort();
    }
}