import {
    TransitionPlanSchema,
    type Alignment,
    type KeyMatch,
    type TransitionPlan,
    type TransitionStyle,
} from '@headbangbear/schemas';
import { Camelot } from '../Analysis/Camelot.js';
import type { AnalyzedTrack } from '../Library/TrackLibrary.js';

// Re-exports — keep `MixTransition.ts` as the single import-point for transition types so
// existing call sites (Server routes, tests, frontend Apis previously) don't have to learn
// about the schemas workspace yet.
export { TransitionPlanSchema };
export type { Alignment, KeyMatch, TransitionPlan, TransitionStyle };

const DEFAULT_MIX_BARS: number = 16;
const MIN_MIX_BARS: number = 8;
const TAIL_OUT_POST_DROP_BARS: number = 4;
const EARLY_CUT_PRE_DROP_BARS: number = 2;
const BEATS_PER_BAR: number = 4;
const ENERGY_THRESHOLD_RATIO: number = 0.55;
const PITCH_WARNING_THRESHOLD_PERCENT: number = 6;

const DEFAULT_STYLE: TransitionStyle = 'drop-on-drop';

export interface MixTransitionPlanOptions {
    readonly style?: TransitionStyle;
}

interface CueComputation {
    cueOutSec: number;
    cueInSec: number;
    mixDurationSec: number;
    mixBars: number;
    alignment: Alignment;
    strategyNotes: string[];
}

/**
 * Plans a single A→B transition: pitch shift to BPM-match, plus cue points and crossfade
 * length derived from each track's beat grid, energy timeline, and (when available) drops.
 *
 * Strategy selection in `plan()`:
 * 1. **Drop-aligned** (preferred): if both tracks have ≥1 detected drop, the crossfade is
 *    placed so A's last drop and B's first drop coincide in real wall time, with a 16-bar
 *    lead-in (floor 8). Pitch-shift is taken into account when projecting B's drop into
 *    wall time.
 * 2. **Energy-aligned** (fallback): A's mix-out ends at A's last "loud" second
 *    (energy ≥ max × 0.55); B's mix-in starts at B's first beat. Mix length is bounded by
 *    B's intro and A's available outro.
 */
export class MixTransition {
    private readonly from: AnalyzedTrack;

    private readonly to: AnalyzedTrack;

    public constructor(from: AnalyzedTrack, to: AnalyzedTrack) {
        this.from = from;
        this.to = to;
    }

    public plan(options: MixTransitionPlanOptions = {}): TransitionPlan {
        const fromBpm: number = this.from.result.bpm;
        const toBpm: number = this.to.result.bpm;
        const pitchPercent: number = Math.round((fromBpm / toBpm - 1) * 100 * 100) / 100;
        const resultingBpm: number = Math.round(toBpm * (1 + pitchPercent / 100) * 10) / 10;
        const pitchRatio: number = fromBpm / toBpm;

        const barSec: number = (60 / fromBpm) * BEATS_PER_BAR;

        const style: TransitionStyle = options.style ?? DEFAULT_STYLE;
        const cues: CueComputation = this.computeCuesForStyle(style, barSec, pitchRatio);

        const keyMatch: KeyMatch = MixTransition.classifyKeyMatch(
            this.from.result.camelot,
            this.to.result.camelot,
        );

        const notes: string[] = [];
        if (Math.abs(pitchPercent) > PITCH_WARNING_THRESHOLD_PERCENT) {
            notes.push(
                `Pitch shift ${pitchPercent.toFixed(1)}% exceeds typical ±${String(PITCH_WARNING_THRESHOLD_PERCENT)}% range — track will sound noticeably faster/slower.`,
            );
        }
        if (keyMatch === 'incompatible') {
            notes.push(
                `Keys ${this.from.result.camelot.toString()} → ${this.to.result.camelot.toString()} are not Camelot-compatible.`,
            );
        }
        notes.push(...cues.strategyNotes);

        return {
            from: {
                path: this.from.path,
                camelot: this.from.result.camelot.toString(),
                bpm: fromBpm,
                durationSec: this.from.result.durationSec,
                drops: this.from.result.drops,
            },
            to: {
                path: this.to.path,
                camelot: this.to.result.camelot.toString(),
                originalBpm: toBpm,
                pitchPercent: pitchPercent,
                resultingBpm: resultingBpm,
                drops: this.to.result.drops,
            },
            cueOutSec: cues.cueOutSec,
            cueInSec: cues.cueInSec,
            mixDurationSec: Math.round(cues.mixDurationSec * 10) / 10,
            mixBars: cues.mixBars,
            keyMatch: keyMatch,
            alignment: cues.alignment,
            style: style,
            notes: notes,
        };
    }

