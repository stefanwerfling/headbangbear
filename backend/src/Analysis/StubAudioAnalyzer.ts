import { AudioAnalyzer, type AnalyzerInput } from './AudioAnalyzer.js';
import { Camelot } from './Camelot.js';
import { OpenKey } from './OpenKey.js';
import type { AnalysisResult, MusicalKey } from './schemas.js';

/**
 * Placeholder analyzer returning fixed values. Used until a real backend
 * (essentia, KeyFinder, etc.) is wired up so the rest of the system can be
 * built and tested against the AudioAnalyzer contract.
 */
export class StubAudioAnalyzer extends AudioAnalyzer {
    private readonly key: MusicalKey;

    private readonly bpm: number;

    private readonly energy: number;

    private readonly durationSec: number;

    private readonly drops: readonly number[];

    public constructor(
        key: MusicalKey = { tonic: 'A', mode: 'minor' },
        bpm: number = 128,
        energy: number = 0.7,
        durationSec: number = 240,
        drops: readonly number[] = [],
    ) {
        super();
        this.key = key;
        this.bpm = bpm;
        this.energy = energy;
        this.durationSec = durationSec;
        this.drops = drops;
    }

    public override async analyze(_input: AnalyzerInput): Promise<AnalysisResult> {
        const camelot: Camelot = Camelot.fromKey(this.key);
        const openKey: OpenKey = OpenKey.fromCamelot(camelot);
        const beatInterval: number = 60 / this.bpm;
        const beatCount: number = Math.floor(this.durationSec / beatInterval);
        const beats: number[] = new Array<number>(beatCount);
        for (let i = 0; i < beatCount; i++) {
            beats[i] = Math.round(i * beatInterval * 1000) / 1000;
        }
        const energyTimeline: number[] = new Array<number>(Math.floor(this.durationSec)).fill(
            this.energy,
        );
        return Promise.resolve({
            key: this.key,
            camelot: camelot,
            openKey: openKey,
            bpm: this.bpm,
            energy: this.energy,
            durationSec: this.durationSec,
            beats: beats,
            energyTimeline: energyTimeline,
            drops: Array.from(this.drops),
        });
    }
}
