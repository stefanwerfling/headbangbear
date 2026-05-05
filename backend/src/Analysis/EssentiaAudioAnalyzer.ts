import { Essentia, EssentiaWASM, type EssentiaInstance, type EssentiaVector } from 'essentia.js';
import { FfmpegDecoder } from '../Audio/FfmpegDecoder.js';
import { AudioAnalyzer } from './AudioAnalyzer.js';
import { Camelot } from './Camelot.js';
import { OpenKey } from './OpenKey.js';
import { DropDetector } from './DropDetector.js';
import { ENERGY_WINDOW_SEC } from './schemas.js';
import type { AnalysisResult, KeyMode, MusicalKey, PitchClass } from './schemas.js';

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

/**
 * Real audio analysis backend using essentia.js (WebAssembly port of Essentia).
 * MP3 → ffmpeg → Float32 PCM @ 44.1kHz → essentia KeyExtractor + RhythmExtractor2013 + RMS.
 *
 * `profileType` controls essentia's KeyExtractor profile. Default `'bgate'` matches
 * essentia's own default. For tuning against EDM/dance libraries, `'edmm'`/`'edma'`/
 * `'faraldo'` often outperform on MIREX scoring; `'krumhansl'`/`'temperley'` are
 * classical-leaning. The `KeyProfileSweep` (under `src/Eval/`) compares them.
 */
export class EssentiaAudioAnalyzer extends AudioAnalyzer {
    private readonly decoder: FfmpegDecoder;

    private readonly dropDetector: DropDetector;

    private readonly profileType: string;

    private essentia: EssentiaInstance | null = null;

    public constructor(
        decoder: FfmpegDecoder = new FfmpegDecoder(),
        dropDetector: DropDetector = new DropDetector(),
        profileType: string = 'bgate',
    ) {
        super();
        this.decoder = decoder;
        this.dropDetector = dropDetector;
        this.profileType = profileType;
    }

    /**
     * Decode + KeyExtractor only, skipping rhythm/RMS/drops. Used by `KeyProfileSweep`
     * which needs many fast key predictions per track and doesn't care about the rest.
     */
    public async analyzeKeyOnly(filePath: string): Promise<MusicalKey> {
        const samples: Float32Array = await this.decoder.decode(filePath);
        if (samples.length === 0) {
            throw new Error(`No audio samples decoded from ${filePath}`);
        }
        const essentia: EssentiaInstance = await this.getEssentia();
        const vector: EssentiaVector = essentia.arrayToVector(samples);
        try {
            const keyRes = essentia.KeyExtractor(
                vector,
                undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
                this.profileType,
            );
            return {
                tonic: EssentiaAudioAnalyzer.normalizeTonic(keyRes.key),
                mode: EssentiaAudioAnalyzer.normalizeMode(keyRes.scale),
            };
        } finally {
            vector.delete();
        }
    }

    public override async analyze(filePath: string): Promise<AnalysisResult> {
        const samples: Float32Array = await this.decoder.decode(filePath);
        if (samples.length === 0) {
            throw new Error(`No audio samples decoded from ${filePath}`);
        }
        const essentia: EssentiaInstance = await this.getEssentia();
        const vector: EssentiaVector = essentia.arrayToVector(samples);
        try {
            const keyRes = essentia.KeyExtractor(
                vector,
                undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
                this.profileType,
            );
            const rhythm = essentia.RhythmExtractor2013(vector);
            const rms = essentia.RMS(vector);
            const beats: number[] = EssentiaAudioAnalyzer.extractBeats(essentia, rhythm.ticks);
            const energyTimeline: number[] = EssentiaAudioAnalyzer.computeEnergyTimeline(
                samples,
                this.decoder.rate,
            );
            const drops: number[] = this.dropDetector.detect(energyTimeline, ENERGY_WINDOW_SEC);

            const key: MusicalKey = {
                tonic: EssentiaAudioAnalyzer.normalizeTonic(keyRes.key),
                mode: EssentiaAudioAnalyzer.normalizeMode(keyRes.scale),
            };
            const camelot: Camelot = Camelot.fromKey(key);
            const openKey: OpenKey = OpenKey.fromCamelot(camelot);

            return {
                key: key,
                camelot: camelot,
                openKey: openKey,
                bpm: Math.round(rhythm.bpm * 10) / 10,
                energy: EssentiaAudioAnalyzer.normalizeEnergy(rms.rms),
                durationSec: Math.round((samples.length / this.decoder.rate) * 10) / 10,
                beats: beats,
                energyTimeline: energyTimeline,
                drops: drops,
            };
        } finally {
            vector.delete();
        }
    }

    private static extractBeats(essentia: EssentiaInstance, ticks: EssentiaVector): number[] {
        const arr: Float32Array = essentia.vectorToArray(ticks);
        const beats: number[] = new Array<number>(arr.length);
        for (let i = 0; i < arr.length; i++) {
            beats[i] = Math.round((arr[i] ?? 0) * 1000) / 1000;
        }
        return beats;
    }

    private static computeEnergyTimeline(samples: Float32Array, sampleRate: number): number[] {
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

    private async getEssentia(): Promise<EssentiaInstance> {
        if (this.essentia === null) {
            await EssentiaAudioAnalyzer.waitForWasm();
            this.essentia = new Essentia(EssentiaWASM);
        }
        return this.essentia;
    }

    private static waitForWasm(): Promise<void> {
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

    private static normalizeTonic(raw: string): PitchClass {
        const found: PitchClass | undefined = TONIC_NORMALIZATION[raw];
        if (found === undefined) {
            throw new Error(`Unknown tonic from essentia: "${raw}"`);
        }
        return found;
    }

    private static normalizeMode(raw: string): KeyMode {
        if (raw === 'major' || raw === 'minor') {
            return raw;
        }
        throw new Error(`Unknown mode from essentia: "${raw}"`);
    }

    private static normalizeEnergy(rms: number): number {
        if (Number.isNaN(rms) || rms < 0) {
            return 0;
        }
        if (rms > 1) {
            return 1;
        }
        return Math.round(rms * 1000) / 1000;
    }
}
