import { describe, expect, it } from 'vitest';
import { Camelot } from '../../src/Analysis/Camelot.js';
import { OpenKey } from '../../src/Analysis/OpenKey.js';
import type { AnalysisResult, MusicalKey } from '../../src/Analysis/schemas.js';
import type { AnalyzedTrack } from '../../src/Library/TrackLibrary.js';
import { MixTransition, type TransitionPlan } from '../../src/Mix/MixTransition.js';

interface BuildOpts {
    path: string;
    key: MusicalKey;
    bpm: number;
    durationSec: number;
    /** Index in the energy timeline (seconds) where the track first hits full loudness. */
    introEndsAtSec?: number;
    /** Index in the energy timeline (seconds) where the track last hits full loudness. */
    outroStartsAtSec?: number;
    /** Drop timestamps in seconds. */
    drops?: number[];
}

function buildTrack(opts: BuildOpts): AnalyzedTrack {
    const camelot: Camelot = Camelot.fromKey(opts.key);
    const openKey: OpenKey = OpenKey.fromCamelot(camelot);
    const beatInterval: number = 60 / opts.bpm;
    const beatCount: number = Math.floor(opts.durationSec / beatInterval);
    const beats: number[] = Array.from(
        { length: beatCount },
        (_, i): number => Math.round(i * beatInterval * 1000) / 1000,
    );
    const introEnd: number = opts.introEndsAtSec ?? 0;
    const outroStart: number = opts.outroStartsAtSec ?? opts.durationSec;
    const energyTimeline: number[] = [];
    for (let s = 0; s < Math.floor(opts.durationSec); s++) {
        if (s < introEnd) {
            energyTimeline.push(0.05);
        } else if (s >= outroStart) {
            energyTimeline.push(0.05);
        } else {
            energyTimeline.push(0.5);
        }
    }
    const result: AnalysisResult = {
        key: opts.key,
        camelot: camelot,
        openKey: openKey,
        bpm: opts.bpm,
        energy: 0.5,
        durationSec: opts.durationSec,
        beats: beats,
        energyTimeline: energyTimeline,
        drops: opts.drops ?? [],
    };
    return { providerId: 'test', path: opts.path, result: result, hasCover: false, disabled: false };
}

