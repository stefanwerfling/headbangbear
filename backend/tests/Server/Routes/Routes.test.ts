import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Camelot } from '../../../src/Analysis/Camelot.js';
import { OpenKey } from '../../../src/Analysis/OpenKey.js';
import type { AnalysisResult, MusicalKey } from '../../../src/Analysis/schemas.js';
import { StubAudioAnalyzer } from '../../../src/Analysis/StubAudioAnalyzer.js';
import { AnalyzedTrackEntity } from '../../../src/Database/Entity/AnalyzedTrackEntity.js';
import { TrackMetadataEntity } from '../../../src/Database/Entity/TrackMetadataEntity.js';
import { TrackLibrary } from '../../../src/Library/TrackLibrary.js';
import { LibraryService } from '../../../src/Server/LibraryService.js';
import { DjSetRoute } from '../../../src/Server/Routes/DjSetRoute.js';
import { LibraryRoute } from '../../../src/Server/Routes/LibraryRoute.js';
import { MixPlanRoute } from '../../../src/Server/Routes/MixPlanRoute.js';
import { TracksCompatibleRoute } from '../../../src/Server/Routes/TracksCompatibleRoute.js';
import { createInMemoryDataSource } from '../../helpers/testDataSource.js';

const PROVIDER_ID: string = 'test-local';
const A_REL: string = 'a.mp3';
const B_REL: string = 'b.mp3';
const C_REL: string = 'c.mp3';

let tmpDir: string;
let ds: DataSource;
let library: TrackLibrary;
let service: LibraryService;

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
    const aAbs: string = join(tmpDir, A_REL);
    const bAbs: string = join(tmpDir, B_REL);
    const cAbs: string = join(tmpDir, C_REL);
    await Promise.all([
        writeFile(aAbs, ''),
        writeFile(bAbs, ''),
        writeFile(cAbs, ''),
    ]);
    const analyzer: StubAudioAnalyzer = new StubAudioAnalyzer();
    analyzer.analyze = async (input): Promise<AnalysisResult> => {
        if (typeof input !== 'string') {
            throw new Error('Stub only handles file paths');
        }
        if (input === aAbs) {
            return buildResult({ tonic: 'A', mode: 'minor' }, 128, 0.3);
        }
        if (input === bAbs) {
            return buildResult({ tonic: 'E', mode: 'minor' }, 130, 0.5);
        }
        if (input === cAbs) {
            return buildResult({ tonic: 'B', mode: 'minor' }, 132, 0.7);
        }
        throw new Error(`Unexpected file: ${input}`);
    };
    ds = await createInMemoryDataSource();
    library = new TrackLibrary(
        PROVIDER_ID,
        tmpDir,
        analyzer,
        ds.getRepository(AnalyzedTrackEntity),
        ds.getRepository(TrackMetadataEntity),
    );
    await library.scan();
    service = LibraryService.override(tmpDir, PROVIDER_ID, library);
});

afterAll(async (): Promise<void> => {
    await ds.destroy();
    await rm(tmpDir, { recursive: true, force: true });
});

describe('LibraryRoute', (): void => {
    it('returns every track in the library with providerId + metadata', (): void => {
        const route: LibraryRoute = new LibraryRoute(service);
        const result = route.list();
        expect(result.tracks).toHaveLength(3);
        const aTrack = result.tracks.find((t): boolean => t.path === A_REL);
        expect(aTrack).toBeDefined();
        expect(aTrack?.providerId).toBe(PROVIDER_ID);
        expect(aTrack?.camelot).toBe('8A');
        expect(aTrack?.openKey).toBe('1m');
        expect(aTrack?.bpm).toBe(128);
    });
});

describe('TracksCompatibleRoute', (): void => {
    it('returns Camelot-compatible tracks sorted by BPM proximity', (): void => {
        const route: TracksCompatibleRoute = new TracksCompatibleRoute(service);
        const result = route.compatible(PROVIDER_ID, A_REL);
        expect(result.track.path).toBe(A_REL);
        expect(result.matches).toHaveLength(1);
        expect(result.matches[0]?.path).toBe(B_REL);
        expect(result.matches[0]?.bpmDelta).toBe(2);
    });

    it('throws when the track is not in the library', (): void => {
        const route: TracksCompatibleRoute = new TracksCompatibleRoute(service);
        expect((): unknown => route.compatible(PROVIDER_ID, 'missing.mp3')).toThrow(/not found/);
    });
});

describe('MixPlanRoute', (): void => {
    it('returns a TransitionPlan for two library tracks', (): void => {
        const route: MixPlanRoute = new MixPlanRoute(service);
        const plan = route.plan(
            { providerId: PROVIDER_ID, path: A_REL },
            { providerId: PROVIDER_ID, path: B_REL },
        );
        expect(plan.from.path).toBe(A_REL);
        expect(plan.from.providerId).toBe(PROVIDER_ID);
        expect(plan.to.path).toBe(B_REL);
        expect(plan.from.camelot).toBe('8A');
        expect(plan.to.camelot).toBe('9A');
        expect(plan.keyMatch).toBe('energy-up');
        expect(plan.alignment).toBe('energy'); // no drops on the stub tracks
    });

    it('throws when the from-track is missing', (): void => {
        const route: MixPlanRoute = new MixPlanRoute(service);
        expect((): unknown => route.plan(
            { providerId: PROVIDER_ID, path: 'nope.mp3' },
            { providerId: PROVIDER_ID, path: B_REL },
        )).toThrow(/From-track not found/);
    });

    it('throws when the to-track is missing', (): void => {
        const route: MixPlanRoute = new MixPlanRoute(service);
        expect((): unknown => route.plan(
            { providerId: PROVIDER_ID, path: A_REL },
            { providerId: PROVIDER_ID, path: 'nope.mp3' },
        )).toThrow(/To-track not found/);
    });
});

describe('DjSetRoute', (): void => {
    it('plans a greedy set with default options', (): void => {
        const route: DjSetRoute = new DjSetRoute(service);
        const set = route.plan({});
        expect(set.tracks.length).toBeGreaterThanOrEqual(2);
        expect(set.energyDirection).toBe('up');
    });

    it('forwards strategy=beam and beamWidth', (): void => {
        const route: DjSetRoute = new DjSetRoute(service);
        const set = route.plan({ strategy: 'beam', beamWidth: 4 });
        // a→b→c covers the chain of 8A→9A→10A.
        expect(set.tracks).toHaveLength(3);
    });

    it('resolves an explicit start TrackRef against the library', (): void => {
        const route: DjSetRoute = new DjSetRoute(service);
        const set = route.plan({
            strategy: 'beam',
            start: { providerId: PROVIDER_ID, path: C_REL },
        });
        expect(set.tracks[0]?.path).toBe(C_REL);
    });

    it('throws on an unknown start ref', (): void => {
        const route: DjSetRoute = new DjSetRoute(service);
        expect((): unknown => route.plan({
            start: { providerId: PROVIDER_ID, path: 'unknown.mp3' },
        })).toThrow(/Start track/);
    });
});