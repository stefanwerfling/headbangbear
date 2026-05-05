import { Vts, type ExtractSchemaResultType } from 'vts';
import { RouteTrackSchema } from './RouteTrack.js';
import { LibrarySourceSchema } from './Settings.js';

export const LibraryResponseSchema = Vts.object({
    libraryDir: Vts.string(),
    tracks: Vts.array(RouteTrackSchema),
});
export type LibraryResponse = ExtractSchemaResultType<typeof LibraryResponseSchema>;

export const CompatibleQuerySchema = Vts.object({
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
 *  - `librarySource` — echoes the active source so the UI can label the banner.
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
    librarySource: LibrarySourceSchema,
    startedAtMs: Vts.optional(Vts.number()),
    finishedAtMs: Vts.optional(Vts.number()),
});
export type ScanStatus = ExtractSchemaResultType<typeof ScanStatusSchema>;