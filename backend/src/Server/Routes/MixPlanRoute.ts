import { Router } from 'express';
import { DefaultRoute } from 'figtree';
import type { TrackRef, TransitionStyle } from '@headbangbear/schemas';
import type { AnalyzedTrack } from '../../Library/TrackLibrary.js';
import { MixTransition, type TransitionPlan } from '../../Mix/MixTransition.js';
import type { LibraryService } from '../LibraryService.js';
import { MixPlanBodySchema, MixPlanResponseSchema } from '@headbangbear/schemas';

/**
 * `POST /api/v1/mix/plan` — given two library tracks (each as a `(providerId, path)`
 * reference), returns the full transition plan: cue points, mix duration, key match,
 * drop alignment.
 */
export class MixPlanRoute extends DefaultRoute {

    private readonly service: LibraryService;

    public constructor(service: LibraryService) {
        super();
        this._uriBase = '/api/';
        this.service = service;
    }

    public plan(from: TrackRef, to: TrackRef, style?: TransitionStyle): TransitionPlan {
        const fromTrack: AnalyzedTrack | null = this.service.findByRef(from.providerId, from.path);
        const toTrack: AnalyzedTrack | null = this.service.findByRef(to.providerId, to.path);
        if (fromTrack === null) {
            throw new Error(`From-track not found: ${from.providerId}/${from.path}`);
        }
        if (toTrack === null) {
            throw new Error(`To-track not found: ${to.providerId}/${to.path}`);
        }
        return new MixTransition(fromTrack, toTrack).plan({ style: style });
    }

    public override getExpressRouter(): Router {
        this._post(
            this._getUrl('v1', 'mix', 'plan'),
            false,
            async (_req, _res, data): Promise<TransitionPlan> => {
                if (data.body === undefined) {
                    throw new Error('Missing request body');
                }
                return this.plan(data.body.from, data.body.to, data.body.style);
            },
            {
                description: 'Plan an A→B transition between two library tracks (cross-provider OK).',
                tags: ['mix'],
                bodySchema: MixPlanBodySchema,
                responseBodySchema: MixPlanResponseSchema,
            },
        );
        return super.getExpressRouter();
    }
}