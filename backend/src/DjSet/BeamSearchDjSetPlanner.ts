import type { TransitionStyle } from '@headbangbear/schemas';
import type { AnalyzedTrack } from '../Library/TrackLibrary.js';
import { MixTransition, type TransitionPlan } from '../Mix/MixTransition.js';
import {
    trajectoryDeviation,
    type DjSet,
    type DjSetTrack,
    type EnergyDirection,
    type EnergyShape,
} from './DjSetPlanner.js';

const DEFAULT_BEAM_WIDTH: number = 8;

interface BeamState {
    readonly ordered: readonly AnalyzedTrack[];
    readonly remaining: ReadonlySet<AnalyzedTrack>;
    readonly transitions: readonly TransitionPlan[];
    readonly sumPitchAbs: number;
    readonly dropAligned: number;
    /** Count of consecutive same-artist transitions (i + 1 share artist with i). Both sides
     *  must have a non-empty `metadata.artist` for a pair to count — untagged tracks never
     *  contribute. Used by the comparator only when `avoidSameArtist` is on. */
    readonly artistRepeats: number;
    /** Estimated wall-clock duration of the chain if played end-to-end through `AutoPlayer`. */
    readonly estimatedDurationSec: number;
}

/**
 * Mirrors `AutoPlayer`'s scheduling math: track 0 plays from 0 to its first transition's
 * `cueOutSec`; track i ≥ 1 plays from `transitions[i-1].cueInSec` to either the next
 * transition's `cueOutSec` or its own end, all divided by `pitchRate = 1 + pitchPercent/100`.
 * Crossfades overlap, so the wall-clock total = sum of each track's contribution to the
 * scheduled timeline, where the next track's start coincides with the current track's
 * fade-out start.
 */
export function estimateChainDurationSec(
    ordered: readonly AnalyzedTrack[],
    transitions: readonly TransitionPlan[]
): number {
    let cursor: number = 0;
    for (let i = 0; i < ordered.length; i++) {
        const track = ordered[i];
        if (track === undefined) {
            continue;
        }
        const transitionIn = i > 0 ? transitions[i - 1] : undefined;
        const transitionOut = i < transitions.length ? transitions[i] : undefined;
        const pitchRate: number =
            transitionIn !== undefined ? 1 + transitionIn.to.pitchPercent / 100 : 1.0;
        const startOffset: number =
            transitionIn !== undefined ? transitionIn.cueInSec : 0;
        if (transitionOut !== undefined) {
            cursor += (transitionOut.cueOutSec - startOffset) / pitchRate;
        } else {
            cursor += (track.result.durationSec - startOffset) / pitchRate;
        }
    }
    return cursor;
}

export interface BeamSearchOptions {
    /** Force a specific starting track. When set, `tryAllStarts` is ignored. */
    start?: AnalyzedTrack;
    /** Bias the single-start pick. Beam search itself does not penalise direction during expansion. */
    energyDirection?: EnergyDirection;
    /**
     * Trajectory the chain should follow. When set, the lex score gains a `trajectoryDeviation`
     * key (lower = closer to the ideal curve), placed below the primary length / target keys
     * so a long chain that sloppily fits the shape still beats a perfectly shaped short chain.
     * Also flips `keepShorterOnExtend` on so a short chain that nails the shape can survive
     * past iterations where its extensions diverge.
     */
    energyShape?: EnergyShape;
    /** Top-K partial chains kept per expansion. Default `8`. */
    beamWidth?: number;
    /**
     * If `true` (default), every track in the pool is tried as the starting track and the
     * lex-best result wins. If `false`, only the lowest-energy track (or highest for `'down'`)
     * is tried — cheaper, but vulnerable to the disconnected-Camelot-cluster trap.
     */
    tryAllStarts?: boolean;
    /**
     * If set, beam-search prefers chains whose estimated wall-time duration is closest to
     * this value. The lex-score becomes `(|estDuration − target|, −length, sumPitchAbs,
     * −dropAligned)` instead of `(−length, …)` — so a chain that hits the target with fewer
     * tracks beats a longer chain that overshoots. Estimate accounts for cue points, pitch
     * shift, and crossfade overlap exactly the way `AutoPlayer` schedules playback.
     */
    targetDurationSec?: number;
    /** Transition style applied to every transition. Default `'drop-on-drop'`. */
    style?: TransitionStyle;
    /**
     * Soft penalty: when two consecutive tracks share an artist tag, add 1 to a state-level
     * `artistRepeats` counter. The lex score adds this counter as a tiebreaker right after
     * the primary length/shape keys, so a 5-track chain with 2 same-artist pairs still beats
     * a 4-track chain with 0 — but among same-length / same-shape chains the diverse one
     * wins. Untagged tracks never trigger the penalty. Default `false`.
     */
    avoidSameArtist?: boolean;
}

