import {
    DjSetSchema,
    EnergyShapeSchema,
    type DjSet,
    type DjSetStrategy,
    type DjSetTrack,
    type EnergyDirection,
    type EnergyShape,
    type TransitionStyle,
} from '@headbangbear/schemas';
import type { AnalyzedTrack } from '../Library/TrackLibrary.js';
import { MixTransition, type TransitionPlan } from '../Mix/MixTransition.js';
import { BeamSearchDjSetPlanner, estimateChainDurationSec } from './BeamSearchDjSetPlanner.js';

// Re-exports — `DjSetPlanner.ts` stays the import-point for everything DJ-set-related so
// callers don't need to know the schemas workspace exists yet.
export { DjSetSchema, EnergyShapeSchema };
export type { DjSet, DjSetStrategy, DjSetTrack, EnergyDirection, EnergyShape };

/**
 * Ideal energy at normalized position [0..1] along a chain, given the requested shape and
 * the pool's energy bounds. `'rising'` lerps eMin → eMax, `'descending'` lerps eMax → eMin,
 * `'arc'` is a triangle eMin → eMax → eMin with peak at 0.5.
 */
export function idealEnergyAt(
    shape: EnergyShape,
    position: number,
    eMin: number,
    eMax: number,
): number {
    const span: number = eMax - eMin;
    if (shape === 'rising') {
        return eMin + span * position;
    }
    if (shape === 'descending') {
        return eMax - span * position;
    }
    const p: number = position <= 0.5 ? position * 2 : (1 - position) * 2;
    return eMin + span * p;
}

/**
 * Sum of `|actualEnergy[i] − idealEnergyAt(shape, i/(expectedLength−1), eMin, eMax)|`. The
 * curve is sized against `expectedLength` (= pool size in practice), **not** the chain's
 * current length, so partial chains during beam expansion stay scored against the same curve
 * their final extensions will be scored against. Without this, a partial chain like
 * `[0.1, 0.5, 0.9]` would look "perfectly rising" at length 3 — but extending it can only
 * make it worse, while the better `[0.1, 0.3, 0.5]` would look mediocre at length 3 and
 * get pruned, even though its extension `[0.1, 0.3, 0.5, 0.7, 0.9]` is the optimum.
 */
export function trajectoryDeviation(
    energies: readonly number[],
    shape: EnergyShape,
    eMin: number,
    eMax: number,
    expectedLength: number,
): number {
    if (energies.length === 0 || expectedLength <= 1) {
        return 0;
    }
    let sum: number = 0;
    const denom: number = expectedLength - 1;
    for (let i = 0; i < energies.length; i++) {
        const e: number | undefined = energies[i];
        if (e === undefined) {
            continue;
        }
        const ideal: number = idealEnergyAt(shape, i / denom, eMin, eMax);
        sum += Math.abs(e - ideal);
    }
    return sum;
}

export interface DjSetPlannerOptions {
    /** Force a specific starting track. If omitted, the planner picks one based on `energyDirection`. */
    start?: AnalyzedTrack;
    /** Bias the chain toward rising, falling, or unconstrained energy. Default `'up'`. */
    energyDirection?: EnergyDirection;
    /**
     * Trajectory the chain should follow. Overrides `energyDirection`'s per-step scoring when
     * set: greedy picks each next track to minimise deviation from the ideal energy at its
     * position; beam search adds the chain-wide `trajectoryDeviation` to its lex score.
     */
    energyShape?: EnergyShape;
    /** Search strategy. `'greedy'` (default) is myopic; `'beam'` keeps top-K partial chains. */
    strategy?: DjSetStrategy;
    /** Top-K partial chains kept by beam search. Default `8`. Ignored when `strategy === 'greedy'`. */
    beamWidth?: number;
    /**
     * Beam search only: try every track as a start and keep the lex-best result. Default `true`.
     * Ignored when `start` is set or `strategy === 'greedy'`.
     */
    tryAllStarts?: boolean;
    /**
     * Soft target for the chain's wall-clock duration in seconds.
     *  - **Greedy**: stops adding tracks once the running estimated duration ≥ target.
     *  - **Beam**: lex-score becomes `(|estDuration − target|, −length, sumPitchAbs, −dropAligned)`,
     *    so chains close to the target win even with fewer tracks.
     */
    targetDurationSec?: number;
    /** Transition style applied to every transition in the chain. Default `'drop-on-drop'`. */
    style?: TransitionStyle;
    /**
     * Beam-search only: penalises consecutive tracks by the same artist as a tiebreaker in
     * the lex score. Greedy ignores this flag — its tiebreaker is BPM proximity, and bolting
     * artist diversity onto a myopic search doesn't move the needle. Default `false`.
     */
    avoidSameArtist?: boolean;
    /** Forwarded to `BeamSearchDjSetPlanner` so worker wrappers can stream progress
     *  events to the UI. Greedy ignores this — it finishes too fast to be worth tracking. */
    onProgress?: (info: { current: number; total: number; phase: string }) => void;
}

