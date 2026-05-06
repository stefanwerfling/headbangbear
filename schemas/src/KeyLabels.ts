import { Vts, type ExtractSchemaResultType } from 'vts';

/**
 * One ground-truth label scoped to a specific library provider. `providerId` is the
 * id of the provider the track lives in (`local`-kind only — Jellyfin tracks aren't
 * labelled by filename); `path` is the per-provider source-id (relative path under
 * the provider's `rootDir`). `key` is permissive — the backend's
 * `KeyEvaluator.parseKey` accepts "A minor", "Am", "Bb major", Camelot codes, etc.
 *
 * The on-disk truth file is one-per-provider (`<rootDir>/truth.json`). The API
 * surfaces an array (rather than the legacy filename→key map) so each entry can
 * carry its own `providerId` and round-trip cleanly through vts.
 */
export const KeyLabelEntrySchema = Vts.object({
    providerId: Vts.string(),
    path: Vts.string(),
    key: Vts.string(),
});
export type KeyLabelEntry = ExtractSchemaResultType<typeof KeyLabelEntrySchema>;

/** Query for `GET /api/v1/library/key-labels?providerId=<id>` — restricts the
 *  response to one provider's truth file (Jellyfin providers are silently empty). */
export const KeyLabelsQuerySchema = Vts.object({
    providerId: Vts.string(),
});
export type KeyLabelsQuery = ExtractSchemaResultType<typeof KeyLabelsQuerySchema>;

export const KeyLabelsResponseSchema = Vts.object({
    labels: Vts.array(KeyLabelEntrySchema),
});
export type KeyLabelsResponse = ExtractSchemaResultType<typeof KeyLabelsResponseSchema>;

export const KeyLabelsBodySchema = Vts.object({
    providerId: Vts.string(),
    labels: Vts.array(KeyLabelEntrySchema),
});
export type KeyLabelsBody = ExtractSchemaResultType<typeof KeyLabelsBodySchema>;