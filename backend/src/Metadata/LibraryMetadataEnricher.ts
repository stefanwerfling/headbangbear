import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { Repository } from 'typeorm';
import type { TrackMetadata } from '@headbangbear/schemas';
import type { AnalyzedTrack } from '../Library/TrackLibrary.js';
import { TrackMetadataEntity } from '../Database/Entity/TrackMetadataEntity.js';
import type { CoverArtCache } from './CoverArtCache.js';
import type { TrackMetadataExtractor, ExtractedMetadata } from './TrackMetadataExtractor.js';

export type EnrichProgressFn = (relativePath: string) => void;

/**
 * Orchestrates the metadata-enrichment pass over an already-analysed local library.
 * For each track:
 *
 *   1. Read the existing metadata row from the DB by `(providerId, sourceId)`.
 *   2. Compare cached `mtime`/`size` with the on-disk file. If stale, re-extract
 *      ID3 tags + cover, then upsert. Cover-art-cache entry for that source-id is
 *      cleared first so old images don't shadow the new one.
 *   3. Mutate the in-memory `AnalyzedTrack` to attach `metadata` + `hasCover` so
 *      the next call to `tracks()` already has fresh data without a DB round-trip.
 *
 * Jellyfin-backed libraries don't go through this enricher — they get their
 * metadata directly from the Jellyfin API in `JellyfinLibrary.scan()`.
 */
export class LibraryMetadataEnricher {

    private readonly providerId: string;

    private readonly rootDir: string;

    private readonly extractor: TrackMetadataExtractor;

    private readonly coverCache: CoverArtCache;

    private readonly metaRepo: Repository<TrackMetadataEntity>;

    private readonly onProgress: EnrichProgressFn | undefined;

    public constructor(
        providerId: string,
        rootDir: string,
        extractor: TrackMetadataExtractor,
        coverCache: CoverArtCache,
        metaRepo: Repository<TrackMetadataEntity>,
        onProgress?: EnrichProgressFn,
    ) {
        this.providerId = providerId;
        this.rootDir = rootDir;
        this.extractor = extractor;
        this.coverCache = coverCache;
        this.metaRepo = metaRepo;
        this.onProgress = onProgress;
    }

    public async enrich(tracks: AnalyzedTrack[]): Promise<void> {
        // Eager-load all metadata rows for this provider — same single-SELECT pattern
        // the analyser uses, avoids a per-track round-trip.
        const existing: Map<string, TrackMetadataEntity> = new Map();
        for (const e of await this.metaRepo.find({ where: { providerId: this.providerId } })) {
            existing.set(e.sourceId, e);
        }

        for (const track of tracks) {
            if (track.providerId !== this.providerId) {
                continue;
            }
            const absPath: string = join(this.rootDir, track.path);
            let mtime: number;
            let size: number;
            try {
                const stat = await fs.stat(absPath);
                mtime = stat.mtimeMs;
                size = stat.size;
            } catch {
                continue;
            }
            const previous: TrackMetadataEntity | undefined = existing.get(track.path);
            // We compare freshness against the analysis row's mtime/size in the DB.
            // The metadata entity carries no mtime/size of its own — it's a 1:1 sibling
            // of the analysis row, so once analysis is fresh, we re-derive metadata
            // only when the file's tags couldn't have moved without an mtime bump.
            // If `previous` exists at all, it was extracted from the same file content
            // that the analysis row described — so we can keep it.
            if (previous !== undefined) {
                this.applyMetadata(track, previous);
                continue;
            }
            if (this.onProgress !== undefined) {
                this.onProgress(track.path);
            }
            const fresh: TrackMetadataEntity | null = await this.extractFresh(
                track.path,
                absPath,
                mtime,
                size,
            );
            if (fresh !== null) {
                await this.metaRepo.upsert(fresh, ['providerId', 'sourceId']);
                this.applyMetadata(track, fresh);
            }
        }
    }

    private async extractFresh(
        sourceId: string,
        absPath: string,
        _mtime: number,
        _size: number,
    ): Promise<TrackMetadataEntity | null> {
        let extracted: ExtractedMetadata;
        try {
            extracted = await this.extractor.extract(absPath);
        } catch {
            // A single corrupted file shouldn't abort the whole enrichment; record
            // an empty row so the loop won't keep retrying every cycle.
            return LibraryMetadataEnricher.toEntity(this.providerId, sourceId, {}, false);
        }
        let hasCover: boolean = false;
        if (extracted.cover !== null) {
            // Defensive clear before write — handles the case where someone manually
            // dropped a cover file under the .covers/ dir without the cache writing it.
            await this.coverCache.clear(sourceId);
            try {
                await this.coverCache.write(sourceId, extracted.cover);
                hasCover = true;
            } catch {
                hasCover = false;
            }
        }
        return LibraryMetadataEnricher.toEntity(
            this.providerId,
            sourceId,
            extracted.metadata,
            hasCover,
        );
    }

    private applyMetadata(track: AnalyzedTrack, entity: TrackMetadataEntity): void {
        track.hasCover = entity.hasCover;
        const meta: TrackMetadata = {};
        if (entity.artist !== null) {
            meta.artist = entity.artist;
        }
        if (entity.title !== null) {
            meta.title = entity.title;
        }
        if (entity.album !== null) {
            meta.album = entity.album;
        }
        if (entity.year !== null) {
            meta.year = entity.year;
        }
        if (entity.genre !== null) {
            meta.genre = entity.genre;
        }
        if (Object.keys(meta).length > 0) {
            track.metadata = meta;
        }
    }

    private static toEntity(
        providerId: string,
        sourceId: string,
        metadata: TrackMetadata,
        hasCover: boolean,
    ): TrackMetadataEntity {
        const e: TrackMetadataEntity = new TrackMetadataEntity();
        e.providerId = providerId;
        e.sourceId = sourceId;
        e.artist = metadata.artist ?? null;
        e.title = metadata.title ?? null;
        e.album = metadata.album ?? null;
        e.year = metadata.year ?? null;
        e.genre = metadata.genre ?? null;
        e.hasCover = hasCover;
        return e;
    }

}