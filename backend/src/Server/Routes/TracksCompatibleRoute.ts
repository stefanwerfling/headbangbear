import { Router } from 'express';
import { DefaultRoute } from 'figtree';
import type { AnalyzedTrack, TrackLibrary } from '../../Library/TrackLibrary.js';
import { LibraryRoute } from './LibraryRoute.js';
import {
    CompatibleQuerySchema,
    CompatibleResponseSchema,
    type CompatibleMatch,
    type CompatibleResponse,
} from '../schemas.js';

/**
 * `GET /api/v1/tracks/compatible?path=<abs-path>` — for the given track, returns every
 * Camelot-compatible track in the library, sorted by ascending BPM delta.
 */
export class TracksCompatibleRoute extends DefaultRoute {
    private readonly library: TrackLibrary;

    public constructor(library: TrackLibrary) {
        super();
        this._uriBase = '/api/';
        this.library = library;
    }

    public compatible(trackPath: string): CompatibleResponse {
        const track: AnalyzedTrack | null = this.library.findByPath(trackPath);
        if (track === null) {
            throw new Error(`Track not found in library: ${trackPath}`);
        }
        const matches: AnalyzedTrack[] = this.library.compatible(track);
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
                const path: string | undefined = data.query?.path;
                if (path === undefined) {
                    throw new Error('Missing required query parameter: path');
                }
                return this.compatible(path);
            },
            {
                description: 'Camelot-compatible tracks for a given library entry, sorted by BPM proximity.',
                tags: ['tracks'],
                querySchema: CompatibleQuerySchema,
                responseBodySchema: CompatibleResponseSchema,
            },
        );
        return super.getExpressRouter();
    }
}