import { Vts, type ExtractSchemaResultType } from 'vts';
import { TransitionPlanSchema } from './TransitionPlan.js';

export const EnergyDirectionSchema = Vts.or([
    Vts.equal('up' as const),
    Vts.equal('down' as const),
    Vts.equal('either' as const),
]);
export type EnergyDirection = ExtractSchemaResultType<typeof EnergyDirectionSchema>;

export const EnergyShapeSchema = Vts.or([
    Vts.equal('rising' as const),
    Vts.equal('arc' as const),
    Vts.equal('descending' as const),
]);
export type EnergyShape = ExtractSchemaResultType<typeof EnergyShapeSchema>;

/** Plain string-union; not a vts schema because it's a CLI/HTTP discriminator, not a data shape. */
export type DjSetStrategy = 'greedy' | 'beam';

export const DjSetTrackSchema = Vts.object({
    path: Vts.string(),
    camelot: Vts.string(),
    bpm: Vts.number(),
    energy: Vts.number(),
    durationSec: Vts.number(),
});
export type DjSetTrack = ExtractSchemaResultType<typeof DjSetTrackSchema>;

export const DjSetSchema = Vts.object({
    tracks: Vts.array(DjSetTrackSchema),
    transitions: Vts.array(TransitionPlanSchema),
    skipped: Vts.array(DjSetTrackSchema),
    energyDirection: EnergyDirectionSchema,
    /** Set when the planner ran with `energyShape` — echoed back so clients can label the chain. */
    energyShape: Vts.optional(EnergyShapeSchema),
});
export type DjSet = ExtractSchemaResultType<typeof DjSetSchema>;