    private computeCuesForStyle(style: TransitionStyle, barSec: number, pitchRatio: number): CueComputation {
        if (style === 'bar-match') {
            return this.computeEnergyAlignedCues(barSec);
        }
        const dropBased: CueComputation | null =
            style === 'drop-on-drop' ? this.computeDropAlignedCues(barSec, pitchRatio)
                : style === 'tail-out' ? this.computeTailOutCues(barSec)
                    : style === 'early-cut' ? this.computeEarlyCutCues(barSec, pitchRatio)
                        : null;
        if (dropBased !== null) {
            return dropBased;
        }
        const fallback: CueComputation = this.computeEnergyAlignedCues(barSec);
        fallback.strategyNotes.unshift(
            `Style "${style}" requested but couldn't be honoured (drops missing or too close to track edge); falling back to energy alignment.`
        );
        return fallback;
    }

    /**
     * Drop-on-drop alignment: A's last drop and B's first drop coincide in wall time.
     * The crossfade ends at that aligned drop moment with a `DEFAULT_MIX_BARS`-bar lead-in
     * (shortened if either track lacks the runway). Returns null if the lead-in cannot reach
     * `MIN_MIX_BARS`, or if either track has no detected drops — caller falls back to the
     * energy strategy.
     */
    private computeDropAlignedCues(barSec: number, pitchRatio: number): CueComputation | null {
        const aDrops: number[] = this.from.result.drops;
        const bDrops: number[] = this.to.result.drops;
        if (aDrops.length === 0 || bDrops.length === 0) {
            return null;
        }
        const aLastDrop: number = aDrops[aDrops.length - 1] ?? 0;
        const bFirstDrop: number = bDrops[0] ?? 0;

        const targetLeadInWall: number = DEFAULT_MIX_BARS * barSec;
        const minLeadInWall: number = MIN_MIX_BARS * barSec;
        // Lead-in is wall time. A advances at 1×, B advances at pitchRatio×, so B's available
        // wall-time runway before its drop is bFirstDrop / pitchRatio.
        const maxLeadInWall: number = Math.min(aLastDrop, bFirstDrop / pitchRatio);
        if (maxLeadInWall < minLeadInWall) {
            return null;
        }
        const leadInWall: number = Math.min(targetLeadInWall, maxLeadInWall);

        const cueOutSec: number = MixTransition.snapToBar(
            this.from.result.beats,
            aLastDrop - leadInWall,
        );
        const effectiveLeadInWall: number = Math.max(0, aLastDrop - cueOutSec);
        const cueInSec: number = MixTransition.snapToBar(
            this.to.result.beats,
            bFirstDrop - effectiveLeadInWall * pitchRatio,
        );
        const mixBars: number = Math.round((effectiveLeadInWall / barSec) * 10) / 10;

        const strategyNotes: string[] = [];
        strategyNotes.push(
            `Drop-aligned: A's drop @${aLastDrop.toFixed(1)}s ↔ B's drop @${bFirstDrop.toFixed(1)}s, ${mixBars.toString()}-bar lead-in.`,
        );
        if (leadInWall < targetLeadInWall) {
            strategyNotes.push(
                `Lead-in shortened to ${mixBars.toString()} bars (target ${String(DEFAULT_MIX_BARS)}) — drops are too close to a track edge.`,
            );
        }

        return {
            cueOutSec: cueOutSec,
            cueInSec: cueInSec,
            mixDurationSec: effectiveLeadInWall,
            mixBars: mixBars,
            alignment: 'drop',
            strategyNotes: strategyNotes,
        };
    }

