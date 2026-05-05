import { Vts, type ExtractSchemaResultType } from 'vts';
import { RouteTrackSchema } from './RouteTrack.js';

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