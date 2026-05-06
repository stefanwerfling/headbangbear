import { Router } from 'express';
import { DefaultRoute } from 'figtree';
import {
    DisableTrackBodySchema,
    DisableTrackResponseSchema,
    type DisableTrackBody,
    type DisableTrackResponse,
} from '@headbangbear/schemas';
import type { LibraryService } from '../LibraryService.js';

/**
 * `POST /api/v1/tracks/disable` — toggle the soft-disable flag on a single
 * track. The track stays in the DB and the Library list (greyed out in the
 * UI), but `DjSetPlanner` and `tracks/compatible` skip it. Used by the
 * per-row deactivate button.
 */
export class DisableTrackRoute extends DefaultRoute {

    private readonly service: LibraryService;

    public constructor(service: LibraryService) {
        super();
        this._uriBase = '/api/';
        this.service = service;
    }

    public override getExpressRouter(): Router {
        this._post(
            this._getUrl('v1', 'tracks', 'disable'),
            false,
            async (_req, _res, data): Promise<DisableTrackResponse> => {
                const body: DisableTrackBody = data.body as DisableTrackBody;
                const result: boolean = await this.service.setTrackDisabled(
                    body.providerId,
                    body.path,
                    body.disabled,
                );
                return { disabled: result };
            },
            {
                description:
                    'Set the soft-disable flag on a track. Disabled tracks remain in '
                    + 'the Library list but are excluded from DjSet planning and '
                    + 'compatible-matches lookups.',
                tags: ['tracks'],
                bodySchema: DisableTrackBodySchema,
                responseBodySchema: DisableTrackResponseSchema,
            },
        );
        return super.getExpressRouter();
    }

}