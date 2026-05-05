declare module 'essentia.js' {
    export interface EssentiaVector {
        delete(): void;
        size(): number;
    }

    export interface KeyExtractorResult {
        key: string;
        scale: string;
        strength: number;
    }

    export interface RhythmResult {
        bpm: number;
        confidence: number;
        ticks: EssentiaVector;
    }

    export interface RmsResult {
        rms: number;
    }

    export interface EssentiaInstance {
        arrayToVector(input: Float32Array): EssentiaVector;
        vectorToArray(input: EssentiaVector): Float32Array;
        KeyExtractor(
            audio: EssentiaVector,
            averageDetuningCorrection?: boolean,
            frameSize?: number,
            hopSize?: number,
            hpcpSize?: number,
            maxFrequency?: number,
            maximumSpectralPeaks?: number,
            minFrequency?: number,
            pcpThreshold?: number,
            profileType?: string,
            sampleRate?: number,
        ): KeyExtractorResult;
        RhythmExtractor2013(
            signal: EssentiaVector,
            maxTempo?: number,
            method?: string,
        ): RhythmResult;
        RMS(array: EssentiaVector): RmsResult;
        shutdown(): void;
    }

    export interface EssentiaConstructor {
        new (wasm: unknown, isDebug?: boolean): EssentiaInstance;
    }

    /**
     * The Emscripten-generated WASM module. In Node, `require('essentia.js').EssentiaWASM`
     * resolves to this Module object directly (see essentia-wasm.umd.js: `module.exports = Module`).
     * Bindings (`EssentiaJS`) are populated asynchronously after `onRuntimeInitialized` fires.
     */
    export interface EssentiaWasmModule {
        EssentiaJS?: unknown;
        calledRun?: boolean;
        onRuntimeInitialized?: () => void;
    }

    export const Essentia: EssentiaConstructor;
    export const EssentiaWASM: EssentiaWasmModule;
}