    /**
     * Tail-out: A's last drop plays out fully (`TAIL_OUT_POST_DROP_BARS` bars after the drop),
     * then the crossfade begins. B fades in from its first beat. The mix ends in B's intro,
     * before B's first drop has had a chance to hit. Climax sits on A's drop alone — B builds
     * tension afterwards.
     */
    private computeTailOutCues(barSec: number): CueComputation | null {
        const aDrops: number[] = this.from.result.drops;
        if (aDrops.length === 0) {
            return null;
        }
        const aLastDrop: number = aDrops[aDrops.length - 1] ?? 0;
        const postDropPad: number = TAIL_OUT_POST_DROP_BARS * barSec;
        const desiredCueOut: number = aLastDrop + postDropPad;

        const targetMixDuration: number = DEFAULT_MIX_BARS * barSec;
        const minMixDuration: number = MIN_MIX_BARS * barSec;
        const aRemaining: number = this.from.result.durationSec - desiredCueOut;
        if (aRemaining < minMixDuration) {
            return null;
        }
        const mixDurationSec: number = Math.min(targetMixDuration, aRemaining);

        const cueOutSec: number = MixTransition.snapToBar(this.from.result.beats, desiredCueOut);
        const cueInSec: number = MixTransition.snapToBar(
            this.to.result.beats,
            this.to.result.beats[0] ?? 0
        );
        const mixBars: number = Math.round((mixDurationSec / barSec) * 10) / 10;

        const strategyNotes: string[] = [
            `Tail-out: A's drop @${aLastDrop.toFixed(1)}s plays out (+${TAIL_OUT_POST_DROP_BARS.toString()} bars) before crossfade begins.`
        ];
        if (mixDurationSec < targetMixDuration) {
            strategyNotes.push(
                `Mix shortened to ${mixBars.toString()} bars (target ${String(DEFAULT_MIX_BARS)}) — A runs out shortly after the drop.`
            );
        }
        return {
            cueOutSec: cueOutSec,
            cueInSec: cueInSec,
            mixDurationSec: mixDurationSec,
            mixBars: mixBars,
            alignment: 'tail-out',
            strategyNotes: strategyNotes
        };
    }

    /**
     * Early-cut: A is faded out *before* its last drop (`EARLY_CUT_PRE_DROP_BARS` bars
     * earlier), so its drop never plays. The crossfade ends at B's first drop in wall time —
     * B's drop is the sole climax. Use when A's drop would compete with B's, or when you want
     * B to land hard without distraction.
     */
    private computeEarlyCutCues(barSec: number, pitchRatio: number): CueComputation | null {
        const aDrops: number[] = this.from.result.drops;
        const bDrops: number[] = this.to.result.drops;
        if (aDrops.length === 0 || bDrops.length === 0) {
            return null;
        }
        const aLastDrop: number = aDrops[aDrops.length - 1] ?? 0;
        const bFirstDrop: number = bDrops[0] ?? 0;
        const preDropPad: number = EARLY_CUT_PRE_DROP_BARS * barSec;

        const targetMixDuration: number = DEFAULT_MIX_BARS * barSec;
        const minMixDuration: number = MIN_MIX_BARS * barSec;
        // A's outro must end *before* its drop, with `preDropPad` cushion.
        // B's intro runway in wall time: bFirstDrop / pitchRatio.
        const aMaxOutro: number = Math.max(0, aLastDrop - preDropPad);
        const bMaxIntroWall: number = bFirstDrop / pitchRatio;
        const maxMixDuration: number = Math.min(aMaxOutro, bMaxIntroWall);
        if (maxMixDuration < minMixDuration) {
            return null;
        }
        const mixDurationSec: number = Math.min(targetMixDuration, maxMixDuration);

        const cueOutSec: number = MixTransition.snapToBar(
            this.from.result.beats,
            aMaxOutro - mixDurationSec
        );
        const cueInSec: number = MixTransition.snapToBar(
            this.to.result.beats,
            bFirstDrop - mixDurationSec * pitchRatio
        );
        const mixBars: number = Math.round((mixDurationSec / barSec) * 10) / 10;

        const strategyNotes: string[] = [
            `Early-cut: A faded out ${EARLY_CUT_PRE_DROP_BARS.toString()} bars before its drop @${aLastDrop.toFixed(1)}s; B's drop @${bFirstDrop.toFixed(1)}s is the climax.`
        ];
        if (mixDurationSec < targetMixDuration) {
            strategyNotes.push(
                `Mix shortened to ${mixBars.toString()} bars (target ${String(DEFAULT_MIX_BARS)}) — drops too close to a track edge.`
            );
        }
        return {
            cueOutSec: cueOutSec,
            cueInSec: cueInSec,
            mixDurationSec: mixDurationSec,
            mixBars: mixBars,
            alignment: 'early-cut',
            strategyNotes: strategyNotes
        };
    }

