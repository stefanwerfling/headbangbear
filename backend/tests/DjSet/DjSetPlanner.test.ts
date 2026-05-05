import { describe, expect, it } from 'vitest';
import { Camelot } from '../../src/Analysis/Camelot.js';
import { OpenKey } from '../../src/Analysis/OpenKey.js';
import type { AnalysisResult, MusicalKey } from '../../src/Analysis/schemas.js';
import { DjSetPlanner, type DjSet } from '../../src/DjSet/DjSetPlanner.js';
import type { AnalyzedTrack } from '../../src/Library/TrackLibrary.js';

interface BuildOpts {
    path: string;
    key: MusicalKey;
    bpm: number;
    energy: number;
    durationSec?: number;
}

function buildTrack(opts: BuildOpts): AnalyzedTrack {
    const camelot: Camelot = Camelot.fromKey(opts.key);
    const openKey: OpenKey = OpenKey.fromCamelot(camelot);
    const durationSec: number = opts.durationSec ?? 240;
    const beatInterval: number = 60 / opts.bpm;
    const beatCount: number = Math.floor(durationSec / beatInterval);
    const beats: number[] = Array.from(
        { length: beatCount },
        (_, i): number => Math.round(i * beatInterval * 1000) / 1000,
    );
    const energyTimeline: number[] = Array.from(
        { length: Math.floor(durationSec) },
        (): number => opts.energy,
    );
    const result: AnalysisResult = {
        key: opts.key,
        camelot: camelot,
        openKey: openKey,
        bpm: opts.bpm,
        energy: opts.energy,
        durationSec: durationSec,
        beats: beats,
        energyTimeline: energyTimeline,
        drops: [],
    };
    return { path: opts.path, result: result, hasCover: false };
}

