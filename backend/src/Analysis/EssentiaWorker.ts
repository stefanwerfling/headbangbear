import { parentPort } from 'node:worker_threads';
import { Essentia, EssentiaWASM, type EssentiaInstance, type EssentiaVector } from 'essentia.js';
import { DropDetector } from './DropDetector.js';
import { ENERGY_WINDOW_SEC, type KeyMode, type PitchClass } from './schemas.js';

const TONIC_NORMALIZATION: Readonly<Record<string, PitchClass>> = {
    C: 'C',
    'C#': 'C#',
    Db: 'C#',
    D: 'D',
    'D#': 'D#',
    Eb: 'D#',
    E: 'E',
    F: 'F',
    'F#': 'F#',
    Gb: 'F#',
    G: 'G',
    'G#': 'G#',
    Ab: 'G#',
    A: 'A',
    'A#': 'A#',
    Bb: 'A#',
    B: 'B',
};

/** Worker-side request payload. `keyOnly` skips RhythmExtractor / RMS / beats /
 *  energyTimeline / drops — used by the KeyProfileSweep flow which evaluates
 *  many profiles per track and only needs the predicted key. */
export interface AnalyzeRequest {
    readonly id: number;
    readonly samples: Float32Array;
    readonly sampleRate: number;
    readonly profileType: string;
    readonly keyOnly: boolean;
}

/** Worker → main payload. `ok: true` carries the analysis fields; `ok: false`
 *  carries a string error so the main thread can re-throw without trying to
 *  serialise an `Error` instance across the postMessage boundary. */
export type AnalyzeResponse =
    | {
        readonly id: number;
        readonly ok: true;
        readonly keyTonic: PitchClass;
        readonly keyMode: KeyMode;
        /** Below populated only when `keyOnly === false`. */
        readonly bpm?: number;
        readonly energy?: number;
        readonly durationSec?: number;
        readonly beats?: number[];
        readonly energyTimeline?: number[];
        readonly drops?: number[];
    }
    | {
        readonly id: number;
        readonly ok: false;
        readonly error: string;
    };

let essentiaInstance: EssentiaInstance | null = null;
const dropDetector: DropDetector = new DropDetector();

async function getEssentia(): Promise<EssentiaInstance> {
    if (essentiaInstance === null) {
        await waitForWasm();
        essentiaInstance = new Essentia(EssentiaWASM);
    }
    return essentiaInstance;
}

function waitForWasm(): Promise<void> {
    if (EssentiaWASM.EssentiaJS !== undefined) {
        return Promise.resolve();
    }
    return new Promise<void>((resolve): void => {
        const before: (() => void) | undefined = EssentiaWASM.onRuntimeInitialized;
        EssentiaWASM.onRuntimeInitialized = (): void => {
            if (before !== undefined) {
                before();
            }
            resolve();
        };
    });
}

function extractBeats(essentia: EssentiaInstance, ticks: EssentiaVector): number[] {
    const arr: Float32Array = essentia.vectorToArray(ticks);
    const beats: number[] = new Array<number>(arr.length);
    for (let i = 0; i < arr.length; i++) {
        beats[i] = Math.round((arr[i] ?? 0) * 1000) / 1000;
    }
    return beats;
}

function computeEnergyTimeline(samples: Float32Array, sampleRate: number): number[] {
    const windowSize: number = sampleRate * ENERGY_WINDOW_SEC;
    const windowCount: number = Math.floor(samples.length / windowSize);
    const out: number[] = new Array<number>(windowCount);
    for (let w = 0; w < windowCount; w++) {
        const start: number = w * windowSize;
        let sumSquares: number = 0;
        for (let i = 0; i < windowSize; i++) {
            const v: number = samples[start + i] ?? 0;
            sumSquares += v * v;
        }
        const rms: number = Math.sqrt(sumSquares / windowSize);
        out[w] = Math.round(rms * 1000) / 1000;
    }
    return out;
}

function normalizeTonic(raw: string): PitchClass {
    const found: PitchClass | undefined = TONIC_NORMALIZATION[raw];
    if (found === undefined) {
        throw new Error(`Unknown tonic from essentia: "${raw}"`);
    }
    return found;
}

function normalizeMode(raw: string): KeyMode {
    if (raw === 'major' || raw === 'minor') {
        return raw;
    }
    throw new Error(`Unknown mode from essentia: "${raw}"`);
}

function normalizeEnergy(rms: number): number {
    if (Number.isNaN(rms) || rms < 0) {
        return 0;
    }
    if (rms > 1) {
        return 1;
    }
    return Math.round(rms * 1000) / 1000;
}

if (parentPort === null) {
    throw new Error('EssentiaWorker must be run as a worker thread');
}
const port = parentPort;

port.on('message', (msg: AnalyzeRequest): void => {
    void (async (): Promise<void> => {
        try {
            const essentia: EssentiaInstance = await getEssentia();
            const vector: EssentiaVector = essentia.arrayToVector(msg.samples);
            try {
                const keyRes = essentia.KeyExtractor(
                    vector,
                    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
                    msg.profileType,
                );
                const tonic: PitchClass = normalizeTonic(keyRes.key);
                const mode: KeyMode = normalizeMode(keyRes.scale);
                if (msg.keyOnly) {
                    const response: AnalyzeResponse = {
                        id: msg.id,
                        ok: true,
                        keyTonic: tonic,
                        keyMode: mode,
                    };
                    port.postMessage(response);
                    return;
                }
                const rhythm = essentia.RhythmExtractor2013(vector);
                const rms = essentia.RMS(vector);
                const beats: number[] = extractBeats(essentia, rhythm.ticks);
                const energyTimeline: number[] = computeEnergyTimeline(msg.samples, msg.sampleRate);
                const drops: number[] = dropDetector.detect(energyTimeline, ENERGY_WINDOW_SEC);
                const response: AnalyzeResponse = {
                    id: msg.id,
                    ok: true,
                    keyTonic: tonic,
                    keyMode: mode,
                    bpm: Math.round(rhythm.bpm * 10) / 10,
                    energy: normalizeEnergy(rms.rms),
                    durationSec: Math.round((msg.samples.length / msg.sampleRate) * 10) / 10,
                    beats: beats,
                    energyTimeline: energyTimeline,
                    drops: drops,
                };
                port.postMessage(response);
            } finally {
                vector.delete();
            }
        } catch (err) {
            const response: AnalyzeResponse = {
                id: msg.id,
                ok: false,
                error: err instanceof Error ? err.message : String(err),
            };
            port.postMessage(response);
        }
    })();
});