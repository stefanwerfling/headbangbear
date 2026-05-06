import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DataSource, Repository } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AudioAnalyzer } from '../../src/Analysis/AudioAnalyzer.js';
import { Camelot } from '../../src/Analysis/Camelot.js';
import { OpenKey } from '../../src/Analysis/OpenKey.js';
import type { AnalysisResult, MusicalKey } from '../../src/Analysis/schemas.js';
import { AnalyzedTrackEntity } from '../../src/Database/Entity/AnalyzedTrackEntity.js';
import { TrackMetadataEntity } from '../../src/Database/Entity/TrackMetadataEntity.js';
import { TrackLibrary, type AnalyzedTrack } from '../../src/Library/TrackLibrary.js';
import { createInMemoryDataSource } from '../helpers/testDataSource.js';

const PROVIDER_ID: string = 'test-local';

class FakeAnalyzer extends AudioAnalyzer {
    public callCount: number = 0;

    private readonly results: ReadonlyMap<string, AnalysisResult>;

    public constructor(results: ReadonlyMap<string, AnalysisResult>) {
        super();
        this.results = results;
    }

    public override analyze(filePath: string): Promise<AnalysisResult> {
        this.callCount += 1;
        if (typeof filePath !== 'string') {
            return Promise.reject(new Error('FakeAnalyzer only handles file-path inputs'));
        }
        const r: AnalysisResult | undefined = this.results.get(filePath);
        if (r === undefined) {
            return Promise.reject(new Error(`No fixture for ${filePath}`));
        }
        return Promise.resolve(r);
    }
}

function buildResult(key: MusicalKey, bpm: number, energy: number = 0.5): AnalysisResult {
    const camelot: Camelot = Camelot.fromKey(key);
    const openKey: OpenKey = OpenKey.fromCamelot(camelot);
    const durationSec: number = 200;
    const beatInterval: number = 60 / bpm;
    const beatCount: number = Math.floor(durationSec / beatInterval);
    const beats: number[] = Array.from({ length: beatCount }, (_, i): number => i * beatInterval);
    const energyTimeline: number[] = new Array<number>(durationSec).fill(energy);
    return {
        key: key,
        camelot: camelot,
        openKey: openKey,
        bpm: bpm,
        energy: energy,
        durationSec: durationSec,
        beats: beats,
        energyTimeline: energyTimeline,
        drops: [],
    };
}

