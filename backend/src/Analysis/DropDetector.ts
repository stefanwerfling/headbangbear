/**
 * Detects "drop" moments in a track from its windowed-RMS energy timeline.
 *
 * Heuristic: a drop is a transition from a recent low-energy state to a high-energy state.
 * Concretely, an index `i` is flagged as a drop when:
 *   - timeline[i] >= maxEnergy * HIGH_RATIO, AND
 *   - any timeline[i - LOOKBACK_SEC .. i - 1] <= maxEnergy * LOW_RATIO, AND
 *   - the previous detected drop is at least MIN_SPACING_SEC ago.
 *
 * Returns timestamps in seconds (window-aligned, multiplied by `windowSec`).
 *
 * Limits of this approach: continuous-energy tracks (classical, ambient) yield zero drops
 * even if a listener perceives one — drop detection here means "kick-in after lull". For
 * proper structural analysis we'd need beat-synchronous spectral features.
 */
export class DropDetector {
    private readonly lowRatio: number;

    private readonly highRatio: number;

    private readonly lookbackSec: number;

    private readonly minSpacingSec: number;

    public constructor(
        lowRatio: number = 0.3,
        highRatio: number = 0.65,
        lookbackSec: number = 6,
        minSpacingSec: number = 16,
    ) {
        this.lowRatio = lowRatio;
        this.highRatio = highRatio;
        this.lookbackSec = lookbackSec;
        this.minSpacingSec = minSpacingSec;
    }

    public detect(energyTimeline: readonly number[], windowSec: number = 1): number[] {
        if (energyTimeline.length === 0 || windowSec <= 0) {
            return [];
        }
        const max: number = DropDetector.maxValue(energyTimeline);
        if (max <= 0) {
            return [];
        }
        const lowThreshold: number = max * this.lowRatio;
        const highThreshold: number = max * this.highRatio;
        const lookbackWindows: number = Math.max(1, Math.floor(this.lookbackSec / windowSec));
        const minSpacingWindows: number = Math.max(1, Math.floor(this.minSpacingSec / windowSec));

        const drops: number[] = [];
        let lastDropIdx: number = -minSpacingWindows;
        for (let i = 0; i < energyTimeline.length; i++) {
            const v: number = energyTimeline[i] ?? 0;
            if (v < highThreshold) {
                continue;
            }
            if (i - lastDropIdx < minSpacingWindows) {
                continue;
            }
            if (DropDetector.hadLow(energyTimeline, i, lookbackWindows, lowThreshold)) {
                drops.push(Math.round(i * windowSec * 10) / 10);
                lastDropIdx = i;
            }
        }
        return drops;
    }

    private static hadLow(
        timeline: readonly number[],
        currentIdx: number,
        lookbackWindows: number,
        lowThreshold: number,
    ): boolean {
        const start: number = Math.max(0, currentIdx - lookbackWindows);
        for (let j = start; j < currentIdx; j++) {
            const v: number = timeline[j] ?? 0;
            if (v <= lowThreshold) {
                return true;
            }
        }
        return false;
    }

    private static maxValue(arr: readonly number[]): number {
        let max: number = 0;
        for (const v of arr) {
            if (v > max) {
                max = v;
            }
        }
        return max;
    }
}
