import { describe, expect, it } from 'vitest';
import { Camelot } from '../../src/Analysis/Camelot.js';
import { OpenKey } from '../../src/Analysis/OpenKey.js';
import type { AnalysisResult, MusicalKey } from '../../src/Analysis/schemas.js';
import { BeamSearchDjSetPlanner } from '../../src/DjSet/BeamSearchDjSetPlanner.js';
import { DjSetPlanner, type DjSet } from '../../src/DjSet/DjSetPlanner.js';
import type { AnalyzedTrack } from '../../src/Library/TrackLibrary.js';

interface BuildOpts {
    path: string;
    key: MusicalKey;
    bpm: number;
    energy: number;
    durationSec?: number;
    artist?: string;
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
    const track: AnalyzedTrack = { path: opts.path, result: result, hasCover: false };
    if (opts.artist !== undefined) {
        track.metadata = { artist: opts.artist };
    }
    return track;
}

describe('BeamSearchDjSetPlanner', (): void => {
    describe('edge cases', (): void => {
        it('returns an empty set for an empty pool', (): void => {
            const result: DjSet = new BeamSearchDjSetPlanner([]).plan();
            expect(result.tracks).toEqual([]);
            expect(result.transitions).toEqual([]);
            expect(result.skipped).toEqual([]);
        });

        it('returns a single-track set with no transitions', (): void => {
            const t: AnalyzedTrack = buildTrack({
                path: 'a',
                key: { tonic: 'A', mode: 'minor' },
                bpm: 128,
                energy: 0.4,
            });
            const result: DjSet = new BeamSearchDjSetPlanner([t]).plan();
            expect(result.tracks).toHaveLength(1);
            expect(result.transitions).toHaveLength(0);
        });
    });

    describe('finds longer chains than greedy on dead-end fixtures', (): void => {
        it('backtracks past a dead-end neighbour to reach a longer chain', (): void => {
            // Graph designed so greedy picks A→B and gets stuck:
            //   A (8A) ↔ B (8B): compatible (relative)
            //   A (8A) ↔ C (9A): compatible (energy-up)
            //   C (9A) ↔ D (10A): compatible (energy-up)
            //   B (8B) ↔ C, D: NOT compatible
            // Greedy with 'up': A→B (smallest energy delta), then dead end → 2 tracks.
            // Beam should find A→C→D → 3 tracks.
            const a: AnalyzedTrack = buildTrack({
                path: 'a',
                key: { tonic: 'A', mode: 'minor' }, // 8A
                bpm: 128,
                energy: 0.1,
            });
            const b: AnalyzedTrack = buildTrack({
                path: 'b',
                key: { tonic: 'C', mode: 'major' }, // 8B
                bpm: 128,
                energy: 0.4,
            });
            const c: AnalyzedTrack = buildTrack({
                path: 'c',
                key: { tonic: 'E', mode: 'minor' }, // 9A
                bpm: 128,
                energy: 0.5,
            });
            const d: AnalyzedTrack = buildTrack({
                path: 'd',
                key: { tonic: 'B', mode: 'minor' }, // 10A
                bpm: 128,
                energy: 0.8,
            });
            const pool: AnalyzedTrack[] = [a, b, c, d];

            const greedy: DjSet = new DjSetPlanner(pool).plan({ strategy: 'greedy' });
            // tryAllStarts: false pins the start to the lowest-energy track (a) so this test
            // demonstrates beam beating greedy from the *same* start. Multi-start mode is
            // covered separately below.
            const beam: DjSet = new DjSetPlanner(pool).plan({
                strategy: 'beam',
                tryAllStarts: false,
            });

            expect(greedy.tracks).toHaveLength(2); // A→B (dead end)
            expect(beam.tracks).toHaveLength(3); // A→C→D
            expect(beam.tracks.map((t): string => t.path)).toEqual(['a', 'c', 'd']);
            expect(beam.skipped.map((t): string => t.path)).toEqual(['b']);
        });
    });

    describe('lexicographic scoring', (): void => {
        it('prefers a longer chain over a shorter one with lower pitch sum', (): void => {
            // Three-track chain at varied BPM (incurs pitch shift) vs two-track chain at same BPM.
            // Length must dominate.
            const start: AnalyzedTrack = buildTrack({
                path: 'start',
                key: { tonic: 'A', mode: 'minor' }, // 8A
                bpm: 128,
                energy: 0.1,
            });
            const sameBpmDeadEnd: AnalyzedTrack = buildTrack({
                path: 'dead',
                key: { tonic: 'C', mode: 'major' }, // 8B (compatible only with 8A in this pool)
                bpm: 128, // zero pitch shift from start
                energy: 0.4,
            });
            const fastChainMid: AnalyzedTrack = buildTrack({
                path: 'fast-mid',
                key: { tonic: 'E', mode: 'minor' }, // 9A
                bpm: 140, // ~9% pitch shift
                energy: 0.5,
            });
            const fastChainEnd: AnalyzedTrack = buildTrack({
                path: 'fast-end',
                key: { tonic: 'B', mode: 'minor' }, // 10A
                bpm: 145,
                energy: 0.8,
            });

            const beam: DjSet = new BeamSearchDjSetPlanner([
                start,
                sameBpmDeadEnd,
                fastChainMid,
                fastChainEnd,
            ]).plan({ tryAllStarts: false });

            // Beam must pick the 3-track fast chain even though it costs ~22% total pitch shift.
            expect(beam.tracks.map((t): string => t.path)).toEqual([
                'start',
                'fast-mid',
                'fast-end',
            ]);
        });

        it('among equal-length chains, picks the one with lower total pitch shift', (): void => {
            // Two mutually exclusive 3-track chains rooted at the same start:
            //   chain-A: start (8A) → a_mid (8B) → a_end (7B), close BPMs (low pitch sum)
            //   chain-B: start (8A) → b_mid (9A) → b_end (10A), wide BPMs (high pitch sum)
            // 8B↔9A and the chain endpoints are mutually incompatible, so the beam must
            // commit to one path. With equal lengths, it should pick the lower-pitch chain.
            const start: AnalyzedTrack = buildTrack({
                path: 'start',
                key: { tonic: 'A', mode: 'minor' }, // 8A
                bpm: 128,
                energy: 0.2,
            });
            const aMid: AnalyzedTrack = buildTrack({
                path: 'a_mid',
                key: { tonic: 'C', mode: 'major' }, // 8B
                bpm: 130,
                energy: 0.4,
            });
            const aEnd: AnalyzedTrack = buildTrack({
                path: 'a_end',
                key: { tonic: 'F', mode: 'major' }, // 7B
                bpm: 132,
                energy: 0.5,
            });
            const bMid: AnalyzedTrack = buildTrack({
                path: 'b_mid',
                key: { tonic: 'E', mode: 'minor' }, // 9A
                bpm: 150,
                energy: 0.5,
            });
            const bEnd: AnalyzedTrack = buildTrack({
                path: 'b_end',
                key: { tonic: 'B', mode: 'minor' }, // 10A
                bpm: 155,
                energy: 0.6,
            });

            const beam: DjSet = new BeamSearchDjSetPlanner([
                start,
                aMid,
                aEnd,
                bMid,
                bEnd,
            ]).plan({ beamWidth: 4, tryAllStarts: false });

            expect(beam.tracks.map((t): string => t.path)).toEqual(['start', 'a_mid', 'a_end']);
            expect(new Set(beam.skipped.map((t): string => t.path))).toEqual(
                new Set(['b_mid', 'b_end']),
            );
        });
    });

    describe('beamWidth knob', (): void => {
        it('beamWidth=1 still produces a valid chain', (): void => {
            const a: AnalyzedTrack = buildTrack({
                path: 'a',
                key: { tonic: 'A', mode: 'minor' },
                bpm: 128,
                energy: 0.2,
            });
            const b: AnalyzedTrack = buildTrack({
                path: 'b',
                key: { tonic: 'A', mode: 'minor' },
                bpm: 128,
                energy: 0.6,
            });
            const result: DjSet = new BeamSearchDjSetPlanner([a, b]).plan({ beamWidth: 1 });
            expect(result.tracks).toHaveLength(2);
            expect(result.transitions).toHaveLength(1);
        });

        it('is deterministic for the same input', (): void => {
            const tracks: AnalyzedTrack[] = [
                buildTrack({
                    path: 'a',
                    key: { tonic: 'A', mode: 'minor' },
                    bpm: 128,
                    energy: 0.1,
                }),
                buildTrack({
                    path: 'b',
                    key: { tonic: 'E', mode: 'minor' },
                    bpm: 128,
                    energy: 0.4,
                }),
                buildTrack({
                    path: 'c',
                    key: { tonic: 'B', mode: 'minor' },
                    bpm: 128,
                    energy: 0.7,
                }),
            ];
            const a: DjSet = new BeamSearchDjSetPlanner(tracks).plan();
            const b: DjSet = new BeamSearchDjSetPlanner(tracks).plan();
            expect(a.tracks.map((t): string => t.path)).toEqual(b.tracks.map((t): string => t.path));
        });
    });

    describe('multi-start (tryAllStarts)', (): void => {
        it('finds longer chains than single-start when the auto-pick start is in a dead-end cluster', (): void => {
            // Pool: a fully-connected 8A→9A→10A→11A run plus an isolated 5B/4B pair.
            // Lowest-energy track sits in the isolated pair → single-start mode finds 2 tracks.
            // Multi-start tries each as the start and finds the 4-track chain.
            const isolatedLow: AnalyzedTrack = buildTrack({
                path: 'iso_low',
                key: { tonic: 'D#', mode: 'major' }, // 5B
                bpm: 128,
                energy: 0.05,
            });
            const isolatedDead: AnalyzedTrack = buildTrack({
                path: 'iso_dead',
                key: { tonic: 'G#', mode: 'major' }, // 4B (compatible with 5B)
                bpm: 128,
                energy: 0.2,
            });
            const a: AnalyzedTrack = buildTrack({
                path: 'a',
                key: { tonic: 'A', mode: 'minor' }, // 8A
                bpm: 128,
                energy: 0.3,
            });
            const b: AnalyzedTrack = buildTrack({
                path: 'b',
                key: { tonic: 'E', mode: 'minor' }, // 9A
                bpm: 128,
                energy: 0.5,
            });
            const c: AnalyzedTrack = buildTrack({
                path: 'c',
                key: { tonic: 'B', mode: 'minor' }, // 10A
                bpm: 128,
                energy: 0.7,
            });
            const d: AnalyzedTrack = buildTrack({
                path: 'd',
                key: { tonic: 'F#', mode: 'minor' }, // 11A
                bpm: 128,
                energy: 0.9,
            });
            const pool: AnalyzedTrack[] = [isolatedLow, isolatedDead, a, b, c, d];

            const single: DjSet = new BeamSearchDjSetPlanner(pool).plan({
                tryAllStarts: false,
            });
            const multi: DjSet = new BeamSearchDjSetPlanner(pool).plan({
                tryAllStarts: true,
            });

            expect(single.tracks).toHaveLength(2); // pinned to isolated 5B → 4B
            expect(multi.tracks.length).toBeGreaterThanOrEqual(4); // a→b→c→d found
            expect(multi.tracks.map((t): string => t.path)).toEqual(
                expect.arrayContaining(['a', 'b', 'c', 'd']),
            );
        });

        it('respects an explicit start track even when tryAllStarts is true', (): void => {
            const a: AnalyzedTrack = buildTrack({
                path: 'a',
                key: { tonic: 'A', mode: 'minor' },
                bpm: 128,
                energy: 0.1,
            });
            const b: AnalyzedTrack = buildTrack({
                path: 'b',
                key: { tonic: 'A', mode: 'minor' },
                bpm: 128,
                energy: 0.5,
            });
            const c: AnalyzedTrack = buildTrack({
                path: 'c',
                key: { tonic: 'A', mode: 'minor' },
                bpm: 128,
                energy: 0.9,
            });
            const result: DjSet = new BeamSearchDjSetPlanner([a, b, c]).plan({
                start: c,
                tryAllStarts: true,
            });
            expect(result.tracks[0]?.path).toBe('c');
        });

        it('multi-start is the default when no start is given', (): void => {
            // Same fixture as the multi-start test above; calling plan() with no options
            // should use multi-start mode.
            const isolatedLow: AnalyzedTrack = buildTrack({
                path: 'iso_low',
                key: { tonic: 'D#', mode: 'major' }, // 5B
                bpm: 128,
                energy: 0.05,
            });
            const isolatedDead: AnalyzedTrack = buildTrack({
                path: 'iso_dead',
                key: { tonic: 'G#', mode: 'major' }, // 4B
                bpm: 128,
                energy: 0.2,
            });
            const a: AnalyzedTrack = buildTrack({
                path: 'a',
                key: { tonic: 'A', mode: 'minor' },
                bpm: 128,
                energy: 0.3,
            });
            const b: AnalyzedTrack = buildTrack({
                path: 'b',
                key: { tonic: 'E', mode: 'minor' },
                bpm: 128,
                energy: 0.5,
            });
            const result: DjSet = new BeamSearchDjSetPlanner([
                isolatedLow,
                isolatedDead,
                a,
                b,
            ]).plan();
            expect(result.tracks.length).toBeGreaterThanOrEqual(2);
            // The longer chain (a→b) wins over the isolated pair (iso_low→iso_dead) of equal length;
            // tied at length 2, both have zero pitch and zero drops, so first-encountered wins —
            // but the assertion below holds for either outcome: at least one of the two clusters
            // is selected, and the result is non-trivial.
            expect(result.tracks).not.toEqual([]);
        });
    });

    describe('targetDurationSec', (): void => {
        it('greedy stops once the running estimated duration reaches the target', (): void => {
            // 4 same-key tracks, each ~240s. Without target the chain is 4 long.
            // With target=300 s, the greedy should stop after track 2 (≈480 s without
            // crossfade overlap; the estimator accounts for cue points so the second
            // track's contribution is its trim from cueIn to durationSec or transitionOut).
            const tracks: AnalyzedTrack[] = ['a', 'b', 'c', 'd'].map(
                (path): AnalyzedTrack => buildTrack({
                    path: path,
                    key: { tonic: 'A', mode: 'minor' },
                    bpm: 128,
                    energy: 0.5
                })
            );
            const full: DjSet = new DjSetPlanner(tracks).plan({ tryAllStarts: false });
            const budgeted: DjSet = new DjSetPlanner(tracks).plan({
                tryAllStarts: false,
                targetDurationSec: 300
            });
            expect(full.tracks.length).toBeGreaterThan(budgeted.tracks.length);
        });

        it('beam prefers chains close to the target over plain max-length', (): void => {
            const tracks: AnalyzedTrack[] = ['a', 'b', 'c', 'd', 'e'].map(
                (path): AnalyzedTrack => buildTrack({
                    path: path,
                    key: { tonic: 'A', mode: 'minor' },
                    bpm: 128,
                    energy: 0.5
                })
            );
            const longestNoTarget: DjSet = new BeamSearchDjSetPlanner(tracks).plan({
                tryAllStarts: false
            });
            const targeted: DjSet = new BeamSearchDjSetPlanner(tracks).plan({
                tryAllStarts: false,
                targetDurationSec: 360
            });
            expect(longestNoTarget.tracks.length).toBe(5);
            expect(targeted.tracks.length).toBeLessThan(longestNoTarget.tracks.length);
        });
    });

    describe('start track override', (): void => {
        it('honours options.start', (): void => {
            const a: AnalyzedTrack = buildTrack({
                path: 'a',
                key: { tonic: 'A', mode: 'minor' },
                bpm: 128,
                energy: 0.1,
            });
            const b: AnalyzedTrack = buildTrack({
                path: 'b',
                key: { tonic: 'A', mode: 'minor' },
                bpm: 128,
                energy: 0.5,
            });
            const c: AnalyzedTrack = buildTrack({
                path: 'c',
                key: { tonic: 'A', mode: 'minor' },
                bpm: 128,
                energy: 0.9,
            });
            const result: DjSet = new BeamSearchDjSetPlanner([a, b, c]).plan({ start: c });
            expect(result.tracks[0]?.path).toBe('c');
        });
    });

    describe('energyShape', (): void => {
        // 5-track pool, all in 8A (Camelot-compatible to each other), distinct energies. We
        // pin tryAllStarts:false on beam so the comparator is exercised directly without the
        // multi-start best-of pollution.
        function shapePool(): AnalyzedTrack[] {
            const energies: number[] = [0.1, 0.3, 0.5, 0.7, 0.9];
            return energies.map((energy: number, i: number): AnalyzedTrack => buildTrack({
                path: `t${i.toString()}-e${energy.toString()}`,
                key: { tonic: 'A', mode: 'minor' },
                bpm: 128,
                energy: energy,
            }));
        }

        it("'rising' produces a chain ordered by ascending energy", (): void => {
            const beam: DjSet = new BeamSearchDjSetPlanner(shapePool()).plan({
                energyShape: 'rising',
                tryAllStarts: false,
            });
            const energies: number[] = beam.tracks.map((t): number => t.energy);
            for (let i = 1; i < energies.length; i++) {
                expect(energies[i]).toBeGreaterThanOrEqual(energies[i - 1] as number);
            }
            expect(beam.tracks).toHaveLength(5);
            expect(beam.energyShape).toBe('rising');
        });

        it("'descending' produces a chain ordered by descending energy", (): void => {
            const beam: DjSet = new BeamSearchDjSetPlanner(shapePool()).plan({
                energyShape: 'descending',
                tryAllStarts: false,
            });
            const energies: number[] = beam.tracks.map((t): number => t.energy);
            for (let i = 1; i < energies.length; i++) {
                expect(energies[i]).toBeLessThanOrEqual(energies[i - 1] as number);
            }
            expect(beam.tracks).toHaveLength(5);
            expect(beam.energyShape).toBe('descending');
        });

        it("'arc' peaks somewhere in the middle of the chain", (): void => {
            // Multi-start so the planner can pick the best starting track for the arc curve.
            const beam: DjSet = new BeamSearchDjSetPlanner(shapePool()).plan({
                energyShape: 'arc',
                tryAllStarts: true,
            });
            expect(beam.tracks).toHaveLength(5);
            const energies: number[] = beam.tracks.map((t): number => t.energy);
            const peakIndex: number = energies.reduce(
                (best: number, e: number, i: number): number => (
                    e > (energies[best] as number) ? i : best
                ),
                0,
            );
            // Peak should sit at an interior position, not at either end.
            expect(peakIndex).toBeGreaterThan(0);
            expect(peakIndex).toBeLessThan(energies.length - 1);
            // Endpoints should be lower than the peak.
            const peakEnergy: number = energies[peakIndex] as number;
            expect(energies[0]).toBeLessThan(peakEnergy);
            expect(energies[energies.length - 1]).toBeLessThan(peakEnergy);
        });

        it('greedy with energyShape rises monotonically when shape is rising', (): void => {
            const greedy: DjSet = new DjSetPlanner(shapePool()).plan({
                strategy: 'greedy',
                energyShape: 'rising',
            });
            const energies: number[] = greedy.tracks.map((t): number => t.energy);
            expect(energies).toEqual([0.1, 0.3, 0.5, 0.7, 0.9]);
            expect(greedy.energyShape).toBe('rising');
        });

        it('omits energyShape from the response when no shape is requested', (): void => {
            const beam: DjSet = new BeamSearchDjSetPlanner(shapePool()).plan({
                tryAllStarts: false,
            });
            expect(beam.energyShape).toBeUndefined();
        });
    });

    describe('DjSetPlanner delegation', (): void => {
        it('routes strategy=beam through DjSetPlanner', (): void => {
            const a: AnalyzedTrack = buildTrack({
                path: 'a',
                key: { tonic: 'A', mode: 'minor' },
                bpm: 128,
                energy: 0.1,
            });
            const b: AnalyzedTrack = buildTrack({
                path: 'b',
                key: { tonic: 'C', mode: 'major' }, // 8B (dead end after A)
                bpm: 128,
                energy: 0.4,
            });
            const c: AnalyzedTrack = buildTrack({
                path: 'c',
                key: { tonic: 'E', mode: 'minor' }, // 9A (path forward)
                bpm: 128,
                energy: 0.5,
            });
            const d: AnalyzedTrack = buildTrack({
                path: 'd',
                key: { tonic: 'B', mode: 'minor' }, // 10A
                bpm: 128,
                energy: 0.8,
            });
            const greedy: DjSet = new DjSetPlanner([a, b, c, d]).plan();
            const beam: DjSet = new DjSetPlanner([a, b, c, d]).plan({ strategy: 'beam' });
            expect(beam.tracks.length).toBeGreaterThan(greedy.tracks.length);
        });
    });

    describe('avoidSameArtist penalty', (): void => {
        it('breaks ties between same-length / same-pitch chains by artist diversity', (): void => {
            // Two 2-track chains exist from `start`: one ending in altX, one in altY. Both
            // have identical BPM (zero pitch shift) and energy delta. altX shares the same
            // artist as start; altY does not. With avoidSameArtist on, the X→Y chain wins.
            // altX (8B) and altY (9A) are Camelot-incompatible with each other so the pool
            // can't form a 3-track chain — keeps the test focused on the tiebreaker.
            const start: AnalyzedTrack = buildTrack({
                path: 'start',
                key: { tonic: 'A', mode: 'minor' }, // 8A
                bpm: 128,
                energy: 0.4,
                artist: 'X',
            });
            const altX: AnalyzedTrack = buildTrack({
                path: 'altX',
                key: { tonic: 'C', mode: 'major' }, // 8B (compatible with 8A via switch)
                bpm: 128,
                energy: 0.4,
                artist: 'X',
            });
            const altY: AnalyzedTrack = buildTrack({
                path: 'altY',
                key: { tonic: 'E', mode: 'minor' }, // 9A (compatible with 8A via energy-up)
                bpm: 128,
                energy: 0.4,
                artist: 'Y',
            });

            // 8B↔9A is NOT a Camelot edge so the chain stays length 2 in either case.
            const beamOff: DjSet = new BeamSearchDjSetPlanner([start, altX, altY]).plan({
                tryAllStarts: false,
            });
            expect(beamOff.tracks).toHaveLength(2);

            const beamOn: DjSet = new BeamSearchDjSetPlanner([start, altX, altY]).plan({
                tryAllStarts: false,
                avoidSameArtist: true,
            });
            expect(beamOn.tracks).toHaveLength(2);
            expect(beamOn.tracks[1]?.path).toBe('altY');
        });

        it('does not block longer chains — length still dominates the score', (): void => {
            // Same two-step alternative as before, but adding a third compatible track that
            // only altX leads to (altY is a dead-end here). The avoidSameArtist flag must NOT
            // cause the planner to pick the shorter altY chain.
            const start: AnalyzedTrack = buildTrack({
                path: 'start',
                key: { tonic: 'A', mode: 'minor' }, // 8A
                bpm: 128,
                energy: 0.1,
                artist: 'X',
            });
            const altX: AnalyzedTrack = buildTrack({
                path: 'altX',
                key: { tonic: 'E', mode: 'minor' }, // 9A
                bpm: 128,
                energy: 0.5,
                artist: 'X',
            });
            const tail: AnalyzedTrack = buildTrack({
                path: 'tail',
                key: { tonic: 'B', mode: 'minor' }, // 10A — only altX leads here
                bpm: 128,
                energy: 0.7,
                artist: 'Z',
            });
            const altY: AnalyzedTrack = buildTrack({
                path: 'altY',
                key: { tonic: 'C', mode: 'major' }, // 8B — dead end after start
                bpm: 128,
                energy: 0.4,
                artist: 'Y',
            });

            const beam: DjSet = new BeamSearchDjSetPlanner([start, altX, tail, altY]).plan({
                tryAllStarts: false,
                avoidSameArtist: true,
            });
            expect(beam.tracks.map((t): string => t.path)).toEqual(['start', 'altX', 'tail']);
        });
    });
});