describe('TrackLibrary', (): void => {
    let dir: string;
    let ds: DataSource;
    let trackRepo: Repository<AnalyzedTrackEntity>;
    let metaRepo: Repository<TrackMetadataEntity>;

    beforeEach(async (): Promise<void> => {
        dir = await fs.mkdtemp(join(tmpdir(), 'hbb-library-'));
        ds = await createInMemoryDataSource();
        trackRepo = ds.getRepository(AnalyzedTrackEntity);
        metaRepo = ds.getRepository(TrackMetadataEntity);
    });

    afterEach(async (): Promise<void> => {
        await ds.destroy();
        await fs.rm(dir, { recursive: true, force: true });
    });

    async function writeFakeMp3(name: string, bytes: number = 16): Promise<string> {
        const filePath: string = join(dir, name);
        await fs.writeFile(filePath, Buffer.alloc(bytes));
        return filePath;
    }

    function newLib(analyzer: FakeAnalyzer): TrackLibrary {
        return new TrackLibrary(PROVIDER_ID, dir, analyzer, trackRepo, metaRepo);
    }

    it('analyzes every mp3 in a directory on first scan', async (): Promise<void> => {
        const a: string = await writeFakeMp3('a.mp3');
        const b: string = await writeFakeMp3('b.mp3');
        const fixtures: Map<string, AnalysisResult> = new Map([
            [a, buildResult({ tonic: 'A', mode: 'minor' }, 128)],
            [b, buildResult({ tonic: 'C', mode: 'major' }, 122)],
        ]);
        const analyzer: FakeAnalyzer = new FakeAnalyzer(fixtures);
        const lib: TrackLibrary = newLib(analyzer);

        const tracks: AnalyzedTrack[] = await lib.scan();

        expect(tracks).toHaveLength(2);
        expect(analyzer.callCount).toBe(2);
        expect(tracks.map((t): string => t.result.camelot.toString()).sort()).toEqual(['8A', '8B']);
        expect(tracks.every((t): boolean => t.providerId === PROVIDER_ID)).toBe(true);
    });

    it('reuses DB rows on a second scan when file mtime+size unchanged', async (): Promise<void> => {
        await writeFakeMp3('a.mp3');
        const abs: string = join(dir, 'a.mp3');
        const fixtures: Map<string, AnalysisResult> = new Map([
            [abs, buildResult({ tonic: 'A', mode: 'minor' }, 128)],
        ]);
        const analyzer: FakeAnalyzer = new FakeAnalyzer(fixtures);

        await newLib(analyzer).scan();
        expect(analyzer.callCount).toBe(1);

        await newLib(analyzer).scan();
        expect(analyzer.callCount).toBe(1);
    });

    it('re-analyzes a file whose size changed', async (): Promise<void> => {
        const a: string = await writeFakeMp3('a.mp3', 16);
        const fixtures: Map<string, AnalysisResult> = new Map([
            [a, buildResult({ tonic: 'A', mode: 'minor' }, 128)],
        ]);
        const analyzer: FakeAnalyzer = new FakeAnalyzer(fixtures);
        const lib: TrackLibrary = newLib(analyzer);

        await lib.scan();
        expect(analyzer.callCount).toBe(1);

        await fs.writeFile(a, Buffer.alloc(32));
        await lib.scan();
        expect(analyzer.callCount).toBe(2);
    });

    it('deserializes DB rows back into Camelot and OpenKey instances', async (): Promise<void> => {
        const a: string = await writeFakeMp3('a.mp3');
        const fixtures: Map<string, AnalysisResult> = new Map([
            [a, buildResult({ tonic: 'A', mode: 'minor' }, 128)],
        ]);

        await newLib(new FakeAnalyzer(fixtures)).scan();

        const tracks: AnalyzedTrack[] = await newLib(new FakeAnalyzer(new Map())).scan();
        const track: AnalyzedTrack | undefined = tracks[0];
        expect(track).toBeDefined();
        expect(track?.result.camelot).toBeInstanceOf(Camelot);
        expect(track?.result.openKey).toBeInstanceOf(OpenKey);
        expect(track?.result.camelot.compatibleKeys().map((c): string => c.toString())).toEqual([
            '8A',
            '8B',
            '9A',
            '7A',
        ]);
    });

    it('prunes DB rows for files that disappeared from disk', async (): Promise<void> => {
        const a: string = await writeFakeMp3('a.mp3');
        const b: string = await writeFakeMp3('b.mp3');
        const fixtures: Map<string, AnalysisResult> = new Map([
            [a, buildResult({ tonic: 'A', mode: 'minor' }, 128)],
            [b, buildResult({ tonic: 'C', mode: 'major' }, 122)],
        ]);
        await newLib(new FakeAnalyzer(fixtures)).scan();
        expect(await trackRepo.count()).toBe(2);

        await fs.unlink(b);
        await newLib(new FakeAnalyzer(fixtures)).scan();
        expect(await trackRepo.count()).toBe(1);
        const remaining: AnalyzedTrackEntity[] = await trackRepo.find();
        expect(remaining[0]?.sourceId).toBe('a.mp3');
    });

    it('compatible() returns Camelot-compatible tracks excluding the input', async (): Promise<void> => {
        const aMinor: string = await writeFakeMp3('a-minor.mp3');
        const cMajor: string = await writeFakeMp3('c-major.mp3');
        const aMinorOther: string = await writeFakeMp3('a-minor-other.mp3');
        const eMinor: string = await writeFakeMp3('e-minor.mp3');
        const fSharpMajor: string = await writeFakeMp3('f-sharp-major.mp3');

        const fixtures: Map<string, AnalysisResult> = new Map([
            [aMinor, buildResult({ tonic: 'A', mode: 'minor' }, 128)],
            [cMajor, buildResult({ tonic: 'C', mode: 'major' }, 124)],
            [aMinorOther, buildResult({ tonic: 'A', mode: 'minor' }, 130)],
            [eMinor, buildResult({ tonic: 'E', mode: 'minor' }, 126)],
            [fSharpMajor, buildResult({ tonic: 'F#', mode: 'major' }, 140)],
        ]);
        const lib: TrackLibrary = newLib(new FakeAnalyzer(fixtures));
        await lib.scan();

        const aMinorTrack: AnalyzedTrack | null = lib.findByPath('a-minor.mp3');
        expect(aMinorTrack).not.toBeNull();
        const matches: AnalyzedTrack[] = lib.compatible(aMinorTrack!);

        const matchPaths: string[] = matches.map((t): string => t.path);
        expect(matchPaths).toEqual(['a-minor-other.mp3', 'e-minor.mp3', 'c-major.mp3']);
        expect(matchPaths).not.toContain('a-minor.mp3');
        expect(matchPaths).not.toContain('f-sharp-major.mp3');
    });

    it('sorts compatible() by BPM proximity', async (): Promise<void> => {
        const seed: string = await writeFakeMp3('seed.mp3');
        const close: string = await writeFakeMp3('close.mp3');
        const far: string = await writeFakeMp3('far.mp3');

        const fixtures: Map<string, AnalysisResult> = new Map([
            [seed, buildResult({ tonic: 'A', mode: 'minor' }, 128)],
            [close, buildResult({ tonic: 'A', mode: 'minor' }, 130)],
            [far, buildResult({ tonic: 'A', mode: 'minor' }, 90)],
        ]);
        const lib: TrackLibrary = newLib(new FakeAnalyzer(fixtures));
        await lib.scan();

        const matches: AnalyzedTrack[] = lib.compatible(lib.findByPath('seed.mp3')!);
        expect(matches.map((t): string => t.path)).toEqual(['close.mp3', 'far.mp3']);
    });
});