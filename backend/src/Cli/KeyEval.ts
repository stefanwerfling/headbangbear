import { promises as fs } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DataSource } from 'typeorm';
import { type SchemaErrors } from 'vts';
import { Camelot } from '../Analysis/Camelot.js';
import { EssentiaAudioAnalyzer } from '../Analysis/EssentiaAudioAnalyzer.js';
import { type MusicalKey } from '../Analysis/schemas.js';
import { AnalyzedTrackEntity } from '../Database/Entity/AnalyzedTrackEntity.js';
import { TrackMetadataEntity } from '../Database/Entity/TrackMetadataEntity.js';
import { KeyEvaluator } from '../Eval/KeyEvaluator.js';
import { KeyProfileSweep, type KeyOnlyAnalyzer } from '../Eval/KeyProfileSweep.js';
import {
    KeyTruthFileSchema,
    type KeyEvalReport,
    type KeyProfileSweepReport
} from '../Eval/schemas.js';
import { TrackLibrary, type AnalyzedTrack } from '../Library/TrackLibrary.js';
import { createCliDataSource } from './cliDataSource.js';

const CLI_PROVIDER_ID: string = 'cli';

const DEFAULT_SWEEP_PROFILES: readonly string[] = [
    'bgate', 'temperley', 'krumhansl', 'edmm', 'edma', 'shaath'
];

interface ParsedTruth {
    readonly map: Map<string, MusicalKey>;
    readonly invalid: { readonly name: string; readonly raw: string }[];
}

/**
 * `npm run key-eval -- <library-dir> <truth.json> [--json]` — runs the analyzer
 * over `<library-dir>` and compares the predicted keys against a hand-labelled
 * truth file, printing a MIREX-style report (per-track diff + accuracy summary).
 *
 * Iter 52 retired the legacy JSON cache — predictions now come from a fresh
 * in-memory SQLite DB scan, so each invocation re-analyses the library. That's
 * intentional for a dev tool; truth-label iteration that pays full analysis
 * cost is acceptable on the small evaluation libraries this CLI is aimed at.
 */
export class KeyEval {

    public static async main(argv: readonly string[]): Promise<number> {
        const libraryArg: string | undefined = argv[2];
        const truthArg: string | undefined = argv[3];
        const wantJson: boolean = argv.includes('--json');
        const sweepFlag: boolean = argv.includes('--sweep');
        const profilesArg: string | undefined = argv.find((a: string): boolean => a.startsWith('--profiles='));

        if (libraryArg === undefined || truthArg === undefined) {
            console.error('Usage: key-eval <library-dir> <truth.json> [--json] [--sweep] [--profiles=a,b,c]');
            return 1;
        }

        const libraryDir: string = resolve(libraryArg);
        const truthPath: string = resolve(truthArg);

        let truth: ParsedTruth;
        try {
            truth = await KeyEval.loadTruth(truthPath);
        } catch (err) {
            console.error(err instanceof Error ? err.message : String(err));
            return 1;
        }

        if (truth.invalid.length > 0) {
            for (const bad of truth.invalid) {
                console.error(`Could not parse truth entry "${bad.name}": "${bad.raw}"`);
            }
        }

        if (sweepFlag) {
            const profiles: readonly string[] = profilesArg !== undefined
                ? profilesArg.slice('--profiles='.length).split(',').map((s: string): string => s.trim()).filter((s: string): boolean => s.length > 0)
                : DEFAULT_SWEEP_PROFILES;
            return await KeyEval.runSweep(libraryDir, truth, profiles, wantJson);
        }

        let predictions: Map<string, MusicalKey>;
        try {
            predictions = await KeyEval.loadPredictions(libraryDir);
        } catch (err) {
            console.error(err instanceof Error ? err.message : String(err));
            return 1;
        }

        const report: KeyEvalReport = KeyEvaluator.evaluate(predictions, truth.map);

        if (wantJson) {
            console.log(JSON.stringify(report, null, 2));
        } else {
            KeyEval.printReport(report);
        }
        return 0;
    }

    private static async runSweep(
        libraryDir: string,
        truth: ParsedTruth,
        profiles: readonly string[],
        wantJson: boolean
    ): Promise<number> {
        const truthPathByName: Map<string, string> = await KeyEval.resolveTruthPaths(libraryDir, truth.map);
        if (truthPathByName.size === 0) {
            console.error(`No truth-listed tracks could be matched to files in ${libraryDir}`);
            return 1;
        }
        const sweep: KeyProfileSweep = new KeyProfileSweep(
            libraryDir,
            (profile: string): KeyOnlyAnalyzer => new EssentiaAudioAnalyzer(undefined, profile),
            ({ profile, filePath, index, total }): void => {
                process.stderr.write(`[${profile}] ${index.toString()}/${total.toString()} ${basename(filePath)}\n`);
            }
        );
        const report: KeyProfileSweepReport = await sweep.run(truth.map, truthPathByName, profiles);
        if (wantJson) {
            console.log(JSON.stringify(report, null, 2));
        } else {
            KeyEval.printSweep(report);
        }
        return 0;
    }