    private computeEnergyAlignedCues(barSec: number): CueComputation {
        const targetMixDuration: number = DEFAULT_MIX_BARS * barSec;

        const aLastLoud: number = MixTransition.lastLoudSecond(this.from);
        const bFirstLoud: number = MixTransition.firstLoudSecond(this.to);
        const bMixIn: number = this.to.result.beats[0] ?? 0;

        const aAvailableOutro: number = Math.max(0, aLastLoud);
        const bAvailableIntro: number = Math.max(0, bFirstLoud - bMixIn);

        const naturalMixDuration: number = Math.min(
            targetMixDuration,
            aAvailableOutro,
            bAvailableIntro > 0 ? bAvailableIntro : targetMixDuration,
        );
        const minMixDuration: number = MIN_MIX_BARS * barSec;
        const mixDurationSec: number = Math.max(minMixDuration, naturalMixDuration);
        const mixBars: number = Math.round((mixDurationSec / barSec) * 10) / 10;

        const cueOutSec: number = MixTransition.snapToBar(
            this.from.result.beats,
            aLastLoud - mixDurationSec,
        );
        const cueInSec: number = MixTransition.snapToBar(this.to.result.beats, bMixIn);

        const strategyNotes: string[] = [];
        if (bAvailableIntro <= 0) {
            strategyNotes.push(
                `Track B has no detectable low-energy intro — mix will overlap with B's main body.`,
            );
        }
        if (aAvailableOutro <= 0) {
            strategyNotes.push(
                `Track A has no detectable energetic body — mix-out point may not be musical.`,
            );
        }
        if (mixDurationSec < targetMixDuration && naturalMixDuration > 0) {
            strategyNotes.push(
                `Mix shortened to ${mixBars.toString()} bars (target ${String(DEFAULT_MIX_BARS)}) due to track length constraints.`,
            );
        }

        return {
            cueOutSec: cueOutSec,
            cueInSec: cueInSec,
            mixDurationSec: mixDurationSec,
            mixBars: mixBars,
            alignment: 'energy',
            strategyNotes: strategyNotes,
        };
    }

    private static lastLoudSecond(track: AnalyzedTrack): number {
        const timeline: number[] = track.result.energyTimeline;
        if (timeline.length === 0) {
            return track.result.durationSec;
        }
        const max: number = MixTransition.maxValue(timeline);
        const threshold: number = max * ENERGY_THRESHOLD_RATIO;
        for (let i = timeline.length - 1; i >= 0; i--) {
            const v: number = timeline[i] ?? 0;
            if (v >= threshold) {
                return i + 1;
            }
        }
        return track.result.durationSec;
    }

    private static firstLoudSecond(track: AnalyzedTrack): number {
        const timeline: number[] = track.result.energyTimeline;
        if (timeline.length === 0) {
            return 0;
        }
        const max: number = MixTransition.maxValue(timeline);
        const threshold: number = max * ENERGY_THRESHOLD_RATIO;
        for (let i = 0; i < timeline.length; i++) {
            const v: number = timeline[i] ?? 0;
            if (v >= threshold) {
                return i;
            }
        }
        return 0;
    }

    private static maxValue(arr: number[]): number {
        let max: number = 0;
        for (const v of arr) {
            if (v > max) {
                max = v;
            }
        }
        return max;
    }

    /**
     * Snaps `targetSec` to the nearest bar boundary using the track's beat grid.
     * Bar boundary = beat at index that is a multiple of BEATS_PER_BAR.
     */
    private static snapToBar(beats: number[], targetSec: number): number {
        if (beats.length === 0 || targetSec <= 0) {
            return Math.max(0, targetSec);
        }
        let closestBarIdx: number = 0;
        let closestDelta: number = Number.POSITIVE_INFINITY;
        for (let i = 0; i < beats.length; i += BEATS_PER_BAR) {
            const t: number = beats[i] ?? 0;
            const delta: number = Math.abs(t - targetSec);
            if (delta < closestDelta) {
                closestDelta = delta;
                closestBarIdx = i;
            } else if (t > targetSec) {
                break;
            }
        }
        const snapped: number = beats[closestBarIdx] ?? 0;
        return Math.round(snapped * 100) / 100;
    }

    private static classifyKeyMatch(a: Camelot, b: Camelot): KeyMatch {
        if (a.equals(b)) {
            return 'identical';
        }
        if (!a.isCompatibleWith(b)) {
            return 'incompatible';
        }
        if (a.number === b.number) {
            return 'relative';
        }
        const next: Camelot = a.next();
        if (b.equals(next)) {
            return 'energy-up';
        }
        return 'energy-down';
    }
}
