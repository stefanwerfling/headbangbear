import { Router } from 'express';
import { DefaultRoute } from 'figtree';
import { HandlerResultType, type DefaultHandlerReturn } from 'figtree-schemas';
import { Vts, type ExtractSchemaResultType } from 'vts';
import type { LibraryService } from '../LibraryService.js';

const CoverQuerySchema = Vts.object({
    providerId: Vts.string(),
    path: Vts.string(),
});
type CoverQuery = ExtractSchemaResultType<typeof CoverQuerySchema>;

/**
 * `GET /api/v1/library/cover?providerId=<id>&path=<source-id>` — streams a track's
 * cover image. Local providers serve from the per-provider cover cache
 * (sha1(relativePath)-keyed jpg/png under `<dataDir>/covers/<providerId>/`,
 * needs `dotfiles: 'allow'` if the path passes through a dotted segment); Jellyfin
 * providers proxy `/Items/{id}/Images/Primary`.
 *
 * Provider lookup + per-track validation happen inside `LibraryService.serveCover`.
 */
export class LibraryCoverRoute extends DefaultRoute {

    private readonly service: LibraryService;

    public constructor(service: LibraryService) {
        super();
        this._uriBase = '/api/';
        this.service = service;
    }

    public override getExpressRouter(): Router {
        this._get<unknown, CoverQuery, unknown, unknown, unknown, unknown, unknown, unknown, unknown>(
            this._getUrl('v1', 'library', 'cover'),
            false,
            async (_req, res, data): Promise<DefaultHandlerReturn> => {
                const providerId: string | undefined = data.query?.providerId;
                const path: string | undefined = data.query?.path;
                if (providerId === undefined || path === undefined) {
                    res.status(400).send('Missing required query parameters: providerId, path');
                    return { type: HandlerResultType.handled };
                }
                await this.service.serveCover(providerId, path, res);
                return { type: HandlerResultType.handled };
            },
            {
                description: 'Stream the cached cover image for a track (404 when none exists).',
                tags: ['library'],
                querySchema: CoverQuerySchema,
            },
        );
        return super.getExpressRouter();
    }

}