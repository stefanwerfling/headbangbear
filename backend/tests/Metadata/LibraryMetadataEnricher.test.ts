import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Camelot } from '../../src/Analysis/Camelot.js';
import { OpenKey } from '../../src/Analysis/OpenKey.js';
import type { AnalysisResult } from '../../src/Analysis/schemas.js';
import type { AnalyzedTrack } from '../../src/Library/TrackLibrary.js';
import { CoverArtCache } from '../../src/Metadata/CoverArtCache.js';
import { LibraryMetadataEnricher } from '../../src/Metadata/LibraryMetadataEnricher.js';
import { StubMetadataExtractor } from '../../src/Metadata/StubMetadataExtractor.js';
import { TrackMetadataCache } from '../../src/Metadata/TrackMetadataCache.js';
import type { ExtractedMetadata } from '../../src/Metadata/TrackMetadataExtractor.js';

function makeAnalyzedTrack(path: string): AnalyzedTrack {
    const camelot: Camelot = Camelot.fromKey({ tonic: 'A', mode: 'minor' });
    const openKey: OpenKey = OpenKey.fromCamelot(camelot);
    const result: AnalysisResult = {
        key: { tonic: 'A', mode: 'minor' },
        camelot: camelot,
        openKey: openKey,
        bpm: 128,
        energy: 0.5,
        durationSec: 200,
        beats: [],
        energyTimeline: [],
        drops: [],
    };
    return { path: path, result: result, hasCover: false };
}

