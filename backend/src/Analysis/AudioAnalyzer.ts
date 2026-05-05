import type { AnalysisResult } from './schemas.js';

/**
 * Contract for any audio analysis backend (essentia CLI, KeyFinder, pure JS, ...).
 * Implementations decode `filePath` and produce key / BPM / energy.
 */
export abstract class AudioAnalyzer {
    public abstract analyze(filePath: string): Promise<AnalysisResult>;
}
