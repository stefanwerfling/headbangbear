import { Vts, type ExtractSchemaResultType } from 'vts';
import {
    KeyEvalCountsSchema,
    KeyProfileSweepReportSchema,
    KeyProfileSweepRowSchema,
    type KeyEvalCounts,
    type KeyProfileSweepReport,
    type KeyProfileSweepRow,
} from '@headbangbear/schemas';
import { MusicalKeySchema } from '../Analysis/schemas.js';

// Re-export the wire-shared schemas so internal callers don't need a second import path.
export {
    KeyEvalCountsSchema,
    KeyProfileSweepReportSchema,
    KeyProfileSweepRowSchema,
};
export type { KeyEvalCounts, KeyProfileSweepReport, KeyProfileSweepRow };

/**
 * Truth file format: a flat object mapping a track filename (basename, with or without
 * `.mp3`) to a key string the user has labelled by ear or from a trusted source. Free-form
 * strings — `KeyEvaluator.parseKey()` accepts canonical (`A minor`), short-hand (`Am`),
 * Camelot (`8A`), and flat notation (`Bb major`).
 */
export const KeyTruthFileSchema = Vts.object2(Vts.string(), Vts.string());
export type KeyTruthFile = ExtractSchemaResultType<typeof KeyTruthFileSchema>;

export const KeyEvalCategorySchema = Vts.or([
    Vts.equal('exact' as const),
    Vts.equal('fifth' as const),
    Vts.equal('relative' as const),
    Vts.equal('parallel' as const),
    Vts.equal('wrong' as const)
]);
export type KeyEvalCategory = ExtractSchemaResultType<typeof KeyEvalCategorySchema>;

// `KeyEvalEntry` and `KeyEvalReport` carry full `MusicalKey` objects which are an internal
// shape (not part of the wire surface) — they stay in this backend-only module.
export const KeyEvalEntrySchema = Vts.object({
    name: Vts.string(),
    predicted: MusicalKeySchema,
    actual: MusicalKeySchema,
    category: KeyEvalCategorySchema,
    score: Vts.number()
});
export type KeyEvalEntry = ExtractSchemaResultType<typeof KeyEvalEntrySchema>;

export const KeyEvalReportSchema = Vts.object({
    entries: Vts.array(KeyEvalEntrySchema),
    counts: KeyEvalCountsSchema,
    mirexScore: Vts.number(),
    matched: Vts.number(),
    unmatchedTruth: Vts.array(Vts.string()),
    untrackedPredictions: Vts.array(Vts.string())
});
export type KeyEvalReport = ExtractSchemaResultType<typeof KeyEvalReportSchema>;