import { Vts, type ExtractSchemaResultType } from 'vts';

/**
 * `keyMatch` — how the camelot relationship between two tracks is classified. `identical`
 * is the same code, `relative` is the A↔B switch at the same number, `energy-up`/`-down`
 * are ±1 number on the wheel, `incompatible` is anything else.
 */
export const KeyMatchSchema = Vts.or([
    Vts.equal('identical' as const),
    Vts.equal('relative' as const),
    Vts.equal('energy-up' as const),
    Vts.equal('energy-down' as const),
    Vts.equal('incompatible' as const),
]);
export type KeyMatch = ExtractSchemaResultType<typeof KeyMatchSchema>;

/**
 * `alignment` — what the planner *actually* used for the cue points. `drop` = drop-on-drop
 * alignment (A's last drop coincides with B's first drop in wall time). `energy` = fade-out
 * at A's last loud section (used when drops aren't usable). `tail-out` = A's drop plays out
 * fully, then crossfade. `early-cut` = A is cut before its drop, B's drop is the climax.
 */
export const AlignmentSchema = Vts.or([
    Vts.equal('drop' as const),
    Vts.equal('energy' as const),
    Vts.equal('tail-out' as const),
    Vts.equal('early-cut' as const),
]);
export type Alignment = ExtractSchemaResultType<typeof AlignmentSchema>;

/**
 * `style` — what the user *requested*. The planner falls back to `energy` alignment when
 * the requested style can't be honoured (e.g. `drop-on-drop` when neither track has a
 * detected drop). `bar-match` deliberately ignores drops — useful for tracks with noisy
 * drop detection (classical, ambient).
 */
export const TransitionStyleSchema = Vts.or([
    Vts.equal('drop-on-drop' as const),
    Vts.equal('tail-out' as const),
    Vts.equal('early-cut' as const),
    Vts.equal('bar-match' as const),
]);
export type TransitionStyle = ExtractSchemaResultType<typeof TransitionStyleSchema>;

const TrackSummarySchema = Vts.object({
    path: Vts.string(),
    camelot: Vts.string(),
    bpm: Vts.number(),
    durationSec: Vts.number(),
    drops: Vts.array(Vts.number()),
});

const TargetTrackSchema = Vts.object({
    path: Vts.string(),
    camelot: Vts.string(),
    originalBpm: Vts.number(),
    pitchPercent: Vts.number(),
    resultingBpm: Vts.number(),
    drops: Vts.array(Vts.number()),
});

export const TransitionPlanSchema = Vts.object({
    from: TrackSummarySchema,
    to: TargetTrackSchema,
    cueOutSec: Vts.number(),
    cueInSec: Vts.number(),
    mixDurationSec: Vts.number(),
    mixBars: Vts.number(),
    keyMatch: KeyMatchSchema,
    alignment: AlignmentSchema,
    style: TransitionStyleSchema,
    notes: Vts.array(Vts.string()),
});
export type TransitionPlan = ExtractSchemaResultType<typeof TransitionPlanSchema>;