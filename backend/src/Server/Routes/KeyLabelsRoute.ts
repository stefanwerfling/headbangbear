import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { Router } from 'express';
import { DefaultRoute } from 'figtree';
import {
    KeyLabelsBodySchema,
    KeyLabelsResponseSchema,
    type KeyLabelEntry,
    type KeyLabelsBody,
    type KeyLabelsResponse,
} from '@headbangbear/schemas';
import type { LibraryService } from '../LibraryService.js';

const TRUTH_FILENAME: string = 'truth.json';

/**
 * Reads / writes `<library>/truth.json` — the ground-truth file consumed by the existing
 * `KeyEval` CLI (`npm run key-eval -- <library> <truth.json>`). Letting the frontend write
 * to it directly turns the labelling chore from "open a JSON file in an editor" into
 * "click through tracks in the browser, save, run sweep" — the only reason the
 * `KeyProfileSweep` infra has been sitting unused.
 *
 * On-disk format is a flat `{ filename: keyString }` map; the wire format is the same
 * data as a `{ labels: [{ filename, key }] }` array. POST replaces the file wholesale —
 * empty `key` strings are treated as "no label" and dropped from the on-disk map.
 *
 * `GET` 200 even when truth.json is missing — returns `{ labels: [] }` so the frontend
 * can boot with a clean slate.
 */
export class KeyLabelsRoute extends DefaultRoute {

    private readonly service: LibraryService;

    public constructor(service: LibraryService) {
        super();
        this._uriBase = '/api/';
        this.service = service;
    }

    public async list(): Promise<KeyLabelsResponse> {
        const filePath: string = this.truthPath();
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
        for (const [filename, key] of Object.entries(parsed as Record<string, unknown>)) {
            if (typeof key !== 'string' || key.length === 0) {
                continue;
            }
            labels.push({ filename: filename, key: key });
        }
        labels.sort((a, b): number => a.filename.localeCompare(b.filename));
        return { labels: labels };
    }

    public async save(body: KeyLabelsBody): Promise<KeyLabelsResponse> {
        const map: Record<string, string> = {};
        for (const entry of body.labels) {
            const key: string = entry.key.trim();
            if (key.length === 0) {
                continue;
            }
            map[entry.filename] = key;
        }
        const sortedMap: Record<string, string> = {};
        for (const filename of Object.keys(map).sort((a, b): number => a.localeCompare(b))) {
            sortedMap[filename] = map[filename] as string;
        }
        await fs.writeFile(this.truthPath(), `${JSON.stringify(sortedMap, null, 2)}\n`, 'utf8');
        return this.list();
    }

    public override getExpressRouter(): Router {
        this._get(
            this._getUrl('v1', 'library', 'key-labels'),
            false,
            async (_req, _res, _data): Promise<KeyLabelsResponse> => this.list(),
            {
                description: 'Return the current ground-truth key labels (truth.json).',
                tags: ['library'],
                responseBodySchema: KeyLabelsResponseSchema,
            },
        );
        this._post(
            this._getUrl('v1', 'library', 'key-labels'),
            false,
            async (req, _res, _data): Promise<KeyLabelsResponse> =>
                this.save(req.body as KeyLabelsBody),
            {
                description: 'Replace the ground-truth key labels (writes truth.json).',
                tags: ['library'],
                bodySchema: KeyLabelsBodySchema,
                responseBodySchema: KeyLabelsResponseSchema,
            },
        );
        return super.getExpressRouter();
    }

    private truthPath(): string {
        return join(this.service.getRootDir(), TRUTH_FILENAME);
    }

}