    private static async resolveTruthPaths(
        libraryDir: string,
        truth: ReadonlyMap<string, MusicalKey>
    ): Promise<Map<string, string>> {
        const entries = await fs.readdir(libraryDir, { withFileTypes: true });
        const byNormalised: Map<string, string> = new Map();
        for (const entry of entries) {
            if (!entry.isFile() || !/\.mp3$/i.test(entry.name)) {
                continue;
            }
            byNormalised.set(KeyEval.normalizeName(entry.name), join(libraryDir, entry.name));
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

    private static async loadPredictions(libraryDir: string): Promise<Map<string, MusicalKey>> {
        const ds: DataSource = await createCliDataSource();
        try {
            const lib: TrackLibrary = new TrackLibrary(
                CLI_PROVIDER_ID,
                libraryDir,
                new EssentiaAudioAnalyzer(),
                ds.getRepository(AnalyzedTrackEntity),
                ds.getRepository(TrackMetadataEntity),
                (event): void => {
                    if (event.phase === 'analyse') {
                        process.stderr.write(
                            `[${event.current.toString()}/${event.total.toString()}] analyzing ${basename(event.name)}\n`,
                        );
                    }
                },
            );
            const tracks: AnalyzedTrack[] = await lib.scan();
            const map: Map<string, MusicalKey> = new Map();
            for (const track of tracks) {
                map.set(KeyEval.normalizeName(basename(track.path)), track.result.key);
            }
            return map;
        } finally {
            await ds.destroy();
        }
    }

    private static async loadTruth(truthPath: string): Promise<ParsedTruth> {
        let raw: string;
        try {
            raw = await fs.readFile(truthPath, 'utf8');
        } catch {
            throw new Error(`Cannot read truth file: ${truthPath}`);
        }
        const parsed: unknown = JSON.parse(raw);
        const errors: SchemaErrors = [];
        if (!KeyTruthFileSchema.validate(parsed, errors)) {
            throw new Error(`Truth file at ${truthPath} must be a flat object of "filename": "key"`);
        }
        const map: Map<string, MusicalKey> = new Map();
        const invalid: { name: string; raw: string }[] = [];
        for (const [name, label] of Object.entries(parsed as Record<string, string>)) {
            const key: MusicalKey | null = KeyEvaluator.parseKey(label);
            const normalised: string = KeyEval.normalizeName(name);
            if (key === null) {
                invalid.push({ name: normalised, raw: label });
                continue;
            }
            map.set(normalised, key);
        }
        return { map: map, invalid: invalid };
    }

    private static normalizeName(name: string): string {
        return name.replace(/\.mp3$/i, '');
    }

    private static printReport(report: KeyEvalReport): void {
        const formatKey = (k: MusicalKey): string => `${k.tonic} ${k.mode}`;
        const formatRow = (cols: readonly [string, string, string, string, string]): string => {
            return [
                cols[0].padEnd(60),
                cols[1].padEnd(11),
                cols[2].padEnd(11),
                cols[3].padStart(5),
                cols[4]
            ].join('  ');
        };
        console.log(formatRow(['Track', 'Predicted', 'Actual', 'Score', 'Category']));
        console.log('─'.repeat(110));
        for (const e of report.entries) {
            console.log(formatRow([
                e.name.length > 60 ? `${e.name.slice(0, 57)}...` : e.name,
                formatKey(e.predicted),
                formatKey(e.actual),
                e.score.toFixed(2),
                `${e.category}${e.category === 'exact' ? '' : ` (Camelot: ${Camelot.fromKey(e.predicted).toString()} vs ${Camelot.fromKey(e.actual).toString()})`}`
            ]));
        }
        console.log('');
        console.log(`Counts:  exact ${report.counts.exact.toString()}  fifth ${report.counts.fifth.toString()}  relative ${report.counts.relative.toString()}  parallel ${report.counts.parallel.toString()}  wrong ${report.counts.wrong.toString()}`);
        console.log(`Matched: ${report.matched.toString()} truth entries (${report.unmatchedTruth.length.toString()} unmatched)`);
        if (report.unmatchedTruth.length > 0) {
            console.log(`  Unmatched truth: ${report.unmatchedTruth.join(', ')}`);
        }
        console.log(`Untracked predictions (no truth label): ${report.untrackedPredictions.length.toString()}`);
        if (report.untrackedPredictions.length > 0 && report.untrackedPredictions.length <= 10) {
            console.log(`  ${report.untrackedPredictions.join(', ')}`);
        }
        console.log(`MIREX score: ${report.mirexScore.toFixed(4)}`);
    }

    private static printSweep(report: KeyProfileSweepReport): void {
        console.log(`Profile sweep over ${report.truthSize.toString()} truth-labelled tracks`);
        console.log('');
        const formatRow = (cols: readonly [string, string, string, string, string, string, string, string]): string => {
            return [
                cols[0].padEnd(14),
                cols[1].padStart(7),
                cols[2].padStart(6),
                cols[3].padStart(6),
                cols[4].padStart(4),
                cols[5].padStart(4),
                cols[6].padStart(6),
                cols[7].padStart(8)
            ].join('  ');
        };
        console.log(formatRow(['Profile', 'Matched', 'Exact', 'Fifth', 'Rel', 'Par', 'Wrong', 'MIREX']));
        console.log('─'.repeat(80));
        for (const row of report.rows) {
            console.log(formatRow([
                row.profile,
                row.matched.toString(),
                row.counts.exact.toString(),
                row.counts.fifth.toString(),
                row.counts.relative.toString(),
                row.counts.parallel.toString(),
                row.counts.wrong.toString(),
                row.mirexScore.toFixed(4)
            ]));
        }
        console.log('');
        console.log(`Best profile: ${report.bestProfile}`);
    }

}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    void KeyEval.main(process.argv).then((code: number): void => {
        process.exit(code);
    });
}