import { promises as fs } from 'node:fs';
import type { AnalyzedTrack } from '../Library/TrackLibrary.js';
import type { CoverArtCache } from './CoverArtCache.js';
import type { TrackMetadataCache } from './TrackMetadataCache.js';
import type { TrackMetadataExtractor, ExtractedMetadata } from './TrackMetadataExtractor.js';
import type { MetadataCacheEntry } from './schemas.js';

export type EnrichProgressFn = (filePath: string) => void;

/**
 * Orchestrates the metadata-enrichment pass over an already-analysed library:
 *
 *   1. Load the metadata cache from disk.
 *   2. For each track, compare cached `mtime`/`size` against the current file. Re-extract
 *      on miss/stale (also clearing the corresponding cover-art-cache entry so dropped
 *      images don't hang around).
 *   3. Mutate the tracks in place, attaching `metadata` + `hasCover`.
 *   4. Persist the refreshed cache back to disk.
 *
 * Kept separate from `TrackLibrary` because metadata is an opt-in concern — the analysis
 * pipeline still works fine without it, and the cache file lives alongside (not inside)
 * `.analysis-cache.json` so the two can be invalidated independently.
 */
export class LibraryMetadataEnricher {

    private readonly extractor: TrackMetadataExtractor;

    private readonly coverCache: CoverArtCache;

    private readonly metadataCache: TrackMetadataCache;

    private readonly onProgress: EnrichProgressFn | undefined;

    public constructor(
        extractor: TrackMetadataExtractor,
        coverCache: CoverArtCache,
        metadataCache: TrackMetadataCache,
        onProgress?: EnrichProgressFn,
    ) {
        this.extractor = extractor;
        this.coverCache = coverCache;
        this.metadataCache = metadataCache;
        this.onProgress = onProgress;
    }

    public async enrich(tracks: AnalyzedTrack[]): Promise<void> {
        const cached: Map<string, MetadataCacheEntry> = await this.metadataCache.loadEntries();
        const fresh: MetadataCacheEntry[] = [];

        for (const track of tracks) {
            let mtime: number;
            let size: number;
            try {
                const stat = await fs.stat(track.path);
                mtime = stat.mtimeMs;
                size = stat.size;
            } catch {
                continue;
            }
            const previous: MetadataCacheEntry | undefined = cached.get(track.path);
            let entry: MetadataCacheEntry;
            if (previous !== undefined && previous.mtime === mtime && previous.size === size) {
                entry = previous;
            } else {
                if (this.onProgress !== undefined) {
                    this.onProgress(track.path);
                }
                if (previous !== undefined && previous.hasCover) {
                    await this.coverCache.clear(track.path);
                }
                entry = await this.extractFresh(track.path, mtime, size);
            }
            track.metadata = entry.metadata;
            track.hasCover = entry.hasCover;
            fresh.push(entry);
        }

        await this.metadataCache.saveEntries(fresh);
    }

    private async extractFresh(
        filePath: string,
        mtime: number,
        size: number,
    ): Promise<MetadataCacheEntry> {
        let extracted: ExtractedMetadata;
        try {
            extracted = await this.extractor.extract(filePath);
        } catch {
            // A single corrupted file shouldn't abort the whole scan; record an empty entry
            // so the orchestration loop won't keep retrying every cycle.
            return {
                path: filePath,
                mtime: mtime,
                size: size,
                metadata: {},
                hasCover: false,
            };
        }
        let hasCover: boolean = false;
        if (extracted.cover !== null) {
            try {
                await this.coverCache.write(filePath, extracted.cover);
                hasCover = true;
            } catch {
                hasCover = false;
            }
        }
        return {
            path: filePath,
            mtime: mtime,
            size: size,
            metadata: extracted.metadata,
            hasCover: hasCover,
        };
    }

}