describe('DjSetPlanner', (): void => {
    describe('edge cases', (): void => {
        it('returns an empty set for an empty pool', (): void => {
            const result: DjSet = new DjSetPlanner([]).plan();
            expect(result.tracks).toEqual([]);
            expect(result.transitions).toEqual([]);
            expect(result.skipped).toEqual([]);
            expect(result.energyDirection).toBe('up');
        });

        it('returns a single-track set with no transitions', (): void => {
            const t: AnalyzedTrack = buildTrack({
                path: 'a',
                key: { tonic: 'A', mode: 'minor' },
                bpm: 128,
                energy: 0.4,
            });
            const result: DjSet = new DjSetPlanner([t]).plan();
            expect(result.tracks).toHaveLength(1);
            expect(result.transitions).toHaveLength(0);
            expect(result.skipped).toHaveLength(0);
        });
    });

    describe('greedy ordering', (): void => {
        it('chains compatible tracks in ascending energy by default', (): void => {
            const low: AnalyzedTrack = buildTrack({
                path: 'low',
                key: { tonic: 'A', mode: 'minor' }, // 8A
                bpm: 124,
                energy: 0.2,
            });
            const mid: AnalyzedTrack = buildTrack({
                path: 'mid',
                key: { tonic: 'E', mode: 'minor' }, // 9A (8A↔9A compatible)
                bpm: 126,
                energy: 0.5,
            });
            const high: AnalyzedTrack = buildTrack({
                path: 'high',
                key: { tonic: 'B', mode: 'minor' }, // 10A (9A↔10A compatible)
                bpm: 128,
                energy: 0.8,
            });
            const result: DjSet = new DjSetPlanner([high, low, mid]).plan();
            expect(result.tracks.map((t): string => t.path)).toEqual(['low', 'mid', 'high']);
            expect(result.transitions).toHaveLength(2);
            expect(result.skipped).toHaveLength(0);
        });

        it('descends when energyDirection is "down"', (): void => {
            const low: AnalyzedTrack = buildTrack({
                path: 'low',
                key: { tonic: 'A', mode: 'minor' },
                bpm: 124,
                energy: 0.2,
            });
            const mid: AnalyzedTrack = buildTrack({
                path: 'mid',
                key: { tonic: 'A', mode: 'minor' },
                bpm: 126,
                energy: 0.5,
            });
            const high: AnalyzedTrack = buildTrack({
                path: 'high',
                key: { tonic: 'A', mode: 'minor' },
                bpm: 128,
                energy: 0.8,
            });
            const result: DjSet = new DjSetPlanner([low, mid, high]).plan({
                energyDirection: 'down',
            });
            expect(result.tracks.map((t): string => t.path)).toEqual(['high', 'mid', 'low']);
        });

        it('skips tracks that cannot be reached via Camelot rules', (): void => {
            const a: AnalyzedTrack = buildTrack({
                path: 'a',
                key: { tonic: 'A', mode: 'minor' }, // 8A
                bpm: 128,
                energy: 0.2,
            });
            const compatible: AnalyzedTrack = buildTrack({
                path: 'compat',
                key: { tonic: 'E', mode: 'minor' }, // 9A
                bpm: 128,
                energy: 0.5,
            });
            const stranger: AnalyzedTrack = buildTrack({
                path: 'stranger',
                key: { tonic: 'F#', mode: 'major' }, // 1B — not compatible with 8A or 9A
                bpm: 128,
                energy: 0.7,
            });
            const result: DjSet = new DjSetPlanner([a, compatible, stranger]).plan();
            expect(result.tracks.map((t): string => t.path)).toEqual(['a', 'compat']);
            expect(result.skipped.map((t): string => t.path)).toEqual(['stranger']);
        });

        it('honours an explicit start track', (): void => {
            const a: AnalyzedTrack = buildTrack({
                path: 'a',
                key: { tonic: 'A', mode: 'minor' },
                bpm: 124,
                energy: 0.2,
            });
            const b: AnalyzedTrack = buildTrack({
                path: 'b',
                key: { tonic: 'A', mode: 'minor' },
                bpm: 126,
                energy: 0.5,
            });
            const c: AnalyzedTrack = buildTrack({
                path: 'c',
                key: { tonic: 'A', mode: 'minor' },
                bpm: 128,
                energy: 0.8,
            });
            const result: DjSet = new DjSetPlanner([a, b, c]).plan({ start: c });
            expect(result.tracks[0]?.path).toBe('c');
        });

        it('breaks ties on energy with smaller BPM delta', (): void => {
            const start: AnalyzedTrack = buildTrack({
                path: 'start',
                key: { tonic: 'A', mode: 'minor' },
                bpm: 128,
                energy: 0.5,
            });
            const sameEnergyFar: AnalyzedTrack = buildTrack({
                path: 'far',
                key: { tonic: 'A', mode: 'minor' },
                bpm: 140,
                energy: 0.5,
            });
            const sameEnergyClose: AnalyzedTrack = buildTrack({
                path: 'close',
                key: { tonic: 'A', mode: 'minor' },
                bpm: 130,
                energy: 0.5,
            });
            const result: DjSet = new DjSetPlanner([start, sameEnergyFar, sameEnergyClose]).plan({
                energyDirection: 'either',
            });
            expect(result.tracks.map((t): string => t.path)).toEqual(['start', 'close', 'far']);
        });

        it('falls back to wrong-direction candidate when nothing else is left', (): void => {
            // Only one compatible track exists, and it's lower-energy than the start.
            // With direction='up' it should still be picked rather than stranded.
            const start: AnalyzedTrack = buildTrack({
                path: 'start',
                key: { tonic: 'A', mode: 'minor' },
                bpm: 128,
                energy: 0.8,
            });
            const onlyCompatible: AnalyzedTrack = buildTrack({
                path: 'down',
                key: { tonic: 'A', mode: 'minor' },
                bpm: 128,
                energy: 0.3,
            });
            const result: DjSet = new DjSetPlanner([start, onlyCompatible]).plan({ start: start });
            expect(result.tracks.map((t): string => t.path)).toEqual(['start', 'down']);
            expect(result.skipped).toHaveLength(0);
        });
    });

    describe('transitions', (): void => {
        it('emits one TransitionPlan per consecutive pair', (): void => {
            const a: AnalyzedTrack = buildTrack({
                path: '/lib/a.mp3',
                key: { tonic: 'A', mode: 'minor' },
                bpm: 128,
                energy: 0.3,
            });
            const b: AnalyzedTrack = buildTrack({
                path: '/lib/b.mp3',
                key: { tonic: 'A', mode: 'minor' },
                bpm: 128,
                energy: 0.6,
            });
            const result: DjSet = new DjSetPlanner([a, b]).plan();
            expect(result.transitions).toHaveLength(1);
            const transition = result.transitions[0];
            expect(transition).toBeDefined();
            expect(transition?.from.path).toBe('/lib/a.mp3');
            expect(transition?.to.path).toBe('/lib/b.mp3');
        });
    });
});