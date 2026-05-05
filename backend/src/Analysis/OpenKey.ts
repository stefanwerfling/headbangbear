import { Camelot, type CamelotNumber } from './Camelot.js';

export type OpenKeyMode = 'm' | 'd';

const CAMELOT_NUMBERS: readonly CamelotNumber[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

const OPEN_KEY_PATTERN: RegExp = /^([1-9]|1[0-2])([md])$/;

/**
 * Open Key Notation aligned with Mixed In Key:
 * Camelot 8A (A minor) = Open Key 1m, Camelot 8B (C major) = Open Key 1d.
 * Letter A maps to mode 'm' (moll); letter B maps to mode 'd' (dur).
 */
export class OpenKey {
    public readonly number: CamelotNumber;

    public readonly mode: OpenKeyMode;

    public constructor(number: CamelotNumber, mode: OpenKeyMode) {
        this.number = number;
        this.mode = mode;
    }

    public static fromCamelot(camelot: Camelot): OpenKey {
        const number: CamelotNumber = OpenKey.rotateFromCamelot(camelot.number);
        const mode: OpenKeyMode = camelot.letter === 'A' ? 'm' : 'd';
        return new OpenKey(number, mode);
    }

    public static fromString(input: string): OpenKey | null {
        const match: RegExpExecArray | null = OPEN_KEY_PATTERN.exec(input.trim().toLowerCase());
        if (match === null) {
            return null;
        }
        const numberPart: string | undefined = match[1];
        const modePart: string | undefined = match[2];
        if (numberPart === undefined || modePart === undefined) {
            return null;
        }
        const number: CamelotNumber = Number.parseInt(numberPart, 10) as CamelotNumber;
        const mode: OpenKeyMode = modePart as OpenKeyMode;
        return new OpenKey(number, mode);
    }

    public toCamelot(): Camelot {
        const number: CamelotNumber = OpenKey.rotateToCamelot(this.number);
        return new Camelot(number, this.mode === 'm' ? 'A' : 'B');
    }

    public toString(): string {
        return `${this.number}${this.mode}`;
    }

    public equals(other: OpenKey): boolean {
        return this.number === other.number && this.mode === other.mode;
    }

    private static rotateFromCamelot(camelotNumber: CamelotNumber): CamelotNumber {
        const idx: number = (((camelotNumber - 8) % 12) + 12) % 12;
        const next: CamelotNumber | undefined = CAMELOT_NUMBERS[idx];
        if (next === undefined) {
            throw new Error(`Open Key index out of range: ${idx}`);
        }
        return next;
    }

    private static rotateToCamelot(openKeyNumber: CamelotNumber): CamelotNumber {
        const idx: number = (((openKeyNumber - 1 + 7) % 12) + 12) % 12;
        const next: CamelotNumber | undefined = CAMELOT_NUMBERS[idx];
        if (next === undefined) {
            throw new Error(`Camelot index out of range: ${idx}`);
        }
        return next;
    }
}
