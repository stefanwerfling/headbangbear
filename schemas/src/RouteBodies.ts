import { Vts, type ExtractSchemaResultType } from 'vts';
import { TransitionPlanSchema, TransitionStyleSchema } from './TransitionPlan.js';
import { EnergyDirectionSchema, EnergyShapeSchema } from './DjSet.js';

export const MixPlanBodySchema = Vts.object({
    fromPath: Vts.string(),
    toPath: Vts.string(),
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
    /** Optional starting-track path; must be a member of the library. */
    startPath: Vts.optional(Vts.string()),
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