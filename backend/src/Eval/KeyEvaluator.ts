import { Camelot } from '../Analysis/Camelot.js';
import type { KeyMode, MusicalKey, PitchClass } from '../Analysis/schemas.js';
import type { KeyEvalCategory, KeyEvalEntry, KeyEvalReport } from './schemas.js';

const SCORE_BY_CATEGORY: Readonly<Record<KeyEvalCategory, number>> = {
    exact: 1.0,
    fifth: 0.5,
    relative: 0.3,
    parallel: 0.2,
    wrong: 0.0
};

const TONIC_NORMALIZATION: Readonly<Record<string, PitchClass>> = {
    C: 'C',
    'C#': 'C#',
    DB: 'C#',
    D: 'D',
    'D#': 'D#',
    EB: 'D#',
    E: 'E',
    F: 'F',
    'F#': 'F#',
    GB: 'F#',
    G: 'G',
    'G#': 'G#',
    AB: 'G#',
    A: 'A',
    'A#': 'A#',
    BB: 'A#',
    B: 'B'
};

const KEY_PATTERN: RegExp = /^([A-G])([#b]?)(?:\s*(m|M|min|minor|maj|major|MIN|MINOR|MAJ|MAJOR))?$/;
const CAMELOT_PATTERN: RegExp = /^([1-9]|1[0-2])[AB]$/i;

/**
 * MIREX-style evaluation of predicted vs. labelled keys. Categorises each pair and
 * computes a weighted accuracy score (1.0 / 0.5 / 0.3 / 0.2 / 0.0 for
 * exact / fifth / relative / parallel / wrong) — the same weights MIREX uses for its
 * "Audio Key Detection" task, so scores here are comparable to published baselines.
 */
export class KeyEvaluator {

    /**
     * Parses a free-form key label into a normalised `MusicalKey`. Accepts:
     * - `"A minor"`, `"A min"`, `"Am"` → A minor
     * - `"C"`, `"C major"`, `"C maj"`, `"CM"` → C major
     * - `"Bb minor"`, `"Eb major"` → flats normalised to sharps
     * - Camelot codes: `"8A"`, `"5B"`
     *
     * **Case matters for the lone `m`/`M` suffix** (DJ-software convention): `Am` = A minor,
     * `AM` = A major. To avoid the ambiguity, prefer `min`/`maj` or `minor`/`major`.
     *
     * Returns `null` on unrecognised input so callers can report which truth lines
     * failed parsing rather than crashing.
     */
    public static parseKey(input: string): MusicalKey | null {
        const trimmed: string = input.trim();
        if (CAMELOT_PATTERN.test(trimmed)) {
            const camelot: Camelot | null = Camelot.fromString(trimmed);
            return camelot === null ? null : camelot.toKey();
        }
        const match: RegExpExecArray | null = KEY_PATTERN.exec(trimmed);
        if (match === null) {
            return null;
        }
        const letter: string | undefined = match[1];
        const accidental: string | undefined = match[2];
        const modeRaw: string | undefined = match[3];
        if (letter === undefined) {
            return null;
        }
        const tonicKey: string = `${letter}${(accidental ?? '').toUpperCase()}`;
        const tonic: PitchClass | undefined = TONIC_NORMALIZATION[tonicKey];
        if (tonic === undefined) {
            return null;
        }
        return { tonic: tonic, mode: KeyEvaluator.parseMode(modeRaw) };
    }

    public static categorize(predicted: MusicalKey, actual: MusicalKey): KeyEvalCategory {
        const p: Camelot = Camelot.fromKey(predicted);
        const a: Camelot = Camelot.fromKey(actual);
        if (p.equals(a)) {
            return 'exact';
        }
        const numberDiff: number = ((p.number - a.number) % 12 + 12) % 12;
        if (p.letter === a.letter) {
            // Same mode → distance on the circle of fifths
            if (numberDiff === 1 || numberDiff === 11) {
                return 'fifth';
            }
            return 'wrong';
        }
        // Different modes
        if (numberDiff === 0) {
            return 'relative';
        }
        if (numberDiff === 3 || numberDiff === 9) {
            return 'parallel';
        }
        return 'wrong';
    }

    public static score(predicted: MusicalKey, actual: MusicalKey): number {
        return SCORE_BY_CATEGORY[KeyEvaluator.categorize(predicted, actual)];
    }

    /**
     * Evaluates a set of `predictions` against a set of `truth` labels. Both are
     * keyed by the same identifier (the CLI uses the track filename's basename).
     * Tracks present in only one side are reported separately, not scored.
     */
    public static evaluate(
        predictions: ReadonlyMap<string, MusicalKey>,
        truth: ReadonlyMap<string, MusicalKey>
    ): KeyEvalReport {
        const entries: KeyEvalEntry[] = [];
        const counts: Record<KeyEvalCategory, number> = {
            exact: 0,
            fifth: 0,
            relative: 0,
            parallel: 0,
            wrong: 0
        };
        let scoreSum: number = 0;
        const matchedNames: Set<string> = new Set();

        for (const [name, actual] of truth.entries()) {
            const predicted: MusicalKey | undefined = predictions.get(name);
            if (predicted === undefined) {
                continue;
            }
            matchedNames.add(name);
            const category: KeyEvalCategory = KeyEvaluator.categorize(predicted, actual);
            const score: number = SCORE_BY_CATEGORY[category];
            counts[category] += 1;
            scoreSum += score;
            entries.push({
                name: name,
                predicted: predicted,
                actual: actual,
                category: category,
                score: score
            });
        }

        entries.sort((a: KeyEvalEntry, b: KeyEvalEntry): number => a.name.localeCompare(b.name));

        const unmatchedTruth: string[] = [];
        for (const name of truth.keys()) {
            if (!matchedNames.has(name)) {
                unmatchedTruth.push(name);
            }
        }
        unmatchedTruth.sort();

        const untrackedPredictions: string[] = [];
        for (const name of predictions.keys()) {
            if (!truth.has(name)) {
                untrackedPredictions.push(name);
            }
        }
        untrackedPredictions.sort();

        const matched: number = entries.length;
        const mirexScore: number = matched === 0 ? 0 : scoreSum / matched;
        return {
            entries: entries,
            counts: counts,
            mirexScore: Math.round(mirexScore * 10000) / 10000,
            matched: matched,
            unmatchedTruth: unmatchedTruth,
            untrackedPredictions: untrackedPredictions
        };
    }

    private static parseMode(raw: string | undefined): KeyMode {
        if (raw === undefined) {
            return 'major';
        }
        if (raw === 'm' || raw === 'min' || raw === 'minor' || raw === 'MIN' || raw === 'MINOR') {
            return 'minor';
        }
        return 'major';
    }

}