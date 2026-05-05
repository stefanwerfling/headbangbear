import { Vts, type ExtractSchemaResultType } from 'vts';

/**
 * One ground-truth label: filename → canonical key string. The on-disk format used by
 * the backend's `truth.json` (and the existing `KeyEval` CLI) is a flat
 * `{ "filename.mp3": "A minor" }` map; the API surfaces it as an array because vts
 * arrays validate and round-trip more cleanly than open-ended object maps.
 *
 * `key` is intentionally permissive — the backend's `KeyEvaluator.parseKey` accepts
 * "A minor", "Am", "Bb major", Camelot codes, etc. An empty string means "not labelled
 * yet" and is filtered out before persistence.
 */
export const KeyLabelEntrySchema = Vts.object({
    filename: Vts.string(),
    key: Vts.string(),
});
export type KeyLabelEntry = ExtractSchemaResultType<typeof KeyLabelEntrySchema>;

export const KeyLabelsResponseSchema = Vts.object({
    labels: Vts.array(KeyLabelEntrySchema),
});
export type KeyLabelsResponse = ExtractSchemaResultType<typeof KeyLabelsResponseSchema>;

export const KeyLabelsBodySchema = KeyLabelsResponseSchema;
export type KeyLabelsBody = KeyLabelsResponse;