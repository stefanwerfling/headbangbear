import { Vts, type ExtractSchemaResultType } from 'vts';

/**
 * Counts of each MIREX category for a single key-detection profile run. Sums to the
 * `matched` count in the parent report. Lower `wrong` is better.
 */
export const KeyEvalCountsSchema = Vts.object({
    exact: Vts.number(),
    fifth: Vts.number(),
    relative: Vts.number(),
    parallel: Vts.number(),
    wrong: Vts.number(),
});
export type KeyEvalCounts = ExtractSchemaResultType<typeof KeyEvalCountsSchema>;

/**
 * One row of the profile-sweep result table — what `KeyProfileSweep` produces per profile.
 * `mirexScore` is the weighted accuracy (1.0 / 0.5 / 0.3 / 0.2 / 0.0 across the categories,
 * comparable to MIREX's "Audio Key Detection" baseline).
 */
export const KeyProfileSweepRowSchema = Vts.object({
    profile: Vts.string(),
    matched: Vts.number(),
    counts: KeyEvalCountsSchema,
    mirexScore: Vts.number(),
});
export type KeyProfileSweepRow = ExtractSchemaResultType<typeof KeyProfileSweepRowSchema>;

export const KeyProfileSweepReportSchema = Vts.object({
    rows: Vts.array(KeyProfileSweepRowSchema),
    bestProfile: Vts.string(),
    truthSize: Vts.number(),
});
export type KeyProfileSweepReport = ExtractSchemaResultType<typeof KeyProfileSweepReportSchema>;

/**
 * Request body for `POST /api/v1/library/profile-sweep`. Sweeps only run against
 * a single `local`-kind provider — there's no on-disk audio for Jellyfin items so
 * re-extracting key against alternate profiles isn't applicable. `providerId`
 * picks which local provider's truth file + audio to sweep. Empty / omitted
 * `profiles` means "use the server's default set" — the same list the CLI uses
 * without `--profiles=...`.
 */
export const KeyProfileSweepBodySchema = Vts.object({
    providerId: Vts.string(),
    profiles: Vts.optional(Vts.array(Vts.string())),
});
export type KeyProfileSweepBody = ExtractSchemaResultType<typeof KeyProfileSweepBodySchema>;
