import { describe, expect, it } from 'vitest';
import { Camelot, type CamelotLetter, type CamelotNumber } from '../../src/Analysis/Camelot.js';
import type { MusicalKey } from '../../src/Analysis/schemas.js';

describe('Camelot', (): void => {
    describe('fromKey', (): void => {
        it('maps A minor to 8A', (): void => {
            const code: Camelot = Camelot.fromKey({ tonic: 'A', mode: 'minor' });
            expect(code.toString()).toBe('8A');
        });

        it('maps C major to 8B', (): void => {
            const code: Camelot = Camelot.fromKey({ tonic: 'C', mode: 'major' });
            expect(code.toString()).toBe('8B');
        });

        it('maps G# minor to 1A', (): void => {
            const code: Camelot = Camelot.fromKey({ tonic: 'G#', mode: 'minor' });
            expect(code.toString()).toBe('1A');
        });

        it('maps E major to 12B', (): void => {
            const code: Camelot = Camelot.fromKey({ tonic: 'E', mode: 'major' });
            expect(code.toString()).toBe('12B');
        });

        it('round-trips every Camelot code through MusicalKey', (): void => {
            const numbers: CamelotNumber[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
            const letters: CamelotLetter[] = ['A', 'B'];
            for (const number of numbers) {
                for (const letter of letters) {
                    const original: Camelot = new Camelot(number, letter);
                    const key: MusicalKey = original.toKey();
                    const round: Camelot = Camelot.fromKey(key);
                    expect(round.toString()).toBe(original.toString());
                }
            }
        });
    });

    describe('fromString', (): void => {
        it('parses canonical notation', (): void => {
            const code: Camelot | null = Camelot.fromString('8A');
            expect(code).not.toBeNull();
            expect(code?.number).toBe(8);
            expect(code?.letter).toBe('A');
        });

        it('parses two-digit numbers', (): void => {
            const code: Camelot | null = Camelot.fromString('12B');
            expect(code).not.toBeNull();
            expect(code?.number).toBe(12);
            expect(code?.letter).toBe('B');
        });

        it('uppercases lowercase letters and trims', (): void => {
            const code: Camelot | null = Camelot.fromString(' 5b ');
            expect(code?.toString()).toBe('5B');
        });

        it('rejects out-of-range numbers', (): void => {
            expect(Camelot.fromString('13A')).toBeNull();
            expect(Camelot.fromString('0A')).toBeNull();
        });

        it('rejects unknown letters', (): void => {
            expect(Camelot.fromString('5C')).toBeNull();
            expect(Camelot.fromString('5')).toBeNull();
        });
    });

    describe('next / prev / switch', (): void => {
        it('next from 12A wraps to 1A', (): void => {
            expect(new Camelot(12, 'A').next().toString()).toBe('1A');
        });

        it('prev from 1B wraps to 12B', (): void => {
            expect(new Camelot(1, 'B').prev().toString()).toBe('12B');
        });

        it('switch toggles letter without changing number', (): void => {
            expect(new Camelot(8, 'A').switch().toString()).toBe('8B');
            expect(new Camelot(8, 'B').switch().toString()).toBe('8A');
        });
    });

    describe('isCompatibleWith', (): void => {
        const a: Camelot = new Camelot(8, 'A');

        it('is compatible with itself', (): void => {
            expect(a.isCompatibleWith(new Camelot(8, 'A'))).toBe(true);
        });

        it('is compatible with the relative key (same number, opposite letter)', (): void => {
            expect(a.isCompatibleWith(new Camelot(8, 'B'))).toBe(true);
        });

        it('is compatible with ±1 same letter', (): void => {
            expect(a.isCompatibleWith(new Camelot(7, 'A'))).toBe(true);
            expect(a.isCompatibleWith(new Camelot(9, 'A'))).toBe(true);
        });

        it('is not compatible with ±2 same letter', (): void => {
            expect(a.isCompatibleWith(new Camelot(6, 'A'))).toBe(false);
            expect(a.isCompatibleWith(new Camelot(10, 'A'))).toBe(false);
        });

        it('is not compatible with ±1 opposite letter', (): void => {
            expect(a.isCompatibleWith(new Camelot(7, 'B'))).toBe(false);
            expect(a.isCompatibleWith(new Camelot(9, 'B'))).toBe(false);
        });

        it('handles wrap-around at the wheel boundary', (): void => {
            const c1A: Camelot = new Camelot(1, 'A');
            expect(c1A.isCompatibleWith(new Camelot(12, 'A'))).toBe(true);
            expect(c1A.isCompatibleWith(new Camelot(2, 'A'))).toBe(true);
            expect(c1A.isCompatibleWith(new Camelot(1, 'B'))).toBe(true);
        });
    });

    describe('compatibleKeys', (): void => {
        it('returns exactly self, switch, next, prev', (): void => {
            const codes: string[] = new Camelot(8, 'A')
                .compatibleKeys()
                .map((c: Camelot): string => c.toString());
            expect(codes).toEqual(['8A', '8B', '9A', '7A']);
        });

        it('wraps correctly at the wheel boundary', (): void => {
            const codes: string[] = new Camelot(12, 'B')
                .compatibleKeys()
                .map((c: Camelot): string => c.toString());
            expect(codes).toEqual(['12B', '12A', '1B', '11B']);
        });
    });
});
