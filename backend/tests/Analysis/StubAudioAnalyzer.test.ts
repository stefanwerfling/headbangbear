import { describe, expect, it } from 'vitest';
import { AudioAnalyzer } from '../../src/Analysis/AudioAnalyzer.js';
import { StubAudioAnalyzer } from '../../src/Analysis/StubAudioAnalyzer.js';
import type { AnalysisResult } from '../../src/Analysis/schemas.js';

describe('StubAudioAnalyzer', (): void => {
    it('extends AudioAnalyzer (honors the contract)', (): void => {
        const analyzer: StubAudioAnalyzer = new StubAudioAnalyzer();
        expect(analyzer).toBeInstanceOf(AudioAnalyzer);
    });

    it('returns the configured fixed result with derived Camelot and OpenKey', async (): Promise<void> => {
        const analyzer: StubAudioAnalyzer = new StubAudioAnalyzer();
        const result: AnalysisResult = await analyzer.analyze('/nonexistent/path.mp3');

        expect(result.key).toEqual({ tonic: 'A', mode: 'minor' });
        expect(result.camelot.toString()).toBe('8A');
        expect(result.openKey.toString()).toBe('1m');
        expect(result.bpm).toBe(128);
        expect(result.energy).toBe(0.7);
        expect(result.durationSec).toBe(240);
    });

    it('honors constructor overrides', async (): Promise<void> => {
        const analyzer: StubAudioAnalyzer = new StubAudioAnalyzer(
            { tonic: 'C', mode: 'major' },
            174,
            0.95,
            300,
        );
        const result: AnalysisResult = await analyzer.analyze('any');

        expect(result.camelot.toString()).toBe('8B');
        expect(result.openKey.toString()).toBe('1d');
        expect(result.bpm).toBe(174);
        expect(result.energy).toBe(0.95);
        expect(result.durationSec).toBe(300);
    });

    it('result.camelot is a real Camelot instance with behavior', async (): Promise<void> => {
        const analyzer: StubAudioAnalyzer = new StubAudioAnalyzer();
        const result: AnalysisResult = await analyzer.analyze('any');

        const compatible: string[] = result.camelot
            .compatibleKeys()
            .map((c): string => c.toString());
        expect(compatible).toEqual(['8A', '8B', '9A', '7A']);
    });

    it('produces a beat grid matching the configured BPM', async (): Promise<void> => {
        const analyzer: StubAudioAnalyzer = new StubAudioAnalyzer(
            { tonic: 'A', mode: 'minor' },
            120,
            0.5,
            60,
        );
        const result: AnalysisResult = await analyzer.analyze('any');

        // 120 BPM = 2 beats/sec, 60 sec → 120 beats
        expect(result.beats).toHaveLength(120);
        expect(result.beats[0]).toBe(0);
        expect(result.beats[1]).toBe(0.5);
        expect(result.energyTimeline).toHaveLength(60);
        expect(result.energyTimeline.every((v): boolean => v === 0.5)).toBe(true);
    });
});
