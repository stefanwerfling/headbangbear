import { Router } from 'express';
import { DefaultRoute } from 'figtree';
import type { AnalyzedTrack } from '../../Library/TrackLibrary.js';
import type { LibraryService } from '../LibraryService.js';
import {
    LibraryResponseSchema,
    ScanStatusSchema,
    type LibraryResponse,
    type RouteTrack,
    type ScanStatus,
} from '@headbangbear/schemas';

/**
 * `GET /api/v1/library/list` — returns the in-memory analysed track list **across
 * every configured provider**. Each track carries its own `providerId` so the
 * frontend can dispatch per-track API calls (audio, cover, mix) back to the
 * right provider.
 *
 * `POST /api/v1/library/rescan` — re-runs the disk / Jellyfin scan for every
 * provider sequentially and returns the refreshed combined list.
 *
 * `GET /api/v1/library/scan-status` — current scan progress (which provider, which
 * track within that provider, etc.).
 */
export class LibraryRoute extends DefaultRoute {

    private readonly service: LibraryService;

    public constructor(service: LibraryService) {
        super();
        this._uriBase = '/api/';
        this.service = service;
    }

    public list(): LibraryResponse {
        return {
            tracks: this.service.allTracks().map(LibraryRoute.toRouteTrack),
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
                description: 'List all analysed tracks across every configured provider.',
                tags: ['library'],
                responseBodySchema: LibraryResponseSchema,
            },
        );
        this._post(
            this._getUrl('v1', 'library', 'rescan'),
            false,
            async (_req, _res, _data): Promise<LibraryResponse> => this.rescan(),
            {
                description: 'Re-scan every configured provider; returns the refreshed list.',
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
            providerId: t.providerId,
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
            disabled: t.disabled,
        };
        if (t.metadata !== undefined) {
            route.metadata = t.metadata;
        }
        return route;
    }
}