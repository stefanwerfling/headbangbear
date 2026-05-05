import { Readable } from 'node:stream';
import type { AnalysisResult } from './schemas.js';

/** Either a filesystem path (local library) or a `Readable` stream (remote / Jellyfin
 *  provider) — analyzers must accept both so the same pipeline can run regardless of
 *  whether bytes live on disk. */
export type AnalyzerInput = string | Readable;

/**
 * Contract for any audio analysis backend (essentia CLI, KeyFinder, pure JS, ...).
 * Implementations decode the input and produce key / BPM / energy.
 */
export abstract class AudioAnalyzer {
    public abstract analyze(input: AnalyzerInput): Promise<AnalysisResult>;
}