describe('MixTransition', (): void => {
    describe('pitch shift', (): void => {
        it('is zero when both tracks have the same BPM', (): void => {
            const a: AnalyzedTrack = buildTrack({
                path: 'a',
                key: { tonic: 'A', mode: 'minor' },
                bpm: 128,
                durationSec: 240,
            });
            const b: AnalyzedTrack = buildTrack({
                path: 'b',
                key: { tonic: 'A', mode: 'minor' },
                bpm: 128,
                durationSec: 240,
            });
            const plan: TransitionPlan = new MixTransition(a, b).plan();
            expect(plan.to.pitchPercent).toBe(0);
            expect(plan.to.resultingBpm).toBe(128);
        });

        it('positive when destination is slower than source', (): void => {
            const a: AnalyzedTrack = buildTrack({
                path: 'a',
                key: { tonic: 'A', mode: 'minor' },
                bpm: 130,
                durationSec: 240,
            });
            const b: AnalyzedTrack = buildTrack({
                path: 'b',
                key: { tonic: 'A', mode: 'minor' },
                bpm: 125,
                durationSec: 240,
            });
            const plan: TransitionPlan = new MixTransition(a, b).plan();
            // (130/125 - 1) * 100 = 4
            expect(plan.to.pitchPercent).toBe(4);
            expect(plan.to.resultingBpm).toBe(130);
        });

        it('warns when pitch exceeds ±6%', (): void => {
            const a: AnalyzedTrack = buildTrack({
                path: 'a',
                key: { tonic: 'A', mode: 'minor' },
                bpm: 140,
                durationSec: 240,
            });
            const b: AnalyzedTrack = buildTrack({
                path: 'b',
                key: { tonic: 'A', mode: 'minor' },
                bpm: 120,
                durationSec: 240,
            });
            const plan: TransitionPlan = new MixTransition(a, b).plan();
            expect(plan.to.pitchPercent).toBeCloseTo(16.67, 1);
            expect(plan.notes.some((n): boolean => /Pitch shift/.test(n))).toBe(true);
        });
    });

    describe('keyMatch classification', (): void => {
        it('identical for the same Camelot code', (): void => {
            const a: AnalyzedTrack = buildTrack({
                path: 'a',
                key: { tonic: 'A', mode: 'minor' },
                bpm: 128,
                durationSec: 240,
            });
            const plan: TransitionPlan = new MixTransition(a, a).plan();
            expect(plan.keyMatch).toBe('identical');
        });

        it('relative for opposite letter, same number (8A↔8B)', (): void => {
            const a: AnalyzedTrack = buildTrack({
                path: 'a',
                key: { tonic: 'A', mode: 'minor' },
                bpm: 128,
                durationSec: 240,
            });
            const b: AnalyzedTrack = buildTrack({
                path: 'b',
                key: { tonic: 'C', mode: 'major' },
                bpm: 128,
                durationSec: 240,
            });
            expect(new MixTransition(a, b).plan().keyMatch).toBe('relative');
        });

        it('energy-up for +1 same letter (8A→9A)', (): void => {
            const a: AnalyzedTrack = buildTrack({
                path: 'a',
                key: { tonic: 'A', mode: 'minor' },
                bpm: 128,
                durationSec: 240,
            });
            const b: AnalyzedTrack = buildTrack({
                path: 'b',
                key: { tonic: 'E', mode: 'minor' },
                bpm: 128,
                durationSec: 240,
            });
            expect(new MixTransition(a, b).plan().keyMatch).toBe('energy-up');
        });

        it('energy-down for -1 same letter (8A→7A)', (): void => {
            const a: AnalyzedTrack = buildTrack({
                path: 'a',
                key: { tonic: 'A', mode: 'minor' },
                bpm: 128,
                durationSec: 240,
            });
            const b: AnalyzedTrack = buildTrack({
                path: 'b',
                key: { tonic: 'D', mode: 'minor' },
                bpm: 128,
                durationSec: 240,
            });
            expect(new MixTransition(a, b).plan().keyMatch).toBe('energy-down');
        });

        it('incompatible for non-Camelot-compatible pair', (): void => {
            const a: AnalyzedTrack = buildTrack({
                path: 'a',
                key: { tonic: 'A', mode: 'minor' },
                bpm: 128,
                durationSec: 240,
            });
            const b: AnalyzedTrack = buildTrack({
                path: 'b',
                key: { tonic: 'F#', mode: 'major' },
                bpm: 128,
                durationSec: 240,
            });
            const plan: TransitionPlan = new MixTransition(a, b).plan();
            expect(plan.keyMatch).toBe('incompatible');
            expect(plan.notes.some((n): boolean => /not Camelot-compatible/.test(n))).toBe(true);
        });
    });

    describe('cue points and mix duration', (): void => {
        it('aligns cueOut to a bar boundary near A’s last loud second', (): void => {
            // 128 BPM, 4 beats/bar = 1.875 sec/bar. 240s track, last 30s quiet.
            const a: AnalyzedTrack = buildTrack({
                path: 'a',
                key: { tonic: 'A', mode: 'minor' },
                bpm: 128,
                durationSec: 240,
                introEndsAtSec: 10,
                outroStartsAtSec: 210,
            });
            const b: AnalyzedTrack = buildTrack({
                path: 'b',
                key: { tonic: 'A', mode: 'minor' },
                bpm: 128,
                durationSec: 240,
                introEndsAtSec: 30,
                outroStartsAtSec: 210,
            });
            const plan: TransitionPlan = new MixTransition(a, b).plan();

            // last loud sec ~210 in A; mix duration aims for 16 bars = 30s; cueOut ≈ 180 bar-snapped
            expect(plan.cueOutSec).toBeGreaterThan(170);
            expect(plan.cueOutSec).toBeLessThan(210);
            expect(plan.cueInSec).toBe(0);
            expect(plan.mixBars).toBeGreaterThanOrEqual(8);
            expect(plan.mixBars).toBeLessThanOrEqual(16);
        });

        it('shortens mix to fit B’s short intro', (): void => {
            // B's intro is only 4 seconds → about 2 bars at 128 BPM
            const a: AnalyzedTrack = buildTrack({
                path: 'a',
                key: { tonic: 'A', mode: 'minor' },
                bpm: 128,
                durationSec: 240,
                introEndsAtSec: 5,
                outroStartsAtSec: 200,
            });
            const b: AnalyzedTrack = buildTrack({
                path: 'b',
                key: { tonic: 'A', mode: 'minor' },
                bpm: 128,
                durationSec: 240,
                introEndsAtSec: 4,
                outroStartsAtSec: 230,
            });
            const plan: TransitionPlan = new MixTransition(a, b).plan();
            // floor mix is MIN_MIX_BARS=8, so the natural shortening can only go to 8 bars
            expect(plan.mixBars).toBe(8);
        });
    });

    describe('plan output shape', (): void => {
        it('serialises camelot codes as strings', (): void => {
            const a: AnalyzedTrack = buildTrack({
                path: '/lib/a.mp3',
                key: { tonic: 'A', mode: 'minor' },
                bpm: 128,
                durationSec: 240,
            });
            const b: AnalyzedTrack = buildTrack({
                path: '/lib/b.mp3',
                key: { tonic: 'C', mode: 'major' },
                bpm: 124,
                durationSec: 220,
            });
            const plan: TransitionPlan = new MixTransition(a, b).plan();
            expect(plan.from.camelot).toBe('8A');
            expect(plan.to.camelot).toBe('8B');
            expect(plan.from.path).toBe('/lib/a.mp3');
            expect(plan.to.path).toBe('/lib/b.mp3');
        });
    });

    describe('drop alignment', (): void => {
        it('aligns A’s last drop with B’s first drop when both are present', (): void => {
            // 128 BPM → bar = 1.875s, 16 bars = 30s lead-in.
            // A drop at 180s, B drop at 40s, both with ample runway.
            const a: AnalyzedTrack = buildTrack({
                path: 'a',
                key: { tonic: 'A', mode: 'minor' },
                bpm: 128,
                durationSec: 240,
                drops: [180],
            });
            const b: AnalyzedTrack = buildTrack({
                path: 'b',
                key: { tonic: 'A', mode: 'minor' },
                bpm: 128,
                durationSec: 240,
                drops: [40],
            });
            const plan: TransitionPlan = new MixTransition(a, b).plan();
            expect(plan.alignment).toBe('drop');
            // cueOut ≈ 150 (180 - 30), cueIn ≈ 10 (40 - 30); both bar-snapped.
            expect(plan.cueOutSec).toBeGreaterThan(148);
            expect(plan.cueOutSec).toBeLessThan(152);
            expect(plan.cueInSec).toBeGreaterThan(8);
            expect(plan.cueInSec).toBeLessThan(12);
            expect(plan.mixBars).toBeGreaterThanOrEqual(15.5);
            expect(plan.mixBars).toBeLessThanOrEqual(16.5);
            expect(plan.notes.some((n): boolean => /Drop-aligned/.test(n))).toBe(true);
        });

        it('shortens lead-in when B’s drop is too close to the start', (): void => {
            // B's drop at 20s: max wall lead-in = 20s ≈ 10.7 bars at 128 BPM, above the 8-bar floor.
            const a: AnalyzedTrack = buildTrack({
                path: 'a',
                key: { tonic: 'A', mode: 'minor' },
                bpm: 128,
                durationSec: 240,
                drops: [180],
            });
            const b: AnalyzedTrack = buildTrack({
                path: 'b',
                key: { tonic: 'A', mode: 'minor' },
                bpm: 128,
                durationSec: 240,
                drops: [20],
            });
            const plan: TransitionPlan = new MixTransition(a, b).plan();
            expect(plan.alignment).toBe('drop');
            expect(plan.mixBars).toBeGreaterThanOrEqual(8);
            expect(plan.mixBars).toBeLessThan(16);
            expect(plan.cueInSec).toBeGreaterThanOrEqual(0);
            expect(plan.cueInSec).toBeLessThan(4);
            expect(plan.notes.some((n): boolean => /Lead-in shortened/.test(n))).toBe(true);
        });

        it('falls back to energy alignment when one track has no drops', (): void => {
            const a: AnalyzedTrack = buildTrack({
                path: 'a',
                key: { tonic: 'A', mode: 'minor' },
                bpm: 128,
                durationSec: 240,
                introEndsAtSec: 10,
                outroStartsAtSec: 210,
                drops: [180],
            });
            const b: AnalyzedTrack = buildTrack({
                path: 'b',
                key: { tonic: 'A', mode: 'minor' },
                bpm: 128,
                durationSec: 240,
                introEndsAtSec: 30,
                outroStartsAtSec: 210,
                drops: [],
            });
            const plan: TransitionPlan = new MixTransition(a, b).plan();
            expect(plan.alignment).toBe('energy');
            expect(plan.notes.some((n): boolean => /Drop-aligned/.test(n))).toBe(false);
        });

        it('falls back to energy alignment when B’s drop is below the min lead-in', (): void => {
            // 8 bars at 128 BPM = 15s. B's drop at 10s leaves no room for the floor.
            const a: AnalyzedTrack = buildTrack({
                path: 'a',
                key: { tonic: 'A', mode: 'minor' },
                bpm: 128,
                durationSec: 240,
                introEndsAtSec: 5,
                outroStartsAtSec: 210,
                drops: [180],
            });
            const b: AnalyzedTrack = buildTrack({
                path: 'b',
                key: { tonic: 'A', mode: 'minor' },
                bpm: 128,
                durationSec: 240,
                introEndsAtSec: 30,
                outroStartsAtSec: 210,
                drops: [10],
            });
            const plan: TransitionPlan = new MixTransition(a, b).plan();
            expect(plan.alignment).toBe('energy');
        });

        it('accounts for pitch ratio when projecting B’s drop into wall time', (): void => {
            // A 130 BPM, B 100 BPM → pitchRatio 1.3. Without pitch compensation the cueIn
            // would be at ~B-drop − 30s ≈ 50s. With compensation it must be at ~50 − 30·0.3 ≈ 41s.
            const a: AnalyzedTrack = buildTrack({
                path: 'a',
                key: { tonic: 'A', mode: 'minor' },
                bpm: 130,
                durationSec: 240,
                drops: [100],
            });
            const b: AnalyzedTrack = buildTrack({
                path: 'b',
                key: { tonic: 'A', mode: 'minor' },
                bpm: 100,
                durationSec: 240,
                drops: [80],
            });
            const plan: TransitionPlan = new MixTransition(a, b).plan();
            expect(plan.alignment).toBe('drop');
            // Pitch-compensated cueIn must land well below the naive cueIn (~50s).
            expect(plan.cueInSec).toBeLessThan(46);
            expect(plan.cueInSec).toBeGreaterThan(36);
        });

        it('uses last drop for A and first drop for B', (): void => {
            const a: AnalyzedTrack = buildTrack({
                path: 'a',
                key: { tonic: 'A', mode: 'minor' },
                bpm: 128,
                durationSec: 300,
                drops: [60, 120, 200], // last → 200
            });
            const b: AnalyzedTrack = buildTrack({
                path: 'b',
                key: { tonic: 'A', mode: 'minor' },
                bpm: 128,
                durationSec: 300,
                drops: [50, 110, 220], // first → 50
            });
            const plan: TransitionPlan = new MixTransition(a, b).plan();
            expect(plan.alignment).toBe('drop');
            // 16-bar lead-in = 30s → cueOut ~170, cueIn ~20.
            expect(plan.cueOutSec).toBeGreaterThan(168);
            expect(plan.cueOutSec).toBeLessThan(172);
            expect(plan.cueInSec).toBeGreaterThan(18);
            expect(plan.cueInSec).toBeLessThan(22);
        });
    });

    describe('alignment field', (): void => {
        it('reports energy when no drops are present (default test case)', (): void => {
            const a: AnalyzedTrack = buildTrack({
                path: 'a',
                key: { tonic: 'A', mode: 'minor' },
                bpm: 128,
                durationSec: 240,
            });
            const b: AnalyzedTrack = buildTrack({
                path: 'b',
                key: { tonic: 'A', mode: 'minor' },
                bpm: 128,
                durationSec: 240,
            });
            expect(new MixTransition(a, b).plan().alignment).toBe('energy');
        });
    });

    describe('transition style', (): void => {
        // Both tracks at 128 BPM with drops mid-track — gives every style enough runway.
        const buildPair = (): { a: AnalyzedTrack; b: AnalyzedTrack } => ({
            a: buildTrack({
                path: 'a',
                key: { tonic: 'A', mode: 'minor' },
                bpm: 128,
                durationSec: 240,
                drops: [180]
            }),
            b: buildTrack({
                path: 'b',
                key: { tonic: 'A', mode: 'minor' },
                bpm: 128,
                durationSec: 240,
                drops: [60]
            })
        });

        it('default style is drop-on-drop and aligns drops in wall time', (): void => {
            const { a, b } = buildPair();
            const plan: TransitionPlan = new MixTransition(a, b).plan();
            expect(plan.style).toBe('drop-on-drop');
            expect(plan.alignment).toBe('drop');
            // pitchRatio = 1 (same BPM); A's drop @180 = wall-end; B's drop @60 ≈ cueIn + mixDuration
            expect(plan.cueInSec + plan.mixDurationSec).toBeCloseTo(60, 0);
        });

        it('tail-out moves cueOut after A\'s drop and ignores B\'s drop placement', (): void => {
            const { a, b } = buildPair();
            const plan: TransitionPlan = new MixTransition(a, b).plan({ style: 'tail-out' });
            expect(plan.style).toBe('tail-out');
            expect(plan.alignment).toBe('tail-out');
            // CueOut is past A's drop @180 (drop has played). 4 bars at 128bpm = 4 * 1.875s = 7.5s
            expect(plan.cueOutSec).toBeGreaterThan(180);
            // B starts from beats[0]
            expect(plan.cueInSec).toBeLessThan(5);
        });

        it('early-cut places A\'s outro before its drop with a small cushion', (): void => {
            const { a, b } = buildPair();
            const plan: TransitionPlan = new MixTransition(a, b).plan({ style: 'early-cut' });
            expect(plan.style).toBe('early-cut');
            expect(plan.alignment).toBe('early-cut');
            // The crossfade ends before A's drop @180 (the whole window is under it).
            expect(plan.cueOutSec + plan.mixDurationSec).toBeLessThanOrEqual(180);
            // The crossfade ends at B's drop @60 in wall time (pitchRatio=1).
            expect(plan.cueInSec + plan.mixDurationSec).toBeCloseTo(60, 0);
        });

        it('bar-match deliberately ignores drops and uses energy alignment', (): void => {
            const { a, b } = buildPair();
            const plan: TransitionPlan = new MixTransition(a, b).plan({ style: 'bar-match' });
            expect(plan.style).toBe('bar-match');
            expect(plan.alignment).toBe('energy');
        });

        it('drop-on-drop falls back to energy alignment when one track has no drop', (): void => {
            const a: AnalyzedTrack = buildTrack({
                path: 'a',
                key: { tonic: 'A', mode: 'minor' },
                bpm: 128,
                durationSec: 240,
                drops: []
            });
            const b: AnalyzedTrack = buildTrack({
                path: 'b',
                key: { tonic: 'A', mode: 'minor' },
                bpm: 128,
                durationSec: 240,
                drops: [60]
            });
            const plan: TransitionPlan = new MixTransition(a, b).plan({ style: 'drop-on-drop' });
            expect(plan.style).toBe('drop-on-drop');
            expect(plan.alignment).toBe('energy');
            expect(plan.notes.some((n: string): boolean => n.includes('couldn\'t be honoured'))).toBe(true);
        });

        it('tail-out falls back when A\'s drop is too close to its end', (): void => {
            const a: AnalyzedTrack = buildTrack({
                path: 'a',
                key: { tonic: 'A', mode: 'minor' },
                bpm: 128,
                durationSec: 200,
                drops: [195] // only 5s after the drop — not enough runway
            });
            const b: AnalyzedTrack = buildTrack({
                path: 'b',
                key: { tonic: 'A', mode: 'minor' },
                bpm: 128,
                durationSec: 240,
                drops: [60]
            });
            const plan: TransitionPlan = new MixTransition(a, b).plan({ style: 'tail-out' });
            expect(plan.style).toBe('tail-out');
            expect(plan.alignment).toBe('energy');
        });
    });
});
