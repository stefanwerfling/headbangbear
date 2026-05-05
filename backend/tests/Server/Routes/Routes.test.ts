import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Camelot } from '../../../src/Analysis/Camelot.js';
import { OpenKey } from '../../../src/Analysis/OpenKey.js';
import type { AnalysisResult, MusicalKey } from '../../../src/Analysis/schemas.js';
import { StubAudioAnalyzer } from '../../../src/Analysis/StubAudioAnalyzer.js';
import { TrackLibrary } from '../../../src/Library/TrackLibrary.js';
import { LibraryService } from '../../../src/Server/LibraryService.js';
import { DjSetRoute } from '../../../src/Server/Routes/DjSetRoute.js';
import { LibraryRoute } from '../../../src/Server/Routes/LibraryRoute.js';
import { MixPlanRoute } from '../../../src/Server/Routes/MixPlanRoute.js';
import { TracksCompatibleRoute } from '../../../src/Server/Routes/TracksCompatibleRoute.js';

let tmpDir: string;
let library: TrackLibrary;
let aPath: string;
let bPath: string;
let cPath: string;

function buildResult(
    key: MusicalKey,
    bpm: number,
    energy: number,
    durationSec: number = 240,
): AnalysisResult {
    const camelot: Camelot = Camelot.fromKey(key);
    const openKey: OpenKey = OpenKey.fromCamelot(camelot);
    const beatInterval: number = 60 / bpm;
    const beats: number[] = Array.from(
        { length: Math.floor(durationSec / beatInterval) },
        (_, i): number => Math.round(i * beatInterval * 1000) / 1000,
    );
    const energyTimeline: number[] = Array.from(
        { length: Math.floor(durationSec) },
        (): number => energy,
    );
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

beforeAll(async (): Promise<void> => {
    tmpDir = await mkdtemp(join(tmpdir(), 'hbb-routes-'));
    aPath = join(tmpDir, 'a.mp3');
    bPath = join(tmpDir, 'b.mp3');
    cPath = join(tmpDir, 'c.mp3');
    await Promise.all([
        writeFile(aPath, ''),
        writeFile(bPath, ''),
        writeFile(cPath, ''),
    ]);
    // Map each file path to a deterministic stub result via a custom analyzer.
    const analyzer: StubAudioAnalyzer = new StubAudioAnalyzer();
    analyzer.analyze = async (filePath: string): Promise<AnalysisResult> => {
        if (filePath === aPath) {
            return buildResult({ tonic: 'A', mode: 'minor' }, 128, 0.3);
        }
        if (filePath === bPath) {
            return buildResult({ tonic: 'E', mode: 'minor' }, 130, 0.5);
        }
        if (filePath === cPath) {
            return buildResult({ tonic: 'B', mode: 'minor' }, 132, 0.7);
        }
        throw new Error(`Unexpected file: ${filePath}`);
    };
    library = new TrackLibrary(analyzer, join(tmpDir, '.analysis-cache.json'));
    await library.scan(tmpDir);
});

afterAll(async (): Promise<void> => {
    await rm(tmpDir, { recursive: true, force: true });
});

describe('LibraryRoute', (): void => {
    it('returns every track in the library with metadata', (): void => {
        const service: LibraryService = LibraryService.override(tmpDir, library);
        const route: LibraryRoute = new LibraryRoute(service);
        const result = route.list();
        expect(result.libraryDir).toBe(tmpDir);
        expect(result.tracks).toHaveLength(3);
        const aTrack = result.tracks.find((t): boolean => t.path === aPath);
        expect(aTrack).toBeDefined();
        expect(aTrack?.camelot).toBe('8A');
        expect(aTrack?.openKey).toBe('1m');
        expect(aTrack?.bpm).toBe(128);
    });
});

describe('TracksCompatibleRoute', (): void => {
    it('returns Camelot-compatible tracks sorted by BPM proximity', (): void => {
        const route: TracksCompatibleRoute = new TracksCompatibleRoute(library);
        const result = route.compatible(aPath);
        expect(result.track.path).toBe(aPath);
        expect(result.matches).toHaveLength(1);
        expect(result.matches[0]?.path).toBe(bPath);
        expect(result.matches[0]?.bpmDelta).toBe(2);
    });

    it('throws when the track is not in the library', (): void => {
        const route: TracksCompatibleRoute = new TracksCompatibleRoute(library);
        expect((): unknown => route.compatible('/nope/missing.mp3')).toThrow(/not found/);
    });
});

describe('MixPlanRoute', (): void => {
    it('returns a TransitionPlan for two library tracks', (): void => {
        const route: MixPlanRoute = new MixPlanRoute(library);
        const plan = route.plan(aPath, bPath);
        expect(plan.from.path).toBe(aPath);
        expect(plan.to.path).toBe(bPath);
        expect(plan.from.camelot).toBe('8A');
        expect(plan.to.camelot).toBe('9A');
        expect(plan.keyMatch).toBe('energy-up');
        expect(plan.alignment).toBe('energy'); // no drops on the stub tracks
    });

    it('throws when the from-track is missing', (): void => {
        const route: MixPlanRoute = new MixPlanRoute(library);
        expect((): unknown => route.plan('/nope.mp3', bPath)).toThrow(/From-track not found/);
    });

    it('throws when the to-track is missing', (): void => {
        const route: MixPlanRoute = new MixPlanRoute(library);
        expect((): unknown => route.plan(aPath, '/nope.mp3')).toThrow(/To-track not found/);
    });
});

describe('DjSetRoute', (): void => {
    it('plans a greedy set with default options', (): void => {
        const route: DjSetRoute = new DjSetRoute(library);
        const set = route.plan({});
        expect(set.tracks.length).toBeGreaterThanOrEqual(2);
        expect(set.energyDirection).toBe('up');
    });

    it('forwards strategy=beam and beamWidth', (): void => {
        const route: DjSetRoute = new DjSetRoute(library);
        const set = route.plan({ strategy: 'beam', beamWidth: 4 });
        // a→b→c covers the chain of 8A→9A→10A.
        expect(set.tracks).toHaveLength(3);
    });

    it('resolves an explicit startPath against the library', (): void => {
        const route: DjSetRoute = new DjSetRoute(library);
        const set = route.plan({ strategy: 'beam', startPath: cPath });
        expect(set.tracks[0]?.path).toBe(cPath);
    });

    it('throws on an unknown startPath', (): void => {
        const route: DjSetRoute = new DjSetRoute(library);
        expect((): unknown => route.plan({ startPath: '/unknown.mp3' })).toThrow(/Start track/);
    });
});