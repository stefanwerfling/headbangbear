import { describe, expect, it } from 'vitest';
import { Analyze, type AnalyzeOutput } from '../../src/Cli/Analyze.js';
import { StubAudioAnalyzer } from '../../src/Analysis/StubAudioAnalyzer.js';

describe('Analyze (CLI)', (): void => {
    it('produces a flat JSON-friendly output from the analyzer', async (): Promise<void> => {
        const cli: Analyze = new Analyze(new StubAudioAnalyzer());
        const output: AnalyzeOutput = await cli.run('/some/path/to/song.mp3');

        expect(output).toEqual({
            file: '/some/path/to/song.mp3',
            key: 'A minor',
            camelot: '8A',
            openKey: '1m',
            bpm: 128,
            energy: 0.7,
            durationSec: 240,
            drops: [],
        });
    });

    it('uses the configured analyzer instance', async (): Promise<void> => {
        const cli: Analyze = new Analyze(
            new StubAudioAnalyzer({ tonic: 'C', mode: 'major' }, 174, 0.95, 300),
        );
        const output: AnalyzeOutput = await cli.run('any.mp3');

        expect(output.key).toBe('C major');
        expect(output.camelot).toBe('8B');
        expect(output.openKey).toBe('1d');
        expect(output.bpm).toBe(174);
    });

    it('main returns exit code 1 when no path is given', async (): Promise<void> => {
        const code: number = await Analyze.main(['node', 'Analyze.ts']);
        expect(code).toBe(1);
    });

    it('main returns exit code 1 when the file does not exist', async (): Promise<void> => {
        const code: number = await Analyze.main([
            'node',
            'Analyze.ts',
            '/definitely/does/not/exist/song.mp3',
        ]);
        expect(code).toBe(1);
    });
});