describe('LibraryMetadataEnricher', (): void => {
    let dir: string;
    let cachePath: string;
    let coverCache: CoverArtCache;
    let metadataCache: TrackMetadataCache;

    beforeEach(async (): Promise<void> => {
        dir = await fs.mkdtemp(join(tmpdir(), 'hbb-enricher-'));
        cachePath = join(dir, '.metadata-cache.json');
        coverCache = new CoverArtCache(dir);
        metadataCache = new TrackMetadataCache(cachePath);
    });

    afterEach(async (): Promise<void> => {
        await fs.rm(dir, { recursive: true, force: true });
    });

    it('attaches metadata + hasCover to tracks and persists the cache', async (): Promise<void> => {
        const aPath: string = join(dir, 'a.mp3');
        await fs.writeFile(aPath, Buffer.alloc(64));
        const track: AnalyzedTrack = makeAnalyzedTrack(aPath);

        const stub: StubMetadataExtractor = new StubMetadataExtractor();
        const response: ExtractedMetadata = {
            metadata: { artist: 'A', title: 'T' },
            cover: { mime: 'image/jpeg', data: new Uint8Array([1, 2, 3]) },
        };
        stub.set(aPath, response);

        const enricher: LibraryMetadataEnricher = new LibraryMetadataEnricher(
            stub,
            coverCache,
            metadataCache,
        );
        await enricher.enrich([track]);

        expect(track.metadata).toEqual({ artist: 'A', title: 'T' });
        expect(track.hasCover).toBe(true);

        const cover: string | null = await coverCache.coverPath(aPath);
        expect(cover).not.toBeNull();
        const cached = await metadataCache.loadEntries();
        expect(cached.size).toBe(1);
        expect(cached.get(aPath)?.hasCover).toBe(true);
    });

    it('reuses the cache on a second run when mtime+size unchanged', async (): Promise<void> => {
        const aPath: string = join(dir, 'a.mp3');
        await fs.writeFile(aPath, Buffer.alloc(64));
        const track: AnalyzedTrack = makeAnalyzedTrack(aPath);

        let extractCount: number = 0;
        const extractor: StubMetadataExtractor = new StubMetadataExtractor();
        const original: typeof extractor.extract = extractor.extract.bind(extractor);
        extractor.extract = async (path: string): Promise<ExtractedMetadata> => {
            extractCount += 1;
            return original(path);
        };
        extractor.set(aPath, { metadata: { title: 'X' }, cover: null });

        await new LibraryMetadataEnricher(extractor, coverCache, metadataCache).enrich([track]);
        expect(extractCount).toBe(1);

        const track2: AnalyzedTrack = makeAnalyzedTrack(aPath);
        await new LibraryMetadataEnricher(extractor, coverCache, metadataCache).enrich([track2]);

        // Second call should hit the cache and not invoke the extractor again.
        expect(extractCount).toBe(1);
        expect(track2.metadata).toEqual({ title: 'X' });
    });

    it('re-extracts when the file mtime changes', async (): Promise<void> => {
        const aPath: string = join(dir, 'a.mp3');
        await fs.writeFile(aPath, Buffer.alloc(64));

        const extractor: StubMetadataExtractor = new StubMetadataExtractor();
        extractor.set(aPath, { metadata: { title: 'V1' }, cover: null });

        await new LibraryMetadataEnricher(
            extractor,
            coverCache,
            metadataCache,
        ).enrich([makeAnalyzedTrack(aPath)]);

        // Mutate file: change mtime by rewriting (size stays the same but mtimeMs ticks).
        await new Promise<void>((resolve): void => {
            setTimeout(resolve, 10);
        });
        await fs.writeFile(aPath, Buffer.alloc(64));

        extractor.set(aPath, { metadata: { title: 'V2' }, cover: null });
        const next: AnalyzedTrack = makeAnalyzedTrack(aPath);
        await new LibraryMetadataEnricher(extractor, coverCache, metadataCache).enrich([next]);

        expect(next.metadata).toEqual({ title: 'V2' });
    });

    it('clears the cover cache when a previously-covered entry becomes stale', async (): Promise<void> => {
        const aPath: string = join(dir, 'a.mp3');
        await fs.writeFile(aPath, Buffer.alloc(64));

        const extractor: StubMetadataExtractor = new StubMetadataExtractor();
        extractor.set(aPath, {
            metadata: { title: 'V1' },
            cover: { mime: 'image/jpeg', data: new Uint8Array([1]) },
        });

        await new LibraryMetadataEnricher(
            extractor,
            coverCache,
            metadataCache,
        ).enrich([makeAnalyzedTrack(aPath)]);
        expect(await coverCache.coverPath(aPath)).not.toBeNull();

        // Mutate the file so the cache entry goes stale, and the new extraction returns no
        // cover. The previously-written cover file must be removed.
        await new Promise<void>((resolve): void => {
            setTimeout(resolve, 10);
        });
        await fs.writeFile(aPath, Buffer.alloc(128));
        extractor.set(aPath, { metadata: { title: 'V2' }, cover: null });

        const next: AnalyzedTrack = makeAnalyzedTrack(aPath);
        await new LibraryMetadataEnricher(extractor, coverCache, metadataCache).enrich([next]);

        expect(next.hasCover).toBe(false);
        expect(await coverCache.coverPath(aPath)).toBeNull();
    });

    it('records an empty entry when extraction throws (does not abort the scan)', async (): Promise<void> => {
        const aPath: string = join(dir, 'a.mp3');
        const bPath: string = join(dir, 'b.mp3');
        await fs.writeFile(aPath, Buffer.alloc(64));
        await fs.writeFile(bPath, Buffer.alloc(64));

        const failing: StubMetadataExtractor = new StubMetadataExtractor();
        // a.mp3 throws; b.mp3 returns a real response
        const original: typeof failing.extract = failing.extract.bind(failing);
        failing.extract = async (path: string): Promise<ExtractedMetadata> => {
            if (path === aPath) {
                throw new Error('bad file');
            }
            return original(path);
        };
        failing.set(bPath, { metadata: { title: 'B' }, cover: null });

        const trackA: AnalyzedTrack = makeAnalyzedTrack(aPath);
        const trackB: AnalyzedTrack = makeAnalyzedTrack(bPath);
        await new LibraryMetadataEnricher(failing, coverCache, metadataCache).enrich([trackA, trackB]);

        expect(trackA.metadata).toEqual({});
        expect(trackA.hasCover).toBe(false);
        expect(trackB.metadata).toEqual({ title: 'B' });
    });
});