/**
 * Beam-search DJ set planner. At each step every state in the beam is extended to all
 * Camelot-compatible successors; states are then sorted by a lexicographic score and the top
 * `beamWidth` survive.
 *
 * Score (lower is better):
 *   1. `−ordered.length`        — primary: maximise chain length
 *   2.  `sumPitchAbs`           — secondary: minimise total pitch shift across transitions
 *   3. `−dropAligned`           — tertiary: maximise the number of drop-aligned transitions
 *
 * Transitions are memoised per `(from.path, to.path)` pair so each `MixTransition.plan()`
 * runs at most once per session — including across multiple starts in `tryAllStarts` mode.
 */
export class BeamSearchDjSetPlanner {
    private readonly tracks: readonly AnalyzedTrack[];

    private readonly transitionCache: Map<string, TransitionPlan> = new Map();

    public constructor(tracks: readonly AnalyzedTrack[]) {
        this.tracks = tracks;
    }

    public plan(options: BeamSearchOptions = {}): DjSet {
        const energyDirection: EnergyDirection = options.energyDirection ?? 'up';
        const energyShape: EnergyShape | undefined = options.energyShape;
        const beamWidth: number = options.beamWidth ?? DEFAULT_BEAM_WIDTH;
        const tryAllStarts: boolean = options.tryAllStarts ?? true;
        const targetDurationSec: number | undefined = options.targetDurationSec;
        const style: TransitionStyle | undefined = options.style;
        const avoidSameArtist: boolean = options.avoidSameArtist ?? false;

        if (this.tracks.length === 0) {
            return BeamSearchDjSetPlanner.buildSet([], [], [], energyDirection, energyShape);
        }

        const eMin: number = Math.min(
            ...this.tracks.map((t: AnalyzedTrack): number => t.result.energy),
        );
        const eMax: number = Math.max(
            ...this.tracks.map((t: AnalyzedTrack): number => t.result.energy),
        );

        const starts: readonly AnalyzedTrack[] =
            options.start !== undefined && this.tracks.includes(options.start)
                ? [options.start]
                : tryAllStarts
                    ? this.tracks
                    : [BeamSearchDjSetPlanner.pickStart(this.tracks, energyDirection, energyShape)];

        const compare = BeamSearchDjSetPlanner.makeComparator(
            targetDurationSec, energyShape, eMin, eMax, this.tracks.length, avoidSameArtist,
        );
        const keepShorterOnExtend: boolean =
            targetDurationSec !== undefined || energyShape !== undefined;

        let bestState: BeamState | null = null;
        for (const start of starts) {
            const finalState: BeamState = this.searchFromStart(
                start,
                beamWidth,
                compare,
                keepShorterOnExtend,
                style
            );
            if (bestState === null || compare(finalState, bestState) < 0) {
                bestState = finalState;
            }
        }
        if (bestState === null) {
            return BeamSearchDjSetPlanner.buildSet([], [], [], energyDirection, energyShape);
        }

        return BeamSearchDjSetPlanner.buildSet(
            bestState.ordered.map(BeamSearchDjSetPlanner.summarize),
            [...bestState.transitions],
            Array.from(bestState.remaining).map(BeamSearchDjSetPlanner.summarize),
            energyDirection,
            energyShape,
        );
    }

    private static buildSet(
        tracks: DjSetTrack[],
        transitions: TransitionPlan[],
        skipped: DjSetTrack[],
        energyDirection: EnergyDirection,
        energyShape: EnergyShape | undefined,
    ): DjSet {
        const result: DjSet = {
            tracks: tracks,
            transitions: transitions,
            skipped: skipped,
            energyDirection: energyDirection,
        };
        if (energyShape !== undefined) {
            result.energyShape = energyShape;
        }
        return result;
    }

