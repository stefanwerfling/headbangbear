import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { Router } from 'express';
import { DefaultRoute } from 'figtree';
import {
    KeyLabelsBodySchema,
    KeyLabelsQuerySchema,
    KeyLabelsResponseSchema,
    type KeyLabelEntry,
    type KeyLabelsBody,
    type KeyLabelsResponse,
} from '@headbangbear/schemas';
import type { LibraryService } from '../LibraryService.js';

const TRUTH_FILENAME: string = 'truth.json';

/**
 * Reads / writes per-local-provider `<rootDir>/truth.json` — the ground-truth
 * file consumed by the existing `KeyEval` CLI. Letting the frontend write to it
 * directly turns the labelling chore from "open a JSON file in an editor" into
 * "click through tracks in the browser, save, run sweep".
 *
 * Wire format is `{ labels: [{ providerId, path, key }] }` — the `providerId`
 * round-trips so the frontend's per-provider tab knows which entries belong to
 * which library.
 *
 * On-disk format remains the legacy `{ filename: keyString }` map (one file per
 * provider), so existing `npm run key-eval -- <library> <truth.json>` keeps
 * working. `path` is the per-provider source-id i.e. relative path under
 * `rootDir` — that matches what `KeyEval` already expects.
 *
 * Jellyfin providers are accepted in the GET query and return `{ labels: [] }`
 * (no on-disk truth file makes sense without local audio).
 */
export class KeyLabelsRoute extends DefaultRoute {

    private readonly service: LibraryService;

    public constructor(service: LibraryService) {
        super();
        this._uriBase = '/api/';
        this.service = service;
    }

    public async list(providerId: string): Promise<KeyLabelsResponse> {
        const rootDir: string | null = this.service.getLocalRootDir(providerId);
        if (rootDir === null) {
            return { labels: [] };
        }
        const filePath: string = join(rootDir, TRUTH_FILENAME);
        let raw: string;
        try {
            raw = await fs.readFile(filePath, 'utf8');
        } catch {
            return { labels: [] };
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch {
            return { labels: [] };
        }
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return { labels: [] };
        }
        const labels: KeyLabelEntry[] = [];
        for (const [path, key] of Object.entries(parsed as Record<string, unknown>)) {
            if (typeof key !== 'string' || key.length === 0) {
                continue;
            }
            labels.push({ providerId: providerId, path: path, key: key });
        }
        labels.sort((a, b): number => a.path.localeCompare(b.path));
        return { labels: labels };
    }

    public async save(body: KeyLabelsBody): Promise<KeyLabelsResponse> {
        const rootDir: string | null = this.service.getLocalRootDir(body.providerId);
        if (rootDir === null) {
            throw new Error(`Provider not local or unknown: ${body.providerId}`);
        }
        const map: Record<string, string> = {};
        for (const entry of body.labels) {
            if (entry.providerId !== body.providerId) {
                continue;
            }
            const key: string = entry.key.trim();
            if (key.length === 0) {
                continue;
            }
            map[entry.path] = key;
        }
        const sortedMap: Record<string, string> = {};
        for (const path of Object.keys(map).sort((a, b): number => a.localeCompare(b))) {
            sortedMap[path] = map[path] as string;
        }
        await fs.writeFile(
            join(rootDir, TRUTH_FILENAME),
            `${JSON.stringify(sortedMap, null, 2)}\n`,
            'utf8',
        );
        return this.list(body.providerId);
    }

    public override getExpressRouter(): Router {
        this._get(
            this._getUrl('v1', 'library', 'key-labels'),
            false,
            async (_req, _res, data): Promise<KeyLabelsResponse> => {
                const providerId: string | undefined = data.query?.providerId;
                if (providerId === undefined) {
                    throw new Error('Missing required query parameter: providerId');
                }
                return this.list(providerId);
            },
            {
                description: 'Ground-truth key labels for a local provider (truth.json).',
                tags: ['library'],
                querySchema: KeyLabelsQuerySchema,
                responseBodySchema: KeyLabelsResponseSchema,
            },
        );
        this._post(
            this._getUrl('v1', 'library', 'key-labels'),
            false,
            async (req, _res, _data): Promise<KeyLabelsResponse> =>
                this.save(req.body as KeyLabelsBody),
            {
                description: 'Replace the ground-truth key labels for the given provider.',
                tags: ['library'],
                bodySchema: KeyLabelsBodySchema,
                responseBodySchema: KeyLabelsResponseSchema,
            },
        );
        return super.getExpressRouter();
    }

}