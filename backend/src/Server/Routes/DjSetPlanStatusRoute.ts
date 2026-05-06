import { Router } from 'express';
import { DefaultRoute } from 'figtree';
import { DjSetPlanStatusSchema, type DjSetPlanStatus } from '@headbangbear/schemas';
import { DjSetPlannerJob } from '../../DjSet/DjSetPlannerJob.js';

/**
 * `GET /api/v1/dj-set/plan-status` — current state of the (singleton) async DJ-set
 * planner job. Frontend polls this until `state === 'done'` (use `result`) or
 * `'error'`. `'idle'` is the boot state before any plan has been requested.
 */
export class DjSetPlanStatusRoute extends DefaultRoute {

    public constructor() {
        super();
        this._uriBase = '/api/';
    }

    public override getExpressRouter(): Router {
        this._get(
            this._getUrl('v1', 'dj-set', 'plan-status'),
            false,
            async (_req, _res, _data): Promise<DjSetPlanStatus> =>
                DjSetPlannerJob.getInstance().getStatus(),
            {
                description: 'Poll the singleton DJ-set planner job for progress + result.',
                tags: ['dj-set'],
                responseBodySchema: DjSetPlanStatusSchema,
            },
        );
        return super.getExpressRouter();
    }
}