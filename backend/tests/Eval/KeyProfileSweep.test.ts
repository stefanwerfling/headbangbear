import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MusicalKey } from '../../src/Analysis/schemas.js';
import {
    KeyProfileSweep,
    type KeyOnlyAnalyzer,
    type KeyOnlyAnalyzerFactory
} from '../../src/Eval/KeyProfileSweep.js';

const Aminor: MusicalKey = { tonic: 'A', mode: 'minor' };
const Cmajor: MusicalKey = { tonic: 'C', mode: 'major' };
const Gmajor: MusicalKey = { tonic: 'G', mode: 'major' };
let tmp: string;

beforeEach(async (): Promise<void> => {
    tmp = await mkdtemp(join(tmpdir(), 'hbb-sweep-'));
});

afterEach(async (): Promise<void> => {
    await rm(tmp, { recursive: true, force: true });
});

/**
 * Builds a factory whose returned analyzers count their analyze calls (so we can assert
 * caching skips re-analysis on the second run) and produce deterministic predictions
 * keyed by `(profile, filePath)`.
 */
function stubFactory(
    table: Readonly<Record<string, Readonly<Record<string, MusicalKey>>>>
): { factory: KeyOnlyAnalyzerFactory; calls: { profile: string; filePath: string }[] } {
    const calls: { profile: string; filePath: string }[] = [];
    const factory: KeyOnlyAnalyzerFactory = (profile: string): KeyOnlyAnalyzer => ({
        analyzeKeyOnly: async (filePath: string): Promise<MusicalKey> => {
            calls.push({ profile: profile, filePath: filePath });
            const profileTable: Readonly<Record<string, MusicalKey>> | undefined = table[profile];
            if (profileTable === undefined) {
                throw new Error(`No stub predictions for profile ${profile}`);
            }
            const out: MusicalKey | undefined = profileTable[filePath];
            if (out === undefined) {
                throw new Error(`No stub prediction for ${profile}/${filePath}`);
            }
            return out;
        }
    });
    return { factory: factory, calls: calls };
}

describe('KeyProfileSweep', (): void => {

    it('scores every profile and sorts by MIREX score descending', async (): Promise<void> => {
        const fileA: string = join(tmp, 'a.mp3');
        const fileB: string = join(tmp, 'b.mp3');
        const truth: Map<string, MusicalKey> = new Map([
            ['a', Aminor],
            ['b', Cmajor]
        ]);
        const truthPathByName: Map<string, string> = new Map([
            ['a', fileA],
            ['b', fileB]
        ]);
        const Bminor: MusicalKey = { tonic: 'B', mode: 'minor' };
        const Asharpminor: MusicalKey = { tonic: 'A#', mode: 'minor' };
        const { factory } = stubFactory({
            // bgate: both wrong (no fifth/relative/parallel relation) → 0/2
            bgate: { [fileA]: Bminor, [fileB]: Asharpminor },
            // edmm: both exact → 2/2
            edmm: { [fileA]: Aminor, [fileB]: Cmajor },
            // shaath: 1 exact + 1 fifth → 1.5/2 = 0.75
            shaath: { [fileA]: Aminor, [fileB]: Gmajor }
        });

        const sweep: KeyProfileSweep = new KeyProfileSweep(tmp, factory);
        const report = await sweep.run(truth, truthPathByName, ['bgate', 'edmm', 'shaath']);

        expect(report.rows.map((r): string => r.profile)).toEqual(['edmm', 'shaath', 'bgate']);
        expect(report.bestProfile).toBe('edmm');
        expect(report.rows[0]?.mirexScore).toBe(1.0);
        expect(report.rows[1]?.mirexScore).toBe(0.75);
        expect(report.rows[2]?.mirexScore).toBe(0);
        expect(report.truthSize).toBe(2);
    });

    it('persists per-profile cache and skips re-analysis on the second run', async (): Promise<void> => {
        const fileA: string = join(tmp, 'a.mp3');
        const truth: Map<string, MusicalKey> = new Map([['a', Aminor]]);
        const truthPathByName: Map<string, string> = new Map([['a', fileA]]);
        const { factory, calls } = stubFactory({
            edmm: { [fileA]: Aminor }
        });

        const sweep: KeyProfileSweep = new KeyProfileSweep(tmp, factory);
        await sweep.run(truth, truthPathByName, ['edmm']);
        expect(calls.length).toBe(1);

        const cacheRaw: string = await readFile(join(tmp, '.keyeval-cache.edmm.json'), 'utf8');
        const cache: Record<string, MusicalKey> = JSON.parse(cacheRaw) as Record<string, MusicalKey>;
        expect(cache[fileA]).toEqual(Aminor);

        // Second run: factory must not be invoked again.
        await sweep.run(truth, truthPathByName, ['edmm']);
        expect(calls.length).toBe(1);
    });

    it('returns an empty report when no profiles are requested', async (): Promise<void> => {
        const { factory } = stubFactory({});
        const sweep: KeyProfileSweep = new KeyProfileSweep(tmp, factory);
        const report = await sweep.run(new Map(), new Map(), []);
        expect(report.rows).toEqual([]);
        expect(report.bestProfile).toBe('');
        expect(report.truthSize).toBe(0);
    });

    it('emits per-track progress on every analysis call', async (): Promise<void> => {
        const fileA: string = join(tmp, 'a.mp3');
        const fileB: string = join(tmp, 'b.mp3');
        const truth: Map<string, MusicalKey> = new Map([['a', Aminor], ['b', Cmajor]]);
        const truthPathByName: Map<string, string> = new Map([['a', fileA], ['b', fileB]]);
        const { factory } = stubFactory({
            edmm: { [fileA]: Aminor, [fileB]: Cmajor }
        });
        const events: { profile: string; filePath: string; index: number; total: number }[] = [];
        const sweep: KeyProfileSweep = new KeyProfileSweep(tmp, factory, (e): void => {
            events.push(e);
        });
        await sweep.run(truth, truthPathByName, ['edmm']);
        expect(events).toEqual([
            { profile: 'edmm', filePath: fileA, index: 1, total: 2 },
            { profile: 'edmm', filePath: fileB, index: 2, total: 2 }
        ]);
    });

});