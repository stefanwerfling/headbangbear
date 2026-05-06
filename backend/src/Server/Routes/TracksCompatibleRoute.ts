import { Router } from 'express';
import { DefaultRoute } from 'figtree';
import type { AnalyzedTrack } from '../../Library/TrackLibrary.js';
import type { LibraryService } from '../LibraryService.js';
import { LibraryRoute } from './LibraryRoute.js';
import {
    CompatibleQuerySchema,
    CompatibleResponseSchema,
    type CompatibleMatch,
    type CompatibleResponse,
} from '@headbangbear/schemas';

/**
 * `GET /api/v1/tracks/compatible?providerId=<id>&path=<source-id>` — for the given
 * track, returns every Camelot-compatible track in the **combined** library
 * (across all providers), sorted by ascending BPM delta.
 */
export class TracksCompatibleRoute extends DefaultRoute {

    private readonly service: LibraryService;

    public constructor(service: LibraryService) {
        super();
        this._uriBase = '/api/';
        this.service = service;
    }

    public compatible(providerId: string, trackPath: string): CompatibleResponse {
        const track: AnalyzedTrack | null = this.service.findByRef(providerId, trackPath);
        if (track === null) {
            throw new Error(`Track not found in library: ${providerId}/${trackPath}`);
        }
        const matches: AnalyzedTrack[] = this.service.compatibleAcross(track);
        return {
            track: LibraryRoute.toRouteTrack(track),
            matches: matches.map(
                (m: AnalyzedTrack): CompatibleMatch => ({
                    ...LibraryRoute.toRouteTrack(m),
                    bpmDelta: Math.round((m.result.bpm - track.result.bpm) * 10) / 10,
                }),
            ),
        };
    }

    public override getExpressRouter(): Router {
        this._get(
            this._getUrl('v1', 'tracks', 'compatible'),
            false,
            async (_req, _res, data): Promise<CompatibleResponse> => {
                const providerId: string | undefined = data.query?.providerId;
                const path: string | undefined = data.query?.path;
                if (providerId === undefined || path === undefined) {
                    throw new Error('Missing required query parameters: providerId, path');
                }
                return this.compatible(providerId, path);
            },
            {
                description: 'Camelot-compatible tracks for a given library entry, across all providers.',
                tags: ['tracks'],
                querySchema: CompatibleQuerySchema,
                responseBodySchema: CompatibleResponseSchema,
            },
        );
        return super.getExpressRouter();
    }
}