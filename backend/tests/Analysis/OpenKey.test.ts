import { describe, expect, it } from 'vitest';
import { Camelot, type CamelotLetter, type CamelotNumber } from '../../src/Analysis/Camelot.js';
import { OpenKey } from '../../src/Analysis/OpenKey.js';

describe('OpenKey', (): void => {
    describe('fromCamelot / toCamelot', (): void => {
        it('maps Camelot 8A to Open Key 1m (Mixed In Key convention)', (): void => {
            const ok: OpenKey = OpenKey.fromCamelot(new Camelot(8, 'A'));
            expect(ok.toString()).toBe('1m');
        });

        it('maps Camelot 8B to Open Key 1d', (): void => {
            const ok: OpenKey = OpenKey.fromCamelot(new Camelot(8, 'B'));
            expect(ok.toString()).toBe('1d');
        });

        it('maps Camelot 1A to Open Key 6m', (): void => {
            expect(OpenKey.fromCamelot(new Camelot(1, 'A')).toString()).toBe('6m');
        });

        it('maps Camelot 7B to Open Key 12d', (): void => {
            expect(OpenKey.fromCamelot(new Camelot(7, 'B')).toString()).toBe('12d');
        });

        it('round-trips every Camelot code through OpenKey', (): void => {
            const numbers: CamelotNumber[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
            const letters: CamelotLetter[] = ['A', 'B'];
            for (const number of numbers) {
                for (const letter of letters) {
                    const original: Camelot = new Camelot(number, letter);
                    const round: Camelot = OpenKey.fromCamelot(original).toCamelot();
                    expect(round.toString()).toBe(original.toString());
                }
            }
        });
    });

    describe('fromString', (): void => {
        it('parses canonical notation', (): void => {
            const ok: OpenKey | null = OpenKey.fromString('1m');
            expect(ok?.number).toBe(1);
            expect(ok?.mode).toBe('m');
        });

        it('parses two-digit numbers', (): void => {
            const ok: OpenKey | null = OpenKey.fromString('12d');
            expect(ok?.number).toBe(12);
            expect(ok?.mode).toBe('d');
        });

        it('lowercases uppercase letters and trims', (): void => {
            const ok: OpenKey | null = OpenKey.fromString(' 5M ');
            expect(ok?.toString()).toBe('5m');
        });

        it('rejects out-of-range numbers', (): void => {
            expect(OpenKey.fromString('13m')).toBeNull();
            expect(OpenKey.fromString('0d')).toBeNull();
        });

        it('rejects unknown modes', (): void => {
            expect(OpenKey.fromString('5x')).toBeNull();
            expect(OpenKey.fromString('5A')).toBeNull();
        });
    });
});
