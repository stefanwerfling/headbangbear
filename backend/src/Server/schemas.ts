// All API schemas now live in @headbangbear/schemas (the schemas workspace). This file is a
// thin re-export so existing import paths inside backend/ keep working — and so route files
// can stay agnostic about where the schemas physically live.

export {
    CompatibleMatchSchema,
    CompatibleQuerySchema,
    CompatibleResponseSchema,
    DjSetBodySchema,
    LibraryResponseSchema,
    MixPlanBodySchema,
    MixPlanResponseSchema,
    RouteTrackSchema,
    TrackMetadataSchema,
    type CompatibleMatch,
    type CompatibleQuery,
    type CompatibleResponse,
    type DjSetBody,
    type LibraryResponse,
    type MixPlanBody,
    type RouteTrack,
    type TrackMetadata,
} from '@headbangbear/schemas';