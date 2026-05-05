import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { Vts, type ExtractSchemaResultType, type SchemaErrors } from 'vts';
import { MusicalKeySchema, type MusicalKey } from '../Analysis/schemas.js';
import { KeyEvaluator } from './KeyEvaluator.js';
import type { KeyEvalReport, KeyProfileSweepReport, KeyProfileSweepRow } from './schemas.js';

/**
 * The minimum we need from an analyser to score a single profile against a track. The
 * production wiring uses `EssentiaAudioAnalyzer.analyzeKeyOnly`; tests inject a deterministic
 * stub. Defining the contract structurally (no `extends`/`implements`) keeps this module
 * independent of which audio backend is in play.
 */
export interface KeyOnlyAnalyzer {
    analyzeKeyOnly(filePath: string): Promise<MusicalKey>;
}

export type KeyOnlyAnalyzerFactory = (profileType: string) => KeyOnlyAnalyzer;

const ProfileCacheSchema = Vts.object2(Vts.string(), MusicalKeySchema);
type ProfileCache = ExtractSchemaResultType<typeof ProfileCacheSchema>;

export type SweepProgressFn = (info: { profile: string; filePath: string; index: number; total: number }) => void;

/**
 * Runs every requested essentia `profileType` against the truth-listed tracks, scores each
 * profile against the user's labels, and reports them sorted by MIREX score.
 *
 * Per-profile predictions are cached on disk at `.keyeval-cache.<profile>.json` so subsequent
 * sweeps are instant. Cache invalidation is left to the user (delete the file) — sweeps are
 * rare and the audio files don't change underneath.
 */
export class KeyProfileSweep {

    private readonly libraryDir: string;

    private readonly factory: KeyOnlyAnalyzerFactory;

    private readonly onProgress: SweepProgressFn | undefined;

    public constructor(
        libraryDir: string,
        factory: KeyOnlyAnalyzerFactory,
        onProgress?: SweepProgressFn,
    ) {
        this.libraryDir = libraryDir;
        this.factory = factory;
        this.onProgress = onProgress;
    }

    public async run(
        truth: ReadonlyMap<string, MusicalKey>,
        truthPathByName: ReadonlyMap<string, string>,
        profiles: readonly string[]
    ): Promise<KeyProfileSweepReport> {
        const rows: KeyProfileSweepRow[] = [];
        for (const profile of profiles) {
            const predictions: Map<string, MusicalKey> = await this.predictionsFor(
                profile,
                truthPathByName
            );
            const report: KeyEvalReport = KeyEvaluator.evaluate(predictions, truth);
            rows.push({
                profile: profile,
                matched: report.matched,
                counts: report.counts,
                mirexScore: report.mirexScore
            });
        }
        rows.sort((a: KeyProfileSweepRow, b: KeyProfileSweepRow): number => b.mirexScore - a.mirexScore);
        const bestProfile: string = rows.length === 0 ? '' : rows[0]?.profile ?? '';
        return {
            rows: rows,
            bestProfile: bestProfile,
            truthSize: truth.size
        };
    }

    private async predictionsFor(
        profile: string,
        truthPathByName: ReadonlyMap<string, string>
    ): Promise<Map<string, MusicalKey>> {
        const cachePath: string = this.cachePathFor(profile);
        const cached: ProfileCache = await KeyProfileSweep.loadCache(cachePath);
        const predictions: Map<string, MusicalKey> = new Map();
        const missing: { name: string; filePath: string }[] = [];
        for (const [name, filePath] of truthPathByName.entries()) {
            const hit: MusicalKey | undefined = cached[filePath];
            if (hit !== undefined) {
                predictions.set(name, hit);
            } else {
                missing.push({ name: name, filePath: filePath });
            }
        }
        if (missing.length === 0) {
            return predictions;
        }
        const analyzer: KeyOnlyAnalyzer = this.factory(profile);
        let i: number = 0;
        for (const { name, filePath } of missing) {
            i += 1;
            if (this.onProgress !== undefined) {
                this.onProgress({ profile: profile, filePath: filePath, index: i, total: missing.length });
            }
            const key: MusicalKey = await analyzer.analyzeKeyOnly(filePath);
            cached[filePath] = key;
            predictions.set(name, key);
        }
        await KeyProfileSweep.saveCache(cachePath, cached);
        return predictions;
    }

    private cachePathFor(profile: string): string {
        return join(this.libraryDir, `.keyeval-cache.${profile}.json`);
    }

    private static async loadCache(path: string): Promise<ProfileCache> {
        let raw: string;
        try {
            raw = await fs.readFile(path, 'utf8');
        } catch {
            return {};
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch {
            return {};
        }
        const errors: SchemaErrors = [];
        if (!ProfileCacheSchema.validate(parsed, errors)) {
            return {};
        }
        return parsed;
    }

    private static async saveCache(path: string, cache: ProfileCache): Promise<void> {
        await fs.writeFile(path, JSON.stringify(cache, null, 2), 'utf8');
    }

}