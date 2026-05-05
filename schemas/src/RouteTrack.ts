import { Vts, type ExtractSchemaResultType } from 'vts';
import { TrackMetadataSchema } from './TrackMetadata.js';

/**
 * Per-track summary returned from `/api/library` and `/api/tracks/compatible`. Mirrors
 * `DjSetTrackSchema` fields plus the renderer-extras the frontend's Deck and overlay-canvases
 * need (drops, energyTimeline, beats).
 *
 * `metadata` carries embedded-tag fields (artist/title/album/…); `hasCover` signals whether
 * the dedicated `/api/v1/library/cover?path=…` route will return an image for this track.
 * Both are optional/false when the file lacks tags entirely.
 */
export const RouteTrackSchema = Vts.object({
    path: Vts.string(),
    camelot: Vts.string(),
    openKey: Vts.string(),
    bpm: Vts.number(),
    energy: Vts.number(),
    durationSec: Vts.number(),
    drops: Vts.array(Vts.number()),
    /** Per-second RMS — exposed so the frontend can render the energy curve overlay. */
    energyTimeline: Vts.array(Vts.number()),
    /** Beat positions in seconds — frontend renders these as a beat-grid overlay. */
    beats: Vts.array(Vts.number()),
    metadata: Vts.optional(TrackMetadataSchema),
    hasCover: Vts.boolean(),
});
export type RouteTrack = ExtractSchemaResultType<typeof RouteTrackSchema>;