import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CoverArtCache } from '../../src/Metadata/CoverArtCache.js';

describe('CoverArtCache', (): void => {
    let dir: string;
    let cache: CoverArtCache;

    beforeEach(async (): Promise<void> => {
        dir = await fs.mkdtemp(join(tmpdir(), 'hbb-covers-'));
        cache = new CoverArtCache(dir);
    });

    afterEach(async (): Promise<void> => {
        await fs.rm(dir, { recursive: true, force: true });
    });

    it('returns null when no cover has been written', async (): Promise<void> => {
        const result: string | null = await cache.coverPath('/some/track.mp3');
        expect(result).toBeNull();
    });

    it('writes a cover and resolves it back via coverPath', async (): Promise<void> => {
        const trackPath: string = '/library/x/song.mp3';
        const data: Uint8Array = new Uint8Array([1, 2, 3, 4, 5]);
        const written: string = await cache.write(trackPath, { mime: 'image/jpeg', data: data });
        expect(written.endsWith('.jpg')).toBe(true);

        const resolved: string | null = await cache.coverPath(trackPath);
        expect(resolved).toBe(written);

        const read: Buffer = await fs.readFile(resolved as string);
        expect(read.equals(Buffer.from(data))).toBe(true);
    });

    it('picks the right extension for each MIME type', async (): Promise<void> => {
        await cache.write('/a.mp3', { mime: 'image/png', data: new Uint8Array([0]) });
        await cache.write('/b.mp3', { mime: 'image/webp', data: new Uint8Array([0]) });
        await cache.write('/c.mp3', { mime: 'image/gif', data: new Uint8Array([0]) });
        await cache.write('/d.mp3', { mime: 'image/something-weird', data: new Uint8Array([0]) });

        expect((await cache.coverPath('/a.mp3'))?.endsWith('.png')).toBe(true);
        expect((await cache.coverPath('/b.mp3'))?.endsWith('.webp')).toBe(true);
        expect((await cache.coverPath('/c.mp3'))?.endsWith('.gif')).toBe(true);
        // Unknown MIME falls through to .jpg.
        expect((await cache.coverPath('/d.mp3'))?.endsWith('.jpg')).toBe(true);
    });

    it('replaces an existing cover when re-written with a different extension', async (): Promise<void> => {
        const track: string = '/lib/song.mp3';
        await cache.write(track, { mime: 'image/jpeg', data: new Uint8Array([1]) });
        const firstResolved: string | null = await cache.coverPath(track);
        expect(firstResolved?.endsWith('.jpg')).toBe(true);

        await cache.write(track, { mime: 'image/png', data: new Uint8Array([2]) });
        const secondResolved: string | null = await cache.coverPath(track);
        expect(secondResolved?.endsWith('.png')).toBe(true);

        // The stale .jpg variant must be gone — otherwise coverPath() could resolve to either.
        await expect(fs.access(firstResolved as string)).rejects.toBeDefined();
    });

    it('clears all cover variants for a track', async (): Promise<void> => {
        const track: string = '/lib/x.mp3';
        await cache.write(track, { mime: 'image/jpeg', data: new Uint8Array([1]) });
        expect(await cache.coverPath(track)).not.toBeNull();
        await cache.clear(track);
        expect(await cache.coverPath(track)).toBeNull();
    });

    it('files for different track paths do not collide', async (): Promise<void> => {
        await cache.write('/lib/a.mp3', { mime: 'image/jpeg', data: new Uint8Array([1]) });
        await cache.write('/lib/b.mp3', { mime: 'image/jpeg', data: new Uint8Array([2]) });

        const a: string | null = await cache.coverPath('/lib/a.mp3');
        const b: string | null = await cache.coverPath('/lib/b.mp3');
        expect(a).not.toBeNull();
        expect(b).not.toBeNull();
        expect(a).not.toBe(b);
    });
});
