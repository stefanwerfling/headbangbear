import { Router } from 'express';
import { DefaultRoute } from 'figtree';
import {
    DjSetPlanner,
    DjSetSchema,
    type DjSet,
    type DjSetPlannerOptions,
} from '../../DjSet/DjSetPlanner.js';
import type { AnalyzedTrack, TrackLibrary } from '../../Library/TrackLibrary.js';
import { DjSetBodySchema, type DjSetBody } from '../schemas.js';

/**
 * `POST /api/v1/dj-set` — runs `DjSetPlanner` over the entire library and returns the
 * resulting set. Body fields all map 1:1 to `DjSetPlannerOptions`. The optional
 * `startPath` is resolved against the library before planning.
 */
export class DjSetRoute extends DefaultRoute {
    private readonly library: TrackLibrary;

    public constructor(library: TrackLibrary) {
        super();
        this._uriBase = '/api/';
        this.library = library;
    }

    public plan(body: DjSetBody): DjSet {
        const tracks: AnalyzedTrack[] = this.library.tracks();
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
        if (body.startPath !== undefined) {
            const start: AnalyzedTrack | null = this.library.findByPath(body.startPath);
            if (start === null) {
                throw new Error(`Start track not found in library: ${body.startPath}`);
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
        return new DjSetPlanner(tracks).plan(options);
    }

    public override getExpressRouter(): Router {
        this._post(
            this._getUrl('v1', 'dj-set', 'plan'),
            false,
            async (_req, _res, data): Promise<DjSet> => {
                return this.plan(data.body ?? {});
            },
            {
                description:
                    'Plan a Camelot-compatible chain over the full library. Defaults: strategy=greedy, energyDirection=up, tryAllStarts=true.',
                tags: ['dj-set'],
                bodySchema: DjSetBodySchema,
                responseBodySchema: DjSetSchema,
            },
        );
        return super.getExpressRouter();
    }
}