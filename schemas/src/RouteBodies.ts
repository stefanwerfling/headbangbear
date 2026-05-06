import { Vts, type ExtractSchemaResultType } from 'vts';
import { TransitionPlanSchema, TransitionStyleSchema } from './TransitionPlan.js';
import { DjSetSchema, EnergyDirectionSchema, EnergyShapeSchema } from './DjSet.js';
import { TrackRefSchema } from './Settings.js';

export const MixPlanBodySchema = Vts.object({
    from: TrackRefSchema,
    to: TrackRefSchema,
    /** Requested transition style. Defaults to `drop-on-drop` server-side. */
    style: Vts.optional(TransitionStyleSchema),
});
export type MixPlanBody = ExtractSchemaResultType<typeof MixPlanBodySchema>;

export const MixPlanResponseSchema = TransitionPlanSchema;

export const DjSetStrategySchema = Vts.or([
    Vts.equal('greedy' as const),
    Vts.equal('beam' as const),
]);

export const DjSetBodySchema = Vts.object({
    energyDirection: Vts.optional(EnergyDirectionSchema),
    /** Trajectory the chain should follow — see `DjSetPlannerOptions.energyShape`. */
    energyShape: Vts.optional(EnergyShapeSchema),
    strategy: Vts.optional(DjSetStrategySchema),
    beamWidth: Vts.optional(Vts.number()),
    tryAllStarts: Vts.optional(Vts.boolean()),
    /** Optional starting-track reference; must be a member of the library. */
    start: Vts.optional(TrackRefSchema),
    /** Soft target for the chain's wall-clock duration in seconds; see `DjSetPlannerOptions`. */
    targetDurationSec: Vts.optional(Vts.number()),
    /** Transition style applied uniformly to every transition in the chain. */
    style: Vts.optional(TransitionStyleSchema),
    /**
     * Soft penalty against placing two tracks by the same artist next to each other. Beam-search
     * only — greedy ignores the flag (greedy already picks "first compatible", adding a fourth
     * tiebreaker doesn't change behaviour meaningfully). Default `false`.
     */
    avoidSameArtist: Vts.optional(Vts.boolean()),
});
export type DjSetBody = ExtractSchemaResultType<typeof DjSetBodySchema>;

/**
 * Body for `POST /api/v1/dj-set/prefetch`. `window` is the rolling 3-track set
 * the backend should keep hot in the audio cache: typically the currently-
 * playing track plus the next two. The frontend resends this on every track
 * change so the backend can drop departed tracks and download newly-arrived
 * ones. Idempotent — calling with an unchanged window is a no-op.
 */
export const DjSetPrefetchBodySchema = Vts.object({
    window: Vts.array(TrackRefSchema),
});
export type DjSetPrefetchBody = ExtractSchemaResultType<typeof DjSetPrefetchBodySchema>;

export const DjSetPrefetchResponseSchema = Vts.object({
    /** Count of tracks now cached (or known-not-cached for local providers). */
    prefetched: Vts.number(),
    /** Count of fetches that hit a Jellyfin error — surfaced for diagnostics, not fatal. */
    failed: Vts.number(),
});
export type DjSetPrefetchResponse = ExtractSchemaResultType<typeof DjSetPrefetchResponseSchema>;

/**
 * Lifecycle of a single async DJ-set planning job. Returned by both `POST
 * /api/v1/dj-set/plan` (kick-off) and `GET /api/v1/dj-set/plan-status` (poll).
 *
 *  - `state` — `'idle'` before any job has run, `'running'` while the worker is
 *    crunching, `'done'` once `result` is populated, `'error'` if the worker
 *    threw / was terminated. Reposting `/plan` while running supersedes the
 *    in-flight job (terminates the worker, spawns a fresh one).
 *  - `result` — populated only when `state === 'done'`. Same `DjSet` shape the
 *    old synchronous `/plan` returned.
 *  - `progress` — coarse "starts evaluated / total starts" counter for beam
 *    search; null for greedy or before the first progress event arrives.
 *  - `startedAtMs` / `finishedAtMs` — wall-clock bookends; both null in idle.
 */
export const DjSetPlanStateSchema = Vts.or([
    Vts.equal('idle' as const),
    Vts.equal('running' as const),
    Vts.equal('done' as const),
    Vts.equal('error' as const),
]);
export type DjSetPlanState = ExtractSchemaResultType<typeof DjSetPlanStateSchema>;

export const DjSetPlanProgressSchema = Vts.object({
    current: Vts.number(),
    total: Vts.number(),
    phase: Vts.string(),
});
export type DjSetPlanProgress = ExtractSchemaResultType<typeof DjSetPlanProgressSchema>;

export const DjSetPlanStatusSchema = Vts.object({
    state: DjSetPlanStateSchema,
    startedAtMs: Vts.optional(Vts.number()),
    finishedAtMs: Vts.optional(Vts.number()),
    progress: Vts.optional(DjSetPlanProgressSchema),
    result: Vts.optional(DjSetSchema),
    error: Vts.optional(Vts.string()),
});
export type DjSetPlanStatus = ExtractSchemaResultType<typeof DjSetPlanStatusSchema>;

/**
 * Body for `POST /api/v1/tracks/disable` — toggle the soft-disable flag on a
 * single track. Used by the per-row "deactivate" button in the Library and
 * DJ-Set views to exclude tracks (e.g. accidental audiobook entries that
 * survived the Jellyfin exclude-patterns filter, or tracks the user just
 * doesn't want in any mix) from future planning.
 */
export const DisableTrackBodySchema = Vts.object({
    providerId: Vts.string(),
    path: Vts.string(),
    disabled: Vts.boolean(),
});
export type DisableTrackBody = ExtractSchemaResultType<typeof DisableTrackBodySchema>;

export const DisableTrackResponseSchema = Vts.object({
    /** Echo of the resulting flag — confirms the change persisted. */
    disabled: Vts.boolean(),
});
export type DisableTrackResponse = ExtractSchemaResultType<typeof DisableTrackResponseSchema>;