import { Vts, type ExtractSchemaResultType } from 'vts';
import { RouteTrackSchema } from './RouteTrack.js';

export const LibraryResponseSchema = Vts.object({
    tracks: Vts.array(RouteTrackSchema),
});
export type LibraryResponse = ExtractSchemaResultType<typeof LibraryResponseSchema>;

/** Track lookup query used by `/api/v1/tracks/compatible` — `(providerId, path)` is
 *  the per-track identity used everywhere in the API. */
export const CompatibleQuerySchema = Vts.object({
    providerId: Vts.string(),
    path: Vts.string(),
});
export type CompatibleQuery = ExtractSchemaResultType<typeof CompatibleQuerySchema>;

export const CompatibleMatchSchema = RouteTrackSchema.extend({
    bpmDelta: Vts.number(),
});
export type CompatibleMatch = ExtractSchemaResultType<typeof CompatibleMatchSchema>;

export const CompatibleResponseSchema = Vts.object({
    track: RouteTrackSchema,
    matches: Vts.array(CompatibleMatchSchema),
});
export type CompatibleResponse = ExtractSchemaResultType<typeof CompatibleResponseSchema>;

export const ScanStateSchema = Vts.or([
    Vts.equal('idle' as const),
    Vts.equal('scanning' as const),
    Vts.equal('done' as const),
    Vts.equal('error' as const),
]);
export type ScanState = ExtractSchemaResultType<typeof ScanStateSchema>;

/**
 * Live state of the background library scan, exposed via `GET /api/v1/library/scan-status`.
 *
 *  - `state` — `'idle'` only before the first scan ever, `'scanning'` while a scan is
 *    in flight, `'done'` after a successful run, `'error'` after a failure (with `error`
 *    populated). The frontend polls this and renders a progress bar / banner.
 *  - `current` / `total` — 1-based progress counters; both 0 when no scan has started.
 *  - `currentName` — the file path / track name currently being processed.
 *  - `currentPhase` — `'analyse'` (slow essentia run), `'cache'` (cache-hit fast path),
 *    `'error'` (a single-track error; the scan continues for the next track).
 *  - `currentProviderId` — provider whose scan is currently active. Empty string when
 *    no scan running. The UI labels the banner with this so the user can see which
 *    library is being processed when there are multiple.
 *  - `providerIndex` / `providerCount` — 1-based provider counter for sequential scans
 *    across all configured providers (e.g. `2 / 3` when scanning the second of three).
 */
export const ScanStatusSchema = Vts.object({
    state: ScanStateSchema,
    current: Vts.number(),
    total: Vts.number(),
    currentName: Vts.string(),
    currentPhase: Vts.optional(Vts.or([
        Vts.equal('analyse' as const),
        Vts.equal('cache' as const),
        Vts.equal('error' as const),
    ])),
    error: Vts.optional(Vts.string()),
    currentProviderId: Vts.string(),
    providerIndex: Vts.number(),
    providerCount: Vts.number(),
    startedAtMs: Vts.optional(Vts.number()),
    finishedAtMs: Vts.optional(Vts.number()),
});
export type ScanStatus = ExtractSchemaResultType<typeof ScanStatusSchema>;