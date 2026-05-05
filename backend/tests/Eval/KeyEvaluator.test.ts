import { describe, expect, it } from 'vitest';
import type { MusicalKey } from '../../src/Analysis/schemas.js';
import { KeyEvaluator } from '../../src/Eval/KeyEvaluator.js';

const Aminor: MusicalKey = { tonic: 'A', mode: 'minor' };
const Cmajor: MusicalKey = { tonic: 'C', mode: 'major' };
const Gmajor: MusicalKey = { tonic: 'G', mode: 'major' };
const Fmajor: MusicalKey = { tonic: 'F', mode: 'major' };
const Dminor: MusicalKey = { tonic: 'D', mode: 'minor' };
const Eminor: MusicalKey = { tonic: 'E', mode: 'minor' };
const Amajor: MusicalKey = { tonic: 'A', mode: 'major' };
const Cminor: MusicalKey = { tonic: 'C', mode: 'minor' };
const Bminor: MusicalKey = { tonic: 'B', mode: 'minor' };

describe('KeyEvaluator.parseKey', (): void => {

    it('parses canonical "A minor"', (): void => {
        expect(KeyEvaluator.parseKey('A minor')).toEqual(Aminor);
    });

    it('parses short-hand "Am" as minor (lowercase m)', (): void => {
        expect(KeyEvaluator.parseKey('Am')).toEqual(Aminor);
    });

    it('parses bare tonic "C" as major', (): void => {
        expect(KeyEvaluator.parseKey('C')).toEqual(Cmajor);
    });

    it('parses "CM" as major (uppercase M)', (): void => {
        expect(KeyEvaluator.parseKey('CM')).toEqual(Cmajor);
    });

    it('normalises flats to sharps: "Bb minor" → A# minor', (): void => {
        expect(KeyEvaluator.parseKey('Bb minor')).toEqual({ tonic: 'A#', mode: 'minor' });
    });

    it('parses Camelot codes', (): void => {
        expect(KeyEvaluator.parseKey('8A')).toEqual(Aminor);
        expect(KeyEvaluator.parseKey('8B')).toEqual(Cmajor);
    });

    it('returns null for nonsense', (): void => {
        expect(KeyEvaluator.parseKey('hello world')).toBeNull();
        expect(KeyEvaluator.parseKey('H minor')).toBeNull();
    });

});

describe('KeyEvaluator.categorize', (): void => {

    it('exact match scores 1.0', (): void => {
        expect(KeyEvaluator.categorize(Aminor, Aminor)).toBe('exact');
        expect(KeyEvaluator.score(Aminor, Aminor)).toBe(1.0);
    });

    it('perfect-fifth up: C major vs G major', (): void => {
        expect(KeyEvaluator.categorize(Cmajor, Gmajor)).toBe('fifth');
        expect(KeyEvaluator.score(Cmajor, Gmajor)).toBe(0.5);
    });

    it('perfect-fifth down: C major vs F major', (): void => {
        expect(KeyEvaluator.categorize(Cmajor, Fmajor)).toBe('fifth');
    });

    it('fifth direction independent: F major vs C major also fifth', (): void => {
        expect(KeyEvaluator.categorize(Fmajor, Cmajor)).toBe('fifth');
    });

    it('relative: A minor vs C major', (): void => {
        expect(KeyEvaluator.categorize(Aminor, Cmajor)).toBe('relative');
        expect(KeyEvaluator.score(Aminor, Cmajor)).toBe(0.3);
    });

    it('relative reverse: C major vs A minor', (): void => {
        expect(KeyEvaluator.categorize(Cmajor, Aminor)).toBe('relative');
    });

    it('parallel: C major vs C minor', (): void => {
        expect(KeyEvaluator.categorize(Cmajor, Cminor)).toBe('parallel');
        expect(KeyEvaluator.score(Cmajor, Cminor)).toBe(0.2);
    });

    it('parallel reverse: A minor vs A major', (): void => {
        expect(KeyEvaluator.categorize(Aminor, Amajor)).toBe('parallel');
    });

    it('relative is direction-correct: D minor relates to F major, not C major', (): void => {
        expect(KeyEvaluator.categorize(Dminor, { tonic: 'F', mode: 'major' })).toBe('relative');
        expect(KeyEvaluator.categorize(Dminor, Cmajor)).toBe('wrong');
        expect(KeyEvaluator.categorize(Dminor, Gmajor)).toBe('wrong');
    });

    it('wrong: B minor vs C major (no fifth/rel/parallel)', (): void => {
        expect(KeyEvaluator.categorize(Bminor, Cmajor)).toBe('wrong');
        expect(KeyEvaluator.score(Bminor, Cmajor)).toBe(0.0);
    });

    it('fifth between minors: A minor vs E minor', (): void => {
        expect(KeyEvaluator.categorize(Aminor, Eminor)).toBe('fifth');
    });

});

describe('KeyEvaluator.evaluate', (): void => {

    it('groups counts by category, computes weighted MIREX score, sorts entries', (): void => {
        const predictions: Map<string, MusicalKey> = new Map([
            ['track-a', Aminor],   // exact
            ['track-b', Gmajor],   // fifth
            ['track-c', Cmajor],   // relative
            ['track-d', Cminor],   // parallel
            ['track-e', Bminor]    // wrong
        ]);
        const truth: Map<string, MusicalKey> = new Map([
            ['track-a', Aminor],
            ['track-b', Cmajor],
            ['track-c', Aminor],
            ['track-d', Cmajor],
            ['track-e', Cmajor]
        ]);
        const report = KeyEvaluator.evaluate(predictions, truth);
        expect(report.matched).toBe(5);
        expect(report.counts).toEqual({ exact: 1, fifth: 1, relative: 1, parallel: 1, wrong: 1 });
        // (1.0 + 0.5 + 0.3 + 0.2 + 0.0) / 5 = 0.4
        expect(report.mirexScore).toBe(0.4);
        // entries sorted alphabetically by name
        expect(report.entries.map((e): string => e.name)).toEqual([
            'track-a', 'track-b', 'track-c', 'track-d', 'track-e'
        ]);
    });

    it('reports unmatched truth and untracked predictions', (): void => {
        const predictions: Map<string, MusicalKey> = new Map([
            ['only-in-cache', Aminor],
            ['both', Aminor]
        ]);
        const truth: Map<string, MusicalKey> = new Map([
            ['both', Aminor],
            ['only-in-truth', Cmajor]
        ]);
        const report = KeyEvaluator.evaluate(predictions, truth);
        expect(report.matched).toBe(1);
        expect(report.unmatchedTruth).toEqual(['only-in-truth']);
        expect(report.untrackedPredictions).toEqual(['only-in-cache']);
        expect(report.mirexScore).toBe(1.0);
    });

    it('returns 0 mirex score with no matches', (): void => {
        const report = KeyEvaluator.evaluate(new Map(), new Map([['x', Aminor]]));
        expect(report.matched).toBe(0);
        expect(report.mirexScore).toBe(0);
    });

});