import { Router } from 'express';
import { DefaultRoute } from 'figtree';
import { HandlerResultType, type DefaultHandlerReturn } from 'figtree-schemas';
import { Vts, type ExtractSchemaResultType } from 'vts';
import type { LibraryService } from '../LibraryService.js';

const AudioQuerySchema = Vts.object({
    providerId: Vts.string(),
    path: Vts.string(),
});
type AudioQuery = ExtractSchemaResultType<typeof AudioQuerySchema>;

/**
 * `GET /api/v1/library/audio?providerId=<id>&path=<source-id>` — streams a track's
 * audio. Local providers use `res.sendFile()` (Range-aware) on the resolved
 * absolute path; Jellyfin providers proxy `/Items/{id}/Download` with the browser's
 * Range header forwarded so seeking still works through the proxy.
 *
 * Provider lookup + per-track validation happen inside
 * `LibraryService.serveAudio` — a single source of truth for filesystem access
 * regardless of provider.
 */
export class AudioRoute extends DefaultRoute {

    private readonly service: LibraryService;

    public constructor(service: LibraryService) {
        super();
        this._uriBase = '/api/';
        this.service = service;
    }

    public override getExpressRouter(): Router {
        this._get<unknown, AudioQuery, unknown, unknown, unknown, unknown, unknown, unknown, unknown>(
            this._getUrl('v1', 'library', 'audio'),
            false,
            async (req, res, data): Promise<DefaultHandlerReturn> => {
                const providerId: string | undefined = data.query?.providerId;
                const path: string | undefined = data.query?.path;
                if (providerId === undefined || path === undefined) {
                    res.status(400).send('Missing required query parameters: providerId, path');
                    return { type: HandlerResultType.handled };
                }
                await this.service.serveAudio(providerId, path, req, res);
                return { type: HandlerResultType.handled };
            },
            {
                description: 'Stream the requested track\'s audio (Range-supporting; proxied for Jellyfin).',
                tags: ['library'],
                querySchema: AudioQuerySchema,
            },
        );
        return super.getExpressRouter();
    }
}