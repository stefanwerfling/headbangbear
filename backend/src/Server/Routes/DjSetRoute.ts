import { Router } from 'express';
import { DefaultRoute } from 'figtree';
import {
    DjSetBodySchema,
    DjSetPlanStatusSchema,
    type DjSet,
    type DjSetBody,
    type DjSetPlanStatus,
} from '@headbangbear/schemas';
import { DjSetPlanner, type DjSetPlannerOptions } from '../../DjSet/DjSetPlanner.js';
import { DjSetPlannerJob } from '../../DjSet/DjSetPlannerJob.js';
import type { AnalyzedTrack } from '../../Library/TrackLibrary.js';
import type { LibraryService } from '../LibraryService.js';

/**
 * `POST /api/v1/dj-set/plan` — async kick-off. Runs `DjSetPlanner` in a worker
 * thread (so the beam search doesn't block the HTTP event loop) and returns the
 * job's current status immediately. The frontend polls `GET .../plan-status`
 * for progress + final result.
 *
 * Calling POST again while a job is `running` supersedes the in-flight job:
 * the worker is terminated, a new one is spawned, the old result is dropped.
 */
export class DjSetRoute extends DefaultRoute {

    private readonly service: LibraryService;

    public constructor(service: LibraryService) {
        super();
        this._uriBase = '/api/';
        this.service = service;
    }

    public start(body: DjSetBody): DjSetPlanStatus {
        // `enabledTracks()` skips soft-disabled tracks — the planner never
        // sees them, so they can't end up in mixes.
        const tracks: AnalyzedTrack[] = this.service.enabledTracks();
        const options: DjSetPlannerOptions = this.bodyToOptions(body);
        return DjSetPlannerJob.getInstance().start(tracks, options);
    }

    /**
     * Test seam — runs the planner synchronously in-process (no worker thread).
     * Production goes through `start()` which kicks off a worker so the HTTP
     * thread isn't blocked. Tests prefer the sync path because it gives them
     * the result immediately and doesn't depend on worker bootstrap timing.
     */
    public plan(body: DjSetBody): DjSet {
        const tracks: AnalyzedTrack[] = this.service.enabledTracks();
        const options: DjSetPlannerOptions = this.bodyToOptions(body);
        return new DjSetPlanner(tracks).plan(options);
    }

    private bodyToOptions(body: DjSetBody): DjSetPlannerOptions {
        const options: DjSetPlannerOptions = {};
        if (body.energyDirection !== undefined) {
            options.energyDirection = body.energyDirection;
        }
        if (body.energyShape !== undefined) {
            options.energyShape = body.energyShape;
        }
        if (body.strategy !== undefined) {
            options.strategy = body.strategy;
        }
        if (body.beamWidth !== undefined) {
            options.beamWidth = body.beamWidth;
        }
        if (body.tryAllStarts !== undefined) {
            options.tryAllStarts = body.tryAllStarts;
        }
        if (body.start !== undefined) {
            const start: AnalyzedTrack | null = this.service.findByRef(
                body.start.providerId,
                body.start.path,
            );
            if (start === null) {
                throw new Error(
                    `Start track not found: ${body.start.providerId}/${body.start.path}`,
                );
            }
            options.start = start;
        }
        if (body.targetDurationSec !== undefined) {
            options.targetDurationSec = body.targetDurationSec;
        }
        if (body.style !== undefined) {
            options.style = body.style;
        }
        if (body.avoidSameArtist !== undefined) {
            options.avoidSameArtist = body.avoidSameArtist;
        }
        return options;
    }

    public override getExpressRouter(): Router {
        this._post(
            this._getUrl('v1', 'dj-set', 'plan'),
            false,
            async (_req, _res, data): Promise<DjSetPlanStatus> => {
                return this.start(data.body ?? {});
            },
            {
                description:
                    'Kick off a Camelot-compatible chain plan over the full combined library. '
                    + 'Returns immediately with the running job status; poll '
                    + '`GET /api/v1/dj-set/plan-status` for progress + result.',
                tags: ['dj-set'],
                bodySchema: DjSetBodySchema,
                responseBodySchema: DjSetPlanStatusSchema,
            },
        );
        return super.getExpressRouter();
    }
}