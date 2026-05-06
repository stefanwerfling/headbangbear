import { promises as fs } from 'node:fs';
import { join, sep } from 'node:path';
import { Router } from 'express';
import { DefaultRoute } from 'figtree';
import {
    KeyProfileSweepBodySchema,
    KeyProfileSweepReportSchema,
    type KeyProfileSweepBody,
    type KeyProfileSweepReport,
} from '@headbangbear/schemas';
import { type SchemaErrors } from 'vts';
import { EssentiaAudioAnalyzer } from '../../Analysis/EssentiaAudioAnalyzer.js';
import type { MusicalKey } from '../../Analysis/schemas.js';
import { KeyEvaluator } from '../../Eval/KeyEvaluator.js';
import { KeyProfileSweep, type KeyOnlyAnalyzer } from '../../Eval/KeyProfileSweep.js';
import { KeyTruthFileSchema, type KeyTruthFile } from '../../Eval/schemas.js';
import type { LibraryService } from '../LibraryService.js';

const TRUTH_FILENAME: string = 'truth.json';

/** Same default set the `KeyEval` CLI uses without `--profiles=...`. */
const DEFAULT_PROFILES: readonly string[] = [
    'bgate', 'temperley', 'krumhansl', 'edmm', 'edma', 'shaath',
];

/**
 * `POST /api/v1/library/profile-sweep` — runs the configured key-detection profiles
 * against a single local provider's `truth.json`, scores each via MIREX, returns
 * the ranked report. Per-profile cache lives at
 * `<rootDir>/.keyeval-cache.<profile>.json` so the second call is instant.
 *
 * Sweeps only apply to `local`-kind providers — Jellyfin tracks have no on-disk
 * audio for re-analysis. Caller picks via `body.providerId`.
 */
export class KeyProfileSweepRoute extends DefaultRoute {

    private readonly service: LibraryService;

    public constructor(service: LibraryService) {
        super();
        this._uriBase = '/api/';
        this.service = service;
    }

    public async run(body: KeyProfileSweepBody): Promise<KeyProfileSweepReport> {
        const rootDir: string | null = this.service.getLocalRootDir(body.providerId);
        if (rootDir === null) {
            throw new Error(`Provider not local or unknown: ${body.providerId}`);
        }
        const truthPath: string = join(rootDir, TRUTH_FILENAME);

        const truth: Map<string, MusicalKey> = await KeyProfileSweepRoute.loadTruth(truthPath);
        if (truth.size === 0) {
            throw new Error('No key labels found — label some tracks first via the Key Labels page.');
        }

        const truthPathByName: Map<string, string> =
            await KeyProfileSweepRoute.resolveTruthPaths(rootDir, truth);
        if (truthPathByName.size === 0) {
            throw new Error('Truth labels do not match any files currently in the library.');
        }

        const profiles: readonly string[] = (body.profiles !== undefined
            && body.profiles.length > 0)
            ? body.profiles
            : DEFAULT_PROFILES;

        const sweep: KeyProfileSweep = new KeyProfileSweep(
            rootDir,
            (profile: string): KeyOnlyAnalyzer =>
                new EssentiaAudioAnalyzer(undefined, profile),
        );
        return sweep.run(truth, truthPathByName, profiles);
    }

    public override getExpressRouter(): Router {
        this._post(
            this._getUrl('v1', 'library', 'profile-sweep'),
            false,
            async (req, _res, _data): Promise<KeyProfileSweepReport> =>
                this.run(req.body as KeyProfileSweepBody),
            {
                description: 'Run key-detection profile sweep over truth.json. Slow on first call.',
                tags: ['library'],
                bodySchema: KeyProfileSweepBodySchema,
                responseBodySchema: KeyProfileSweepReportSchema,
            },
        );
        return super.getExpressRouter();
    }

    private static async loadTruth(truthPath: string): Promise<Map<string, MusicalKey>> {
        let raw: string;
        try {
            raw = await fs.readFile(truthPath, 'utf8');
        } catch {
            return new Map();
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch {
            return new Map();
        }
        const errors: SchemaErrors = [];
        if (!KeyTruthFileSchema.validate(parsed, errors)) {
            return new Map();
        }
        const file: KeyTruthFile = parsed;
        const map: Map<string, MusicalKey> = new Map();
        for (const [name, label] of Object.entries(file)) {
            const key: MusicalKey | null = KeyEvaluator.parseKey(label);
            if (key === null) {
                continue;
            }
            map.set(KeyProfileSweepRoute.normalizeName(name), key);
        }
        return map;
    }

    /**
     * Match each truth path against the files actually under `rootDir`. Recursive walk —
     * mirrors `TrackLibrary.findAudioFiles` so the same files visible to the analyser
     * are visible here. Truth keys are matched both with and without the `.mp3`
     * extension to mirror the CLI's permissive `KeyEval.resolveTruthPaths`.
     */
    private static async resolveTruthPaths(
        rootDir: string,
        truth: ReadonlyMap<string, MusicalKey>,
    ): Promise<Map<string, string>> {
        const byNormalised: Map<string, string> = new Map();
        const walk = async (d: string): Promise<void> => {
            const entries = await fs.readdir(d, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.name.startsWith('.')) {
                    continue;
                }
                const p: string = join(d, entry.name);
                if (entry.isDirectory()) {
                    await walk(p);
                } else if (entry.isFile() && /\.mp3$/i.test(entry.name)) {
                    const rel: string = sep === '/'
                        ? p.slice(rootDir.length + 1)
                        : p.slice(rootDir.length + 1).split(sep).join('/');
                    byNormalised.set(KeyProfileSweepRoute.normalizeName(rel), p);
                    byNormalised.set(KeyProfileSweepRoute.normalizeName(entry.name), p);
                }
            }
        };
        await walk(rootDir);
        const out: Map<string, string> = new Map();
        for (const name of truth.keys()) {
            const filePath: string | undefined = byNormalised.get(name);
            if (filePath !== undefined) {
                out.set(name, filePath);
            }
        }
        return out;
    }

    private static normalizeName(name: string): string {
        return name.replace(/\.mp3$/i, '');
    }

}