const ENERGY_DIRECTION_PENALTY: number = 1000;

/**
 * Greedy DJ set planner: orders a track pool into a Camelot-compatible chain that respects
 * the requested energy direction. At each step it picks the unused track with the smallest
 * direction-respecting energy delta to the current track, breaking ties by BPM proximity.
 *
 * Tracks that cannot be reached from the current end of the chain are returned in `skipped`.
 * v1 is intentionally myopic — beam search / DP can replace `pickNext` later.
 */
export class DjSetPlanner {
    private readonly tracks: readonly AnalyzedTrack[];

    public constructor(tracks: readonly AnalyzedTrack[]) {
        this.tracks = tracks;
    }

    public plan(options: DjSetPlannerOptions = {}): DjSet {
        const energyDirection: EnergyDirection = options.energyDirection ?? 'up';
        const energyShape: EnergyShape | undefined = options.energyShape;
        const strategy: DjSetStrategy = options.strategy ?? 'greedy';

        if (strategy === 'beam') {
            return new BeamSearchDjSetPlanner(this.tracks).plan({
                start: options.start,
                energyDirection: energyDirection,
                energyShape: energyShape,
                beamWidth: options.beamWidth,
                tryAllStarts: options.tryAllStarts,
                targetDurationSec: options.targetDurationSec,
                style: options.style,
                avoidSameArtist: options.avoidSameArtist,
                onProgress: options.onProgress,
            });
        }

        if (this.tracks.length === 0) {
            return DjSetPlanner.buildSet([], [], [], energyDirection, energyShape);
        }

        const eMin: number = Math.min(...this.tracks.map((t: AnalyzedTrack): number => t.result.energy));
        const eMax: number = Math.max(...this.tracks.map((t: AnalyzedTrack): number => t.result.energy));
        const poolSize: number = this.tracks.length;

        const start: AnalyzedTrack =
            options.start !== undefined && this.tracks.includes(options.start)
                ? options.start
                : energyShape !== undefined
                    ? DjSetPlanner.pickStartByShape(this.tracks, energyShape)
                    : DjSetPlanner.pickStart(this.tracks, energyDirection);

        const ordered: AnalyzedTrack[] = [start];
        const remaining: Set<AnalyzedTrack> = new Set(
            this.tracks.filter((t: AnalyzedTrack): boolean => t !== start),
        );
        const transitions: TransitionPlan[] = [];

        const targetDurationSec: number | undefined = options.targetDurationSec;

        while (remaining.size > 0) {
            // Greedy stops once the chain's estimated wall-time meets/exceeds the budget.
            if (targetDurationSec !== undefined
                && estimateChainDurationSec(ordered, transitions) >= targetDurationSec) {
                break;
            }
            const current: AnalyzedTrack = ordered[ordered.length - 1] as AnalyzedTrack;
            const next: AnalyzedTrack | undefined = energyShape !== undefined
                ? DjSetPlanner.pickNextByShape(
                    current, remaining, energyShape, ordered.length, poolSize, eMin, eMax,
                )
                : DjSetPlanner.pickNext(current, remaining, energyDirection);
            if (next === undefined) {
                break;
            }
            transitions.push(new MixTransition(current, next).plan({ style: options.style }));
            ordered.push(next);
            remaining.delete(next);
        }

        return DjSetPlanner.buildSet(
            ordered.map(DjSetPlanner.summarize),
            transitions,
            Array.from(remaining).map(DjSetPlanner.summarize),
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

    private static pickStart(
        tracks: readonly AnalyzedTrack[],
        direction: EnergyDirection,
    ): AnalyzedTrack {
        const sorted: AnalyzedTrack[] = [...tracks].sort(
            (a: AnalyzedTrack, b: AnalyzedTrack): number => a.result.energy - b.result.energy,
        );
        const lowest: AnalyzedTrack = sorted[0] as AnalyzedTrack;
        const highest: AnalyzedTrack = sorted[sorted.length - 1] as AnalyzedTrack;
        return direction === 'down' ? highest : lowest;
    }

    private static pickStartByShape(
        tracks: readonly AnalyzedTrack[],
        shape: EnergyShape,
    ): AnalyzedTrack {
        const sorted: AnalyzedTrack[] = [...tracks].sort(
            (a: AnalyzedTrack, b: AnalyzedTrack): number => a.result.energy - b.result.energy,
        );
        const lowest: AnalyzedTrack = sorted[0] as AnalyzedTrack;
        const highest: AnalyzedTrack = sorted[sorted.length - 1] as AnalyzedTrack;
        return shape === 'descending' ? highest : lowest;
    }

    /**
     * Per-step shape-driven pick: among Camelot-compatible candidates, pick the one whose
     * energy is closest to the ideal at the next chain position. Position is normalized
     * against the **pool size** rather than the chain's eventual length so the curve walk
     * survives short chains (e.g. a 3-track chain from a 10-track pool sits in the warmup
     * region of the curve, not the whole span).
     */
    private static pickNextByShape(
        current: AnalyzedTrack,
        remaining: ReadonlySet<AnalyzedTrack>,
        shape: EnergyShape,
        nextIndex: number,
        poolSize: number,
        eMin: number,
        eMax: number,
    ): AnalyzedTrack | undefined {
        const candidates: AnalyzedTrack[] = [];
        for (const t of remaining) {
            if (current.result.camelot.isCompatibleWith(t.result.camelot)) {
                candidates.push(t);
            }
        }
        if (candidates.length === 0) {
            return undefined;
        }
        const denom: number = Math.max(1, poolSize - 1);
        const ideal: number = idealEnergyAt(shape, nextIndex / denom, eMin, eMax);
        candidates.sort((a: AnalyzedTrack, b: AnalyzedTrack): number => {
            const da: number = Math.abs(a.result.energy - ideal);
            const db: number = Math.abs(b.result.energy - ideal);
            if (da !== db) {
                return da - db;
            }
            return (
                Math.abs(a.result.bpm - current.result.bpm)
                - Math.abs(b.result.bpm - current.result.bpm)
            );
        });
        return candidates[0];
    }

    private static pickNext(
        current: AnalyzedTrack,
        remaining: ReadonlySet<AnalyzedTrack>,
        direction: EnergyDirection,
    ): AnalyzedTrack | undefined {
        const candidates: AnalyzedTrack[] = [];
        for (const t of remaining) {
            if (current.result.camelot.isCompatibleWith(t.result.camelot)) {
                candidates.push(t);
            }
        }
        if (candidates.length === 0) {
            return undefined;
        }
        candidates.sort((a: AnalyzedTrack, b: AnalyzedTrack): number => {
            const dirDelta: number =
                DjSetPlanner.directionScore(current, a, direction) -
                DjSetPlanner.directionScore(current, b, direction);
            if (dirDelta !== 0) {
                return dirDelta;
            }
            return (
                Math.abs(a.result.bpm - current.result.bpm) -
                Math.abs(b.result.bpm - current.result.bpm)
            );
        });
        return candidates[0];
    }

    /**
     * Lower is better. Wrong-direction candidates get a flat penalty so they only win when no
     * right-direction candidate exists.
     */
    private static directionScore(
        current: AnalyzedTrack,
        candidate: AnalyzedTrack,
        direction: EnergyDirection,
    ): number {
        const delta: number = candidate.result.energy - current.result.energy;
        if (direction === 'up') {
            return delta < 0 ? Math.abs(delta) + ENERGY_DIRECTION_PENALTY : Math.abs(delta);
        }
        if (direction === 'down') {
            return delta > 0 ? Math.abs(delta) + ENERGY_DIRECTION_PENALTY : Math.abs(delta);
        }
        return Math.abs(delta);
    }

    private static summarize(t: AnalyzedTrack): DjSetTrack {
        return {
            providerId: t.providerId,
            path: t.path,
            camelot: t.result.camelot.toString(),
            bpm: t.result.bpm,
            energy: t.result.energy,
            durationSec: t.result.durationSec,
        };
    }
}