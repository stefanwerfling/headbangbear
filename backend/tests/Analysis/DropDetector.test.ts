import { describe, expect, it } from 'vitest';
import { DropDetector } from '../../src/Analysis/DropDetector.js';

/**
 * Builds a synthetic 1-Hz energy timeline by repeating segments of a fixed value.
 * E.g. `make([[0.1, 8], [1.0, 30]])` → 8 seconds at 0.1, then 30 seconds at 1.0.
 */
function make(segments: ReadonlyArray<readonly [number, number]>): number[] {
    const out: number[] = [];
    for (const [value, count] of segments) {
        for (let i = 0; i < count; i++) {
            out.push(value);
        }
    }
    return out;
}

describe('DropDetector', (): void => {
    it('returns no drops for an empty timeline', (): void => {
        expect(new DropDetector().detect([])).toEqual([]);
    });

    it('returns no drops for a flat-loud timeline (no preceding low)', (): void => {
        const timeline: number[] = make([[1.0, 60]]);
        expect(new DropDetector().detect(timeline)).toEqual([]);
    });

    it('returns no drops for a flat-quiet timeline', (): void => {
        const timeline: number[] = make([[0.05, 60]]);
        expect(new DropDetector().detect(timeline)).toEqual([]);
    });

    it('detects a single drop after a low-energy intro', (): void => {
        // 8 sec of low (0.1) → loud (1.0) for 30 sec
        const timeline: number[] = make([
            [0.1, 8],
            [1.0, 30],
        ]);
        const drops: number[] = new DropDetector().detect(timeline);
        expect(drops).toHaveLength(1);
        expect(drops[0]).toBe(8);
    });

    it('respects min spacing — does not double-count within a single loud section', (): void => {
        const timeline: number[] = make([
            [0.1, 8],
            [1.0, 60],
        ]);
        const drops: number[] = new DropDetector().detect(timeline);
        expect(drops).toHaveLength(1);
    });

    it('detects two drops separated by a breakdown', (): void => {
        // intro low (8) | drop1 loud (30) | breakdown low (10) | drop2 loud (30)
        const timeline: number[] = make([
            [0.1, 8],
            [1.0, 30],
            [0.1, 10],
            [1.0, 30],
        ]);
        const drops: number[] = new DropDetector().detect(timeline);
        expect(drops).toHaveLength(2);
        expect(drops[0]).toBe(8);
        expect(drops[1]).toBe(48);
    });

    it('ignores very small energy variations (mid-energy plateau)', (): void => {
        // Continuous mid-energy track (classical-style); no drops
        const timeline: number[] = [];
        for (let i = 0; i < 60; i++) {
            timeline.push(0.4 + Math.sin(i / 5) * 0.05);
        }
        const drops: number[] = new DropDetector().detect(timeline);
        expect(drops).toEqual([]);
    });

    it('honours a custom windowSec multiplier', (): void => {
        // Same shape but each timeline entry now represents 2 seconds
        const timeline: number[] = make([
            [0.1, 5],
            [1.0, 20],
        ]);
        const drops: number[] = new DropDetector().detect(timeline, 2);
        expect(drops).toHaveLength(1);
        // index 5 in 2-sec windows = 10 sec
        expect(drops[0]).toBe(10);
    });
});
