import { Vts, type ExtractSchemaResultType } from 'vts';
import { TrackMetadataSchema } from '@headbangbear/schemas';

export const METADATA_CACHE_VERSION: number = 1;

/**
 * One row in the metadata-cache JSON. `mtime` + `size` are the freshness keys (matching the
 * audio-analysis cache's invariant): if either changes since extraction, the row is treated
 * as stale and the track is re-extracted on the next scan.
 */
export const MetadataCacheEntrySchema = Vts.object({
    path: Vts.string(),
    mtime: Vts.number(),
    size: Vts.number(),
    metadata: TrackMetadataSchema,
    /** True iff a cover image was written to the {@link CoverArtCache} for this track. */
    hasCover: Vts.boolean(),
});
export type MetadataCacheEntry = ExtractSchemaResultType<typeof MetadataCacheEntrySchema>;

export const MetadataCacheFileSchema = Vts.object({
    version: Vts.number(),
    entries: Vts.array(MetadataCacheEntrySchema),
});
export type MetadataCacheFile = ExtractSchemaResultType<typeof MetadataCacheFileSchema>;