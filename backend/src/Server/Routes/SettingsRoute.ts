import { Router } from 'express';
import { DefaultRoute } from 'figtree';
import {
    JellyfinTestBodySchema,
    JellyfinTestResultSchema,
    SettingsBodySchema,
    SettingsSchema,
    type JellyfinTestBody,
    type JellyfinTestResult,
    type Settings,
    type SettingsBody,
} from '@headbangbear/schemas';
import { JellyfinClient } from '../../Provider/JellyfinClient.js';
import { SettingsStore } from '../../Settings/SettingsStore.js';

/**
 * Settings management endpoints.
 *
 *  - `GET  /api/v1/settings` — returns the persisted settings (or defaults if no save
 *    has happened yet). The frontend uses it to seed the form on first paint.
 *  - `POST /api/v1/settings` — replaces the persisted settings wholesale (no patching).
 *  - `POST /api/v1/settings/jellyfin/test` — connection probe. Lets the user verify a
 *    set of credentials from the Settings form *without* saving them, so a typo doesn't
 *    overwrite working settings. Body shape mirrors `JellyfinSettings`.
 */
export class SettingsRoute extends DefaultRoute {

    private readonly store: SettingsStore;

    public constructor(store: SettingsStore) {
        super();
        this._uriBase = '/api/';
        this.store = store;
    }

    public async list(): Promise<Settings> {
        return this.store.load();
    }

    public async save(body: SettingsBody): Promise<Settings> {
        await this.store.save(body);
        return this.store.load();
    }

    public async testJellyfin(body: JellyfinTestBody): Promise<JellyfinTestResult> {
        const client: JellyfinClient = new JellyfinClient(body);
        return client.testConnection();
    }

    public override getExpressRouter(): Router {
        this._get(
            this._getUrl('v1', 'settings', 'state'),
            false,
            async (_req, _res, _data): Promise<Settings> => this.list(),
            {
                description: 'Read the persisted application settings (or defaults).',
                tags: ['settings'],
                responseBodySchema: SettingsSchema,
            },
        );
        this._post(
            this._getUrl('v1', 'settings', 'state'),
            false,
            async (req, _res, _data): Promise<Settings> =>
                this.save(req.body as SettingsBody),
            {
                description: 'Replace the persisted application settings.',
                tags: ['settings'],
                bodySchema: SettingsBodySchema,
                responseBodySchema: SettingsSchema,
            },
        );
        this._post(
            this._getUrl('v1', 'settings', 'jellyfin-test'),
            false,
            async (req, _res, _data): Promise<JellyfinTestResult> =>
                this.testJellyfin(req.body as JellyfinTestBody),
            {
                description: 'Probe a Jellyfin server with the supplied credentials. Does not save.',
                tags: ['settings'],
                bodySchema: JellyfinTestBodySchema,
                responseBodySchema: JellyfinTestResultSchema,
            },
        );
        return super.getExpressRouter();
    }

}