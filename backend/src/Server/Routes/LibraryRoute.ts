import { Router } from 'express';
import { DefaultRoute } from 'figtree';
import type { AnalyzedTrack } from '../../Library/TrackLibrary.js';
import type { LibraryFacade, LibraryService } from '../LibraryService.js';
import {
    LibraryResponseSchema,
    ScanStatusSchema,
    type LibraryResponse,
    type RouteTrack,
    type ScanStatus,
} from '@headbangbear/schemas';

/**
 * `GET /api/v1/library/list` — returns the in-memory analysed track list. Cheap; the
 * scan + cache work happens once on `LibraryService.start()`.
 *
 * `POST /api/v1/library/rescan` — re-runs the disk scan and returns the refreshed list.
 * Useful when new MP3s are dropped into the configured directory while the server is up.
 */
export class LibraryRoute extends DefaultRoute {
    private readonly library: LibraryFacade;

    private readonly libraryDir: string;

    private readonly service: LibraryService;

    public constructor(service: LibraryService) {
        super();
        this._uriBase = '/api/';
        this.service = service;
        this.library = service.getLibrary();
        this.libraryDir = service.getRootDir();
    }

    public list(): LibraryResponse {
        return {
            libraryDir: this.libraryDir,
            tracks: this.library.tracks().map(LibraryRoute.toRouteTrack),
        };
    }

    public async rescan(): Promise<LibraryResponse> {
        await this.service.rescan();
        return this.list();
    }

    public override getExpressRouter(): Router {
        this._get(
            this._getUrl('v1', 'library', 'list'),
            false,
            async (_req, _res, _data): Promise<LibraryResponse> => this.list(),
            {
                description: 'List all analysed tracks in the configured library directory.',
                tags: ['library'],
                responseBodySchema: LibraryResponseSchema,
            },
        );
        this._post(
            this._getUrl('v1', 'library', 'rescan'),
            false,
            async (_req, _res, _data): Promise<LibraryResponse> => this.rescan(),
            {
                description: 'Re-scan the library directory; returns the refreshed list.',
                tags: ['library'],
                responseBodySchema: LibraryResponseSchema,
            },
        );
        this._get(
            this._getUrl('v1', 'library', 'scan-status'),
            false,
            async (_req, _res, _data): Promise<ScanStatus> => this.service.getScanStatus(),
            {
                description: 'Live state of the background library scan (poll while scanning).',
                tags: ['library'],
                responseBodySchema: ScanStatusSchema,
            },
        );
        return super.getExpressRouter();
    }

    public static toRouteTrack(t: AnalyzedTrack): RouteTrack {
        const route: RouteTrack = {
            path: t.path,
            camelot: t.result.camelot.toString(),
            openKey: t.result.openKey.toString(),
            bpm: t.result.bpm,
            energy: t.result.energy,
            durationSec: t.result.durationSec,
            drops: t.result.drops,
            energyTimeline: t.result.energyTimeline,
            beats: t.result.beats,
            hasCover: t.hasCover,
        };
        if (t.metadata !== undefined) {
            route.metadata = t.metadata;
        }
        return route;
    }
}