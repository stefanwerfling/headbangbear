import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TrackMetadataCache } from '../../src/Metadata/TrackMetadataCache.js';
import {
    METADATA_CACHE_VERSION,
    type MetadataCacheEntry,
} from '../../src/Metadata/schemas.js';

describe('TrackMetadataCache', (): void => {
    let dir: string;
    let cachePath: string;

    beforeEach(async (): Promise<void> => {
        dir = await fs.mkdtemp(join(tmpdir(), 'hbb-meta-'));
        cachePath = join(dir, '.metadata-cache.json');
    });

    afterEach(async (): Promise<void> => {
        await fs.rm(dir, { recursive: true, force: true });
    });

    it('returns an empty map when the cache file does not exist', async (): Promise<void> => {
        const cache: TrackMetadataCache = new TrackMetadataCache(cachePath);
        const map: Map<string, MetadataCacheEntry> = await cache.loadEntries();
        expect(map.size).toBe(0);
    });

    it('round-trips entries through save + load', async (): Promise<void> => {
        const cache: TrackMetadataCache = new TrackMetadataCache(cachePath);
        const entries: MetadataCacheEntry[] = [
            {
                path: '/lib/a.mp3',
                mtime: 1234567,
                size: 4096,
                metadata: { artist: 'X', title: 'Y', year: 2020 },
                hasCover: true,
            },
            {
                path: '/lib/b.mp3',
                mtime: 9876543,
                size: 8192,
                metadata: {},
                hasCover: false,
            },
        ];

        await cache.saveEntries(entries);
        const loaded: Map<string, MetadataCacheEntry> = await cache.loadEntries();

        expect(loaded.size).toBe(2);
        expect(loaded.get('/lib/a.mp3')).toEqual(entries[0]);
        expect(loaded.get('/lib/b.mp3')).toEqual(entries[1]);
    });

    it('treats malformed JSON as empty', async (): Promise<void> => {
        await fs.writeFile(cachePath, 'not valid json {{{', 'utf8');
        const cache: TrackMetadataCache = new TrackMetadataCache(cachePath);
        const loaded: Map<string, MetadataCacheEntry> = await cache.loadEntries();
        expect(loaded.size).toBe(0);
    });

    it('treats schema-mismatched JSON as empty', async (): Promise<void> => {
        await fs.writeFile(cachePath, JSON.stringify({ wrong: 'shape' }), 'utf8');
        const cache: TrackMetadataCache = new TrackMetadataCache(cachePath);
        const loaded: Map<string, MetadataCacheEntry> = await cache.loadEntries();
        expect(loaded.size).toBe(0);
    });

    it('treats wrong-version files as empty (so future bumps re-extract cleanly)', async (): Promise<void> => {
        await fs.writeFile(
            cachePath,
            JSON.stringify({ version: METADATA_CACHE_VERSION + 1, entries: [] }),
            'utf8',
        );
        const cache: TrackMetadataCache = new TrackMetadataCache(cachePath);
        const loaded: Map<string, MetadataCacheEntry> = await cache.loadEntries();
        expect(loaded.size).toBe(0);
    });
});