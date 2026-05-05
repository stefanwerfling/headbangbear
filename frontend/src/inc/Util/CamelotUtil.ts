/**
 * Frontend mirror of `backend/src/Analysis/Camelot.isCompatibleWith` so we can filter
 * the library table client-side without a round-trip to `/api/v1/tracks/compatible`.
 *
 * Keep in sync with the backend rules:
 *   - same code              (8A ↔ 8A)
 *   - same number             (8A ↔ 8B — relative)
 *   - same letter, ±1 number  (8A ↔ 7A or 9A — perfect-fifth move)
 */

interface ParsedCamelot {
    readonly number: number;
    readonly letter: 'A' | 'B';
}

const CAMELOT_PATTERN: RegExp = /^([1-9]|1[0-2])([AB])$/u;

function parseCamelot(code: string): ParsedCamelot | null {
    const match: RegExpExecArray | null = CAMELOT_PATTERN.exec(code.trim().toUpperCase());
    if (match === null) {
        return null;
    }
    const num: number = Number.parseInt(match[1] ?? '', 10);
    const letter: string = match[2] ?? '';
    if (!Number.isFinite(num) || num < 1 || num > 12) {
        return null;
    }
    if (letter !== 'A' && letter !== 'B') {
        return null;
    }
    return { number: num, letter: letter };
}

function shiftNumber(n: number, delta: number): number {
    return ((((n - 1 + delta) % 12) + 12) % 12) + 1;
}

export class CamelotUtil {

    public static isCompatible(a: string, b: string): boolean {
        const pa: ParsedCamelot | null = parseCamelot(a);
        const pb: ParsedCamelot | null = parseCamelot(b);
        if (pa === null || pb === null) {
            return false;
        }
        if (pa.number === pb.number && pa.letter === pb.letter) {
            return true;
        }
        if (pa.number === pb.number) {
            return true;
        }
        if (pa.letter !== pb.letter) {
            return false;
        }
        const fwd: number = shiftNumber(pa.number, 1);
        const bwd: number = shiftNumber(pa.number, -1);
        return pb.number === fwd || pb.number === bwd;
    }

}