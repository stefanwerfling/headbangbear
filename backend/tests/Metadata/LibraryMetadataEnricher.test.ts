import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DataSource, Repository } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Camelot } from '../../src/Analysis/Camelot.js';
import { OpenKey } from '../../src/Analysis/OpenKey.js';
import type { AnalysisResult } from '../../src/Analysis/schemas.js';
import { TrackMetadataEntity } from '../../src/Database/Entity/TrackMetadataEntity.js';
import type { AnalyzedTrack } from '../../src/Library/TrackLibrary.js';
import { CoverArtCache } from '../../src/Metadata/CoverArtCache.js';
import { LibraryMetadataEnricher } from '../../src/Metadata/LibraryMetadataEnricher.js';
import { StubMetadataExtractor } from '../../src/Metadata/StubMetadataExtractor.js';
import type { ExtractedMetadata } from '../../src/Metadata/TrackMetadataExtractor.js';
import { createInMemoryDataSource } from '../helpers/testDataSource.js';

const PROVIDER_ID: string = 'test-local';

function makeAnalyzedTrack(relPath: string): AnalyzedTrack {
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
    return { providerId: PROVIDER_ID, path: relPath, result: result, hasCover: false, disabled: false };
}

describe('LibraryMetadataEnricher', (): void => {
    let dir: string;
    let coverDir: string;
    let coverCache: CoverArtCache;
    let ds: DataSource;
    let metaRepo: Repository<TrackMetadataEntity>;

    beforeEach(async (): Promise<void> => {
        dir = await fs.mkdtemp(join(tmpdir(), 'hbb-enricher-'));
        coverDir = join(dir, '.covers');
        coverCache = new CoverArtCache(coverDir);
        ds = await createInMemoryDataSource();
        metaRepo = ds.getRepository(TrackMetadataEntity);
    });

    afterEach(async (): Promise<void> => {
        await ds.destroy();
        await fs.rm(dir, { recursive: true, force: true });
    });

    function newEnricher(extractor: StubMetadataExtractor): LibraryMetadataEnricher {
        return new LibraryMetadataEnricher(
            PROVIDER_ID,
            dir,
            extractor,
            coverCache,
            metaRepo,
        );
    }

    it('attaches metadata + hasCover to tracks and persists the row', async (): Promise<void> => {
        const aRel: string = 'a.mp3';
        await fs.writeFile(join(dir, aRel), Buffer.alloc(64));
        const track: AnalyzedTrack = makeAnalyzedTrack(aRel);

        const stub: StubMetadataExtractor = new StubMetadataExtractor();
        const response: ExtractedMetadata = {
            metadata: { artist: 'A', title: 'T' },
            cover: { mime: 'image/jpeg', data: new Uint8Array([1, 2, 3]) },
        };
        stub.set(join(dir, aRel), response);

        await newEnricher(stub).enrich([track]);

        expect(track.metadata).toEqual({ artist: 'A', title: 'T' });
        expect(track.hasCover).toBe(true);

        const cover: string | null = await coverCache.coverPath(aRel);
        expect(cover).not.toBeNull();
        const stored: TrackMetadataEntity[] = await metaRepo.find();
        expect(stored).toHaveLength(1);
        expect(stored[0]?.hasCover).toBe(true);
        expect(stored[0]?.artist).toBe('A');
    });

    it('reuses the DB row on a second run without re-extracting', async (): Promise<void> => {
        const aRel: string = 'a.mp3';
        const aAbs: string = join(dir, aRel);
        await fs.writeFile(aAbs, Buffer.alloc(64));

        let extractCount: number = 0;
        const extractor: StubMetadataExtractor = new StubMetadataExtractor();
        const original: typeof extractor.extract = extractor.extract.bind(extractor);
        extractor.extract = async (path: string): Promise<ExtractedMetadata> => {
            extractCount += 1;
            return original(path);
        };
        extractor.set(aAbs, { metadata: { title: 'X' }, cover: null });

        const track: AnalyzedTrack = makeAnalyzedTrack(aRel);
        await newEnricher(extractor).enrich([track]);
        expect(extractCount).toBe(1);

        const track2: AnalyzedTrack = makeAnalyzedTrack(aRel);
        await newEnricher(extractor).enrich([track2]);
        expect(extractCount).toBe(1);
        expect(track2.metadata).toEqual({ title: 'X' });
    });

    it('re-extracts when the existing metadata row is missing', async (): Promise<void> => {
        const aRel: string = 'a.mp3';
        const aAbs: string = join(dir, aRel);
        await fs.writeFile(aAbs, Buffer.alloc(64));

        const extractor: StubMetadataExtractor = new StubMetadataExtractor();
        extractor.set(aAbs, { metadata: { title: 'V1' }, cover: null });

        await newEnricher(extractor).enrich([makeAnalyzedTrack(aRel)]);

        // Simulate the analysis upsert dropping the metadata row (file changed):
        await metaRepo.delete({ providerId: PROVIDER_ID, sourceId: aRel });

        extractor.set(aAbs, { metadata: { title: 'V2' }, cover: null });
        const next: AnalyzedTrack = makeAnalyzedTrack(aRel);
        await newEnricher(extractor).enrich([next]);

        expect(next.metadata).toEqual({ title: 'V2' });
    });

    it('records an empty row when extraction throws (does not abort)', async (): Promise<void> => {
        const aRel: string = 'a.mp3';
        const bRel: string = 'b.mp3';
        const aAbs: string = join(dir, aRel);
        const bAbs: string = join(dir, bRel);
        await fs.writeFile(aAbs, Buffer.alloc(64));
        await fs.writeFile(bAbs, Buffer.alloc(64));

        const failing: StubMetadataExtractor = new StubMetadataExtractor();
        const original: typeof failing.extract = failing.extract.bind(failing);
        failing.extract = async (path: string): Promise<ExtractedMetadata> => {
            if (path === aAbs) {
                throw new Error('bad file');
            }
            return original(path);
        };
        failing.set(bAbs, { metadata: { title: 'B' }, cover: null });

        const trackA: AnalyzedTrack = makeAnalyzedTrack(aRel);
        const trackB: AnalyzedTrack = makeAnalyzedTrack(bRel);
        await newEnricher(failing).enrich([trackA, trackB]);

        expect(trackA.metadata).toBeUndefined();
        expect(trackA.hasCover).toBe(false);
        expect(trackB.metadata).toEqual({ title: 'B' });
    });

    it('skips tracks whose providerId is not the enricher\'s', async (): Promise<void> => {
        const aRel: string = 'a.mp3';
        await fs.writeFile(join(dir, aRel), Buffer.alloc(64));

        const extractor: StubMetadataExtractor = new StubMetadataExtractor();
        extractor.set(join(dir, aRel), { metadata: { title: 'T' }, cover: null });

        const foreign: AnalyzedTrack = { ...makeAnalyzedTrack(aRel), providerId: 'other-provider' };
        await newEnricher(extractor).enrich([foreign]);

        expect(foreign.metadata).toBeUndefined();
        const rows: TrackMetadataEntity[] = await metaRepo.find();
        expect(rows).toHaveLength(0);
    });
});