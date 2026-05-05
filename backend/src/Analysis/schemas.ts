import { Vts, type ExtractSchemaResultType } from 'vts';
import { Camelot } from './Camelot.js';
import { OpenKey } from './OpenKey.js';

export const KeyModeSchema = Vts.or([Vts.equal('major' as const), Vts.equal('minor' as const)]);
export type KeyMode = ExtractSchemaResultType<typeof KeyModeSchema>;

const PITCH_CLASSES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
export const PitchClassSchema = Vts.or(PITCH_CLASSES.map((p) => Vts.equal(p)));
export type PitchClass = ExtractSchemaResultType<typeof PitchClassSchema>;

export const MusicalKeySchema = Vts.object({
    tonic: PitchClassSchema,
    mode: KeyModeSchema,
});
export type MusicalKey = ExtractSchemaResultType<typeof MusicalKeySchema>;

const CAMELOT_STRING_PATTERN: RegExp = /^([1-9]|1[0-2])[AB]$/;
const OPEN_KEY_STRING_PATTERN: RegExp = /^([1-9]|1[0-2])[md]$/;

/**
 * In-memory analysis result. `camelot` and `openKey` are full domain class instances —
 * `Vts.instanceof` validates them as such when this schema is used at a boundary.
 */
/**
 * Width of one window (seconds) used to compute `energyTimeline`. Each entry is the RMS
 * over that window; together they form a coarse energy curve over the track.
 */
export const ENERGY_WINDOW_SEC: number = 1;

export const AnalysisResultSchema = Vts.object({
    key: MusicalKeySchema,
    camelot: Vts.instanceof(Camelot),
    openKey: Vts.instanceof(OpenKey),
    bpm: Vts.number(),
    energy: Vts.number(),
    durationSec: Vts.number(),
    /** Beat positions in seconds from the start of the track (from RhythmExtractor2013.ticks). */
    beats: Vts.array(Vts.number()),
    /** RMS energy per `ENERGY_WINDOW_SEC` window, in track order. */
    energyTimeline: Vts.array(Vts.number()),
    /** Drop timestamps (seconds) — sharp energy rises after a low. Empty for tracks without drops. */
    drops: Vts.array(Vts.number()),
});
export type AnalysisResult = ExtractSchemaResultType<typeof AnalysisResultSchema>;

/**
 * JSON-serialised form of `AnalysisResult` — Camelot/OpenKey become canonical strings
 * (e.g. "8A", "1m"). Used for the disk cache and any future wire format.
 */
export const SerializedAnalysisResultSchema = Vts.object({
    key: MusicalKeySchema,
    camelot: Vts.string({
        test: (s: string): boolean => CAMELOT_STRING_PATTERN.test(s),
    }),
    openKey: Vts.string({
        test: (s: string): boolean => OPEN_KEY_STRING_PATTERN.test(s),
    }),
    bpm: Vts.number(),
    energy: Vts.number(),
    durationSec: Vts.number(),
    beats: Vts.array(Vts.number()),
    energyTimeline: Vts.array(Vts.number()),
    drops: Vts.array(Vts.number()),
});
export type SerializedAnalysisResult = ExtractSchemaResultType<
    typeof SerializedAnalysisResultSchema
>;
