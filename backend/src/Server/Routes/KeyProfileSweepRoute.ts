import { promises as fs } from 'node:fs';
import { join } from 'node:path';
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
 * `POST /api/v1/library/profile-sweep` — runs the configured key-detection profiles against
 * the library's `truth.json`, scores each via MIREX, and returns the ranked report. Results
 * are cached per-profile under `<library>/.keyeval-cache.<profile>.json`, so the second call
 * with the same `(profiles, files)` set is instant; the first call however blocks for as long
 * as essentia takes to analyse every track × every profile (~3s/track each), which can run
 * into minutes for unseen profiles. Frontend warns about that before invoking.
 *
 * Errors out with 400 when `truth.json` is missing/empty/contains no labels resolvable to
 * library files — there's nothing to score against, so no point spinning up the analyser.
 */
export class KeyProfileSweepRoute extends DefaultRoute {

    private readonly service: LibraryService;

    public constructor(service: LibraryService) {
        super();
        this._uriBase = '/api/';
        this.service = service;
    }

    public async run(body: KeyProfileSweepBody): Promise<KeyProfileSweepReport> {
        const libraryDir: string = this.service.getRootDir();
        const truthPath: string = join(libraryDir, TRUTH_FILENAME);

        const truth: Map<string, MusicalKey> = await KeyProfileSweepRoute.loadTruth(truthPath);
        if (truth.size === 0) {
            throw new Error('No key labels found — label some tracks first via the Key Labels page.');
        }

        const truthPathByName: Map<string, string> =
            await KeyProfileSweepRoute.resolveTruthPaths(libraryDir, truth);
        if (truthPathByName.size === 0) {
            throw new Error('Truth labels do not match any files currently in the library.');
        }

        const profiles: readonly string[] = (body.profiles !== undefined
            && body.profiles.length > 0)
            ? body.profiles
            : DEFAULT_PROFILES;

        const sweep: KeyProfileSweep = new KeyProfileSweep(
            libraryDir,
            (profile: string): KeyOnlyAnalyzer =>
                new EssentiaAudioAnalyzer(undefined, undefined, profile),
        );
        return sweep.run(truth, truthPathByName, profiles);
    }

    public override getExpressRouter(): Router {
        this._post(
            this._getUrl('v1', 'library', 'profile-sweep'),
            false,
            async (req, _res, _data): Promise<KeyProfileSweepReport> =>
                this.run(req.body as KeyProfileSweepBody ?? {}),
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
     * Match each truth filename against the actual files on disk. Mirrors the CLI's
     * `KeyEval.resolveTruthPaths` — handles names with or without the `.mp3` extension.
     */
    private static async resolveTruthPaths(
        libraryDir: string,
        truth: ReadonlyMap<string, MusicalKey>,
    ): Promise<Map<string, string>> {
        const entries = await fs.readdir(libraryDir, { withFileTypes: true });
        const byNormalised: Map<string, string> = new Map();
        for (const entry of entries) {
            if (!entry.isFile() || !/\.mp3$/i.test(entry.name)) {
                continue;
            }
            byNormalised.set(
                KeyProfileSweepRoute.normalizeName(entry.name),
                join(libraryDir, entry.name),
            );
        }
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