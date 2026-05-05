import { Vts, type ExtractSchemaResultType } from 'vts';

/**
 * Per-track metadata extracted from embedded tags (ID3, Vorbis, MP4 etc.) — all fields
 * optional because real-world libraries are inconsistent. The cover art is *not* in this
 * shape: covers are served via a dedicated route to avoid base64-bloating the JSON list
 * payload. Presence is signalled by `RouteTrackSchema.hasCover`.
 */
export const TrackMetadataSchema = Vts.object({
    artist: Vts.optional(Vts.string()),
    title: Vts.optional(Vts.string()),
    album: Vts.optional(Vts.string()),
    year: Vts.optional(Vts.number()),
    genre: Vts.optional(Vts.string()),
});
export type TrackMetadata = ExtractSchemaResultType<typeof TrackMetadataSchema>;