    private searchFromStart(
        start: AnalyzedTrack,
        beamWidth: number,
        compare: (a: BeamState, b: BeamState) => number,
        keepShorterOnExtend: boolean,
        style: TransitionStyle | undefined
    ): BeamState {
        const initialOrdered: readonly AnalyzedTrack[] = [start];
        const initial: BeamState = {
            ordered: initialOrdered,
            remaining: new Set(
                this.tracks.filter((t: AnalyzedTrack): boolean => t !== start),
            ),
            transitions: [],
            sumPitchAbs: 0,
            dropAligned: 0,
            artistRepeats: 0,
            estimatedDurationSec: estimateChainDurationSec(initialOrdered, []),
        };
        return this.runBeam(initial, beamWidth, compare, keepShorterOnExtend, style);
    }

    private runBeam(
        initial: BeamState,
        beamWidth: number,
        compare: (a: BeamState, b: BeamState) => number,
        keepShorterOnExtend: boolean,
        style: TransitionStyle | undefined
    ): BeamState {
        let beam: BeamState[] = [initial];
        // Hard cap to guard against pathological infinite loops; in practice the loop ends
        // within `tracks.length` iterations.
        const maxIterations: number = this.tracks.length + 1;
        for (let iter = 0; iter < maxIterations; iter++) {
            const expansions: BeamState[] = [];
            let extended: boolean = false;
            for (const state of beam) {
                const current: AnalyzedTrack = state.ordered[
                    state.ordered.length - 1
                ] as AnalyzedTrack;
                let extensions: number = 0;
                for (const t of state.remaining) {
                    if (!current.result.camelot.isCompatibleWith(t.result.camelot)) {
                        continue;
                    }
                    extensions++;
                    expansions.push(this.extend(state, t, current, style));
                }
                if (extensions === 0) {
                    // Terminal state — keep verbatim so it survives to the final scoring.
                    expansions.push(state);
                } else {
                    extended = true;
                    if (keepShorterOnExtend) {
                        // Target-budget search: keep the un-extended state too so a shorter
                        // chain that lands closer to the target can beat its longer
                        // extensions in the lex score. Without this, a state is replaced by
                        // its extensions on every iteration and the comparator never sees
                        // the shorter alternative.
                        expansions.push(state);
                    }
                }
            }
            expansions.sort(compare);
            beam = expansions.slice(0, beamWidth);
            if (!extended) {
                break;
            }
        }
        beam.sort(compare);
        return beam[0] ?? initial;
    }

    private extend(
        state: BeamState,
        next: AnalyzedTrack,
        current: AnalyzedTrack,
        style: TransitionStyle | undefined
    ): BeamState {
        const transition: TransitionPlan = this.getTransition(current, next, style);
        const remaining: Set<AnalyzedTrack> = new Set(state.remaining);
        remaining.delete(next);
        const ordered: readonly AnalyzedTrack[] = [...state.ordered, next];
        const transitions: readonly TransitionPlan[] = [...state.transitions, transition];
        return {
            ordered: ordered,
            remaining: remaining,
            transitions: transitions,
            sumPitchAbs: state.sumPitchAbs + Math.abs(transition.to.pitchPercent),
            dropAligned: state.dropAligned + (transition.alignment === 'drop' ? 1 : 0),
            artistRepeats: state.artistRepeats
                + (BeamSearchDjSetPlanner.sameArtist(current, next) ? 1 : 0),
            estimatedDurationSec: estimateChainDurationSec(ordered, transitions),
        };
    }

    /** True iff both tracks have a non-empty `metadata.artist` and the strings match. */
    private static sameArtist(a: AnalyzedTrack, b: AnalyzedTrack): boolean {
        const artistA: string | undefined = a.metadata?.artist;
        const artistB: string | undefined = b.metadata?.artist;
        return artistA !== undefined
            && artistB !== undefined
            && artistA.length > 0
            && artistA === artistB;
    }

