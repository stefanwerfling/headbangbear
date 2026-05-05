import { AudioAnalyzer } from '../Analysis/AudioAnalyzer.js';
import type { AnalysisResult } from '../Analysis/schemas.js';

/**
 * Defers the `EssentiaAudioAnalyzer` import until the first `analyze()` call. The point: the
 * essentia.js module installs a global `process.on('unhandledRejection', abort)` handler at
 * import time which conflicts with figtree's lifecycle. As long as the library cache hits on
 * server startup, the underlying analyzer is never loaded and that handler is never installed.
 */
export class LazyEssentiaAnalyzer extends AudioAnalyzer {
    private real: AudioAnalyzer | null = null;

    public override async analyze(filePath: string): Promise<AnalysisResult> {
        if (this.real === null) {
            const module: { EssentiaAudioAnalyzer: new () => AudioAnalyzer } = await import(
                '../Analysis/EssentiaAudioAnalyzer.js'
            );
            this.real = new module.EssentiaAudioAnalyzer();
        }
        return this.real.analyze(filePath);
    }
}