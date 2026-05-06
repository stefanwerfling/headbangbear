import { Vts, type ExtractSchemaResultType } from 'vts';
import { TrackMetadataSchema } from './TrackMetadata.js';

/**
 * Per-track summary returned from `/api/library` and `/api/tracks/compatible`. Mirrors
 * `DjSetTrackSchema` fields plus the renderer-extras the frontend's Deck and overlay-canvases
 * need (drops, energyTimeline, beats).
 *
 * `providerId` namespaces the track — together with `path` (the per-provider source-id:
 * relative path for `local`, item-UUID for `jellyfin`) it forms the unique key the API
 * uses for every per-track endpoint (audio, cover, mix, transition, setlist…).
 *
 * `metadata` carries embedded-tag fields (artist/title/album/…); `hasCover` signals whether
 * the dedicated `/api/v1/library/cover?providerId=…&path=…` route will return an image for
 * this track. Both are optional/false when the file lacks tags entirely.
 */
export const RouteTrackSchema = Vts.object({
    providerId: Vts.string(),
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
    /** Soft-disable flag — when `true`, the track is excluded from `DjSetPlanner`
     *  and `tracks/compatible` results. Library list still shows the row (greyed
     *  out) so the user can re-enable. Toggled via `POST /api/v1/tracks/disable`. */
    disabled: Vts.boolean(),
});
export type RouteTrack = ExtractSchemaResultType<typeof RouteTrackSchema>;