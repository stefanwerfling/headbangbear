import { Router } from 'express';
import { DefaultRoute } from 'figtree';
import { HandlerResultType, type DefaultHandlerReturn } from 'figtree-schemas';
import { Vts, type ExtractSchemaResultType } from 'vts';
import type { LibraryService } from '../LibraryService.js';

const CoverQuerySchema = Vts.object({
    path: Vts.string(),
});
type CoverQuery = ExtractSchemaResultType<typeof CoverQuerySchema>;

/**
 * `GET /api/v1/library/cover?path=<abs-path>` — streams a track's cover image. Local
 * libraries serve from the on-disk cover cache (sha1-keyed jpg/png inside `<library>/.covers`,
 * needs `dotfiles: 'allow'` because of the dot prefix); Jellyfin libraries proxy
 * `/Items/{id}/Images/Primary`. Path is validated against the loaded library on both
 * sides so the route can't be used for arbitrary fs / network access.
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
                const path: string | undefined = data.query?.path;
                if (path === undefined) {
                    res.status(400).send('Missing required query parameter: path');
                    return { type: HandlerResultType.handled };
                }
                await this.service.serveCover(path, res);
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