    private getTransition(
        from: AnalyzedTrack,
        to: AnalyzedTrack,
        style: TransitionStyle | undefined
    ): TransitionPlan {
        // Cache key includes the style — different styles yield different cue points so we
        // can't share the same plan across them.
        const key: string = `${from.path}${to.path}${style ?? 'default'}`;
        const cached: TransitionPlan | undefined = this.transitionCache.get(key);
        if (cached !== undefined) {
            return cached;
        }
        const plan: TransitionPlan = new MixTransition(from, to).plan({ style: style });
        this.transitionCache.set(key, plan);
        return plan;
    }

    /**
     * Builds a lex comparator over `BeamState`s.
     *
     *   - Plain: `(−length, sumPitchAbs, −dropAligned)`.
     *   - With `targetDurationSec`: `(|estDuration − target|, −length, …)`.
     *   - With `energyShape`: `(−length, trajectoryDeviation, sumPitchAbs, −dropAligned)`. Length
     *     stays primary so the planner doesn't pick a 2-track chain that perfectly fits the
     *     curve over a 5-track chain that fits it loosely.
     *   - With both: `(|estDuration − target|, trajectoryDeviation, −length, …)` — target dominates
     *     because it constrains chain size; shape places second.
     *
     * Deviations are cached per-state via a `WeakMap` so each state is scored once even when
     * the comparator is called many times during sorting.
     */
    private static makeComparator(
        targetDurationSec: number | undefined,
        shape: EnergyShape | undefined,
        eMin: number,
        eMax: number,
        poolSize: number,
        avoidSameArtist: boolean,
    ): (a: BeamState, b: BeamState) => number {
        const deviationCache: WeakMap<BeamState, number> = new WeakMap();
        const deviationOf = (s: BeamState): number => {
            if (shape === undefined) {
                return 0;
            }
            const cached: number | undefined = deviationCache.get(s);
            if (cached !== undefined) {
                return cached;
            }
            const energies: number[] = s.ordered.map(
                (t: AnalyzedTrack): number => t.result.energy,
            );
            const value: number = trajectoryDeviation(energies, shape, eMin, eMax, poolSize);
            deviationCache.set(s, value);
            return value;
        };
        return (a: BeamState, b: BeamState): number => {
            if (targetDurationSec !== undefined) {
                const distA: number = Math.abs(a.estimatedDurationSec - targetDurationSec);
                const distB: number = Math.abs(b.estimatedDurationSec - targetDurationSec);
                if (distA !== distB) {
                    return distA - distB;
                }
            } else {
                if (a.ordered.length !== b.ordered.length) {
                    return b.ordered.length - a.ordered.length;
                }
            }
            if (shape !== undefined) {
                const da: number = deviationOf(a);
                const db: number = deviationOf(b);
                if (da !== db) {
                    return da - db;
                }
            }
            if (targetDurationSec !== undefined && a.ordered.length !== b.ordered.length) {
                return b.ordered.length - a.ordered.length;
            }
            if (avoidSameArtist && a.artistRepeats !== b.artistRepeats) {
                return a.artistRepeats - b.artistRepeats;
            }
            if (a.sumPitchAbs !== b.sumPitchAbs) {
                return a.sumPitchAbs - b.sumPitchAbs;
            }
            return b.dropAligned - a.dropAligned;
        };
    }

    private static pickStart(
        tracks: readonly AnalyzedTrack[],
        direction: EnergyDirection,
        shape: EnergyShape | undefined,
    ): AnalyzedTrack {
        const sorted: AnalyzedTrack[] = [...tracks].sort(
            (a: AnalyzedTrack, b: AnalyzedTrack): number => a.result.energy - b.result.energy,
        );
        const lowest: AnalyzedTrack = sorted[0] as AnalyzedTrack;
        const highest: AnalyzedTrack = sorted[sorted.length - 1] as AnalyzedTrack;
        if (shape === 'descending') {
            return highest;
        }
        if (shape !== undefined) {
            return lowest;
        }
        return direction === 'down' ? highest : lowest;
    }

    private static summarize(t: AnalyzedTrack): DjSetTrack {
        return {
            path: t.path,
            camelot: t.result.camelot.toString(),
            bpm: t.result.bpm,
            energy: t.result.energy,
            durationSec: t.result.durationSec,
        };
    }
}