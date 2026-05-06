import { Router } from 'express';
import { DefaultRoute } from 'figtree';
import {
    DjSetPrefetchBodySchema,
    DjSetPrefetchResponseSchema,
    type DjSetPrefetchBody,
    type DjSetPrefetchResponse,
} from '@headbangbear/schemas';
import type { LibraryService } from '../LibraryService.js';

/**
 * `POST /api/v1/dj-set/prefetch` — manages the rolling 3-track audio cache
 * window that backs DJ-set playback. The frontend `AutoPlayer` calls this:
 *  - **Once with `await` before play starts** with `window = [t0, t1, t2]`. The
 *    response resolves once every Jellyfin download has finished, so the first
 *    track is guaranteed hot in the cache and `<audio>.canplaythrough` fires
 *    quickly.
 *  - **Fire-and-forget on every track change** with the new shifted window
 *    `[ti, ti+1, ti+2]`. Tracks that left are dropped from the cache (pin-aware,
 *    so an actively-streaming track survives), tracks that joined are pulled.
 *
 * State is kept on `LibraryService` — there's at most one active DJ-set
 * prefetch window at a time. Sending a non-overlapping window supersedes the
 * old one, freeing all of its bytes.
 */
export class DjSetPrefetchRoute extends DefaultRoute {

    private readonly service: LibraryService;

    public constructor(service: LibraryService) {
        super();
        this._uriBase = '/api/';
        this.service = service;
    }

    public override getExpressRouter(): Router {
        this._post(
            this._getUrl('v1', 'dj-set', 'prefetch'),
            false,
            async (_req, _res, data): Promise<DjSetPrefetchResponse> => {
                const body: DjSetPrefetchBody = (data.body as DjSetPrefetchBody | undefined)
                    ?? { window: [] };
                return this.service.setDjSetPrefetchWindow(body.window);
            },
            {
                description:
                    'Set the rolling DJ-set prefetch window. The backend ensures the listed '
                    + 'tracks are in the audio cache (downloading from Jellyfin if needed) and '
                    + 'drops any track that left the window since the last call.',
                tags: ['dj-set'],
                bodySchema: DjSetPrefetchBodySchema,
                responseBodySchema: DjSetPrefetchResponseSchema,
            },
        );
        return super.getExpressRouter();
    }

}