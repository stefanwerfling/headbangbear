import type { KeyMode, MusicalKey, PitchClass } from './schemas.js';

export type CamelotNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
export type CamelotLetter = 'A' | 'B';

interface CamelotEntry {
    readonly number: CamelotNumber;
    readonly letter: CamelotLetter;
    readonly tonic: PitchClass;
    readonly mode: KeyMode;
}

const CAMELOT_NUMBERS: readonly CamelotNumber[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

const CAMELOT_TABLE: readonly CamelotEntry[] = [
    { number: 1, letter: 'A', tonic: 'G#', mode: 'minor' },
    { number: 1, letter: 'B', tonic: 'B', mode: 'major' },
    { number: 2, letter: 'A', tonic: 'D#', mode: 'minor' },
    { number: 2, letter: 'B', tonic: 'F#', mode: 'major' },
    { number: 3, letter: 'A', tonic: 'A#', mode: 'minor' },
    { number: 3, letter: 'B', tonic: 'C#', mode: 'major' },
    { number: 4, letter: 'A', tonic: 'F', mode: 'minor' },
    { number: 4, letter: 'B', tonic: 'G#', mode: 'major' },
    { number: 5, letter: 'A', tonic: 'C', mode: 'minor' },
    { number: 5, letter: 'B', tonic: 'D#', mode: 'major' },
    { number: 6, letter: 'A', tonic: 'G', mode: 'minor' },
    { number: 6, letter: 'B', tonic: 'A#', mode: 'major' },
    { number: 7, letter: 'A', tonic: 'D', mode: 'minor' },
    { number: 7, letter: 'B', tonic: 'F', mode: 'major' },
    { number: 8, letter: 'A', tonic: 'A', mode: 'minor' },
    { number: 8, letter: 'B', tonic: 'C', mode: 'major' },
    { number: 9, letter: 'A', tonic: 'E', mode: 'minor' },
    { number: 9, letter: 'B', tonic: 'G', mode: 'major' },
    { number: 10, letter: 'A', tonic: 'B', mode: 'minor' },
    { number: 10, letter: 'B', tonic: 'D', mode: 'major' },
    { number: 11, letter: 'A', tonic: 'F#', mode: 'minor' },
    { number: 11, letter: 'B', tonic: 'A', mode: 'major' },
    { number: 12, letter: 'A', tonic: 'C#', mode: 'minor' },
    { number: 12, letter: 'B', tonic: 'E', mode: 'major' },
];

const KEY_LOOKUP: ReadonlyMap<string, CamelotEntry> = new Map(
    CAMELOT_TABLE.map((entry: CamelotEntry): [string, CamelotEntry] => [
        `${entry.tonic}|${entry.mode}`,
        entry,
    ]),
);

const CODE_LOOKUP: ReadonlyMap<string, CamelotEntry> = new Map(
    CAMELOT_TABLE.map((entry: CamelotEntry): [string, CamelotEntry] => [
        `${entry.number}${entry.letter}`,
        entry,
    ]),
);

const CAMELOT_PATTERN: RegExp = /^([1-9]|1[0-2])([AB])$/;

const OPPOSITE_LETTER: Readonly<Record<CamelotLetter, CamelotLetter>> = { A: 'B', B: 'A' };

export class Camelot {
    public readonly number: CamelotNumber;

    public readonly letter: CamelotLetter;

    public constructor(number: CamelotNumber, letter: CamelotLetter) {
        this.number = number;
        this.letter = letter;
    }

    public static fromKey(key: MusicalKey): Camelot {
        const entry: CamelotEntry | undefined = KEY_LOOKUP.get(`${key.tonic}|${key.mode}`);
        if (entry === undefined) {
            throw new Error(`Unknown musical key: ${key.tonic} ${key.mode}`);
        }
        return new Camelot(entry.number, entry.letter);
    }

    public static fromString(input: string): Camelot | null {
        const match: RegExpExecArray | null = CAMELOT_PATTERN.exec(input.trim().toUpperCase());
        if (match === null) {
            return null;
        }
        const numberPart: string | undefined = match[1];
        const letterPart: string | undefined = match[2];
        if (numberPart === undefined || letterPart === undefined) {
            return null;
        }
        const number: CamelotNumber = Number.parseInt(numberPart, 10) as CamelotNumber;
        const letter: CamelotLetter = letterPart as CamelotLetter;
        return new Camelot(number, letter);
    }

    public toKey(): MusicalKey {
        const entry: CamelotEntry | undefined = CODE_LOOKUP.get(`${this.number}${this.letter}`);
        if (entry === undefined) {
            throw new Error(`Unknown Camelot code: ${this.toString()}`);
        }
        return { tonic: entry.tonic, mode: entry.mode };
    }

    public toString(): string {
        return `${this.number}${this.letter}`;
    }

    public equals(other: Camelot): boolean {
        return this.number === other.number && this.letter === other.letter;
    }

    public next(): Camelot {
        return new Camelot(Camelot.shiftNumber(this.number, 1), this.letter);
    }

    public prev(): Camelot {
        return new Camelot(Camelot.shiftNumber(this.number, -1), this.letter);
    }

    public switch(): Camelot {
        return new Camelot(this.number, OPPOSITE_LETTER[this.letter]);
    }

    /**
     * Harmonic compatibility per the Camelot wheel: same code, energy boost (±1 same letter),
     * or relative key switch (same number, opposite letter).
     */
    public isCompatibleWith(other: Camelot): boolean {
        if (this.equals(other)) {
            return true;
        }
        if (this.number === other.number) {
            return true;
        }
        if (this.letter !== other.letter) {
            return false;
        }
        const forward: CamelotNumber = Camelot.shiftNumber(this.number, 1);
        const backward: CamelotNumber = Camelot.shiftNumber(this.number, -1);
        return other.number === forward || other.number === backward;
    }

    public compatibleKeys(): Camelot[] {
        return [this, this.switch(), this.next(), this.prev()];
    }

    private static shiftNumber(n: CamelotNumber, delta: number): CamelotNumber {
        const idx: number = (((n - 1 + delta) % 12) + 12) % 12;
        const next: CamelotNumber | undefined = CAMELOT_NUMBERS[idx];
        if (next === undefined) {
            throw new Error(`Camelot index out of range: ${idx}`);
        }
        return next;
    }
}
