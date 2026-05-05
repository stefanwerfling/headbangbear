import { Router } from 'express';
import { DefaultRoute } from 'figtree';
import type { TransitionStyle } from '@headbangbear/schemas';
import type { AnalyzedTrack, TrackLibrary } from '../../Library/TrackLibrary.js';
import { MixTransition, type TransitionPlan } from '../../Mix/MixTransition.js';
import { MixPlanBodySchema, MixPlanResponseSchema } from '../schemas.js';

/**
 * `POST /api/v1/mix/plan` — given two library tracks, returns the full transition plan
 * (cue points, mix duration, key match, drop alignment).
 */
export class MixPlanRoute extends DefaultRoute {
    private readonly library: TrackLibrary;

    public constructor(library: TrackLibrary) {
        super();
        this._uriBase = '/api/';
        this.library = library;
    }

    public plan(fromPath: string, toPath: string, style?: TransitionStyle): TransitionPlan {
        const from: AnalyzedTrack | null = this.library.findByPath(fromPath);
        const to: AnalyzedTrack | null = this.library.findByPath(toPath);
        if (from === null) {
            throw new Error(`From-track not found in library: ${fromPath}`);
        }
        if (to === null) {
            throw new Error(`To-track not found in library: ${toPath}`);
        }
        return new MixTransition(from, to).plan({ style: style });
    }

    public override getExpressRouter(): Router {
        this._post(
            this._getUrl('v1', 'mix', 'plan'),
            false,
            async (_req, _res, data): Promise<TransitionPlan> => {
                if (data.body === undefined) {
                    throw new Error('Missing request body');
                }
                return this.plan(data.body.fromPath, data.body.toPath, data.body.style);
            },
            {
                description: 'Plan an A→B transition between two library tracks.',
                tags: ['mix'],
                bodySchema: MixPlanBodySchema,
                responseBodySchema: MixPlanResponseSchema,
            },
        );
        return super.getExpressRouter();
    }
}