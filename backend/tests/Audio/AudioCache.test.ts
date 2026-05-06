import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AudioCache } from '../../src/Audio/AudioCache.js';

function streamOf(bytes: number, fillByte: number = 0x42): Readable {
    const buf: Buffer = Buffer.alloc(bytes, fillByte);
    return Readable.from(buf);
}

describe('AudioCache', (): void => {
    let cacheDir: string;

    beforeEach(async (): Promise<void> => {
        cacheDir = await fs.mkdtemp(join(tmpdir(), 'hbb-audio-cache-'));
    });

    afterEach(async (): Promise<void> => {
        await fs.rm(cacheDir, { recursive: true, force: true });
    });

    it('writes from stream then reports has(true) and reads back the bytes', async (): Promise<void> => {
        const cache: AudioCache = new AudioCache(cacheDir);
        await cache.writeFromStream('p1', 'item-A', streamOf(128));

        expect(await cache.has('p1', 'item-A')).toBe(true);
        const stat = await fs.stat(cache.pathFor('p1', 'item-A'));
        expect(stat.size).toBe(128);
    });

    it('returns false from has() for a key that was never cached', async (): Promise<void> => {
        const cache: AudioCache = new AudioCache(cacheDir);
        expect(await cache.has('p1', 'never-seen')).toBe(false);
    });

    it('namespaces by providerId so the same sourceId in two providers cohabits', async (): Promise<void> => {
        const cache: AudioCache = new AudioCache(cacheDir);
        await cache.writeFromStream('p1', 'collide', streamOf(16, 0x01));
        await cache.writeFromStream('p2', 'collide', streamOf(32, 0x02));

        const a = await fs.readFile(cache.pathFor('p1', 'collide'));
        const b = await fs.readFile(cache.pathFor('p2', 'collide'));
        expect(a.length).toBe(16);
        expect(b.length).toBe(32);
        expect(a[0]).toBe(0x01);
        expect(b[0]).toBe(0x02);
    });

    it('evictIfOverCapacity drops oldest unpinned entries until under cap', async (): Promise<void> => {
        const cache: AudioCache = new AudioCache(cacheDir, 256);
        await cache.writeFromStream('p1', 'old', streamOf(100));
        // Bump the second entry's mtime forward so eviction sees it as newer.
        await new Promise<void>((r): void => {
            setTimeout(r, 20);
        });
        await cache.writeFromStream('p1', 'mid', streamOf(100));
        await new Promise<void>((r): void => {
            setTimeout(r, 20);
        });
        await cache.writeFromStream('p1', 'new', streamOf(100));
        // Total is 300 > 256 cap → oldest gets evicted; total then 200 ≤ 256, stop.
        await cache.evictIfOverCapacity();
        expect(await cache.has('p1', 'old')).toBe(false);
        expect(await cache.has('p1', 'mid')).toBe(true);
        expect(await cache.has('p1', 'new')).toBe(true);
    });

    it('pin protects an entry from eviction even when it is the oldest', async (): Promise<void> => {
        const cache: AudioCache = new AudioCache(cacheDir, 150);
        await cache.writeFromStream('p1', 'pinned-old', streamOf(100));
        const unpin: () => void = cache.pin('p1', 'pinned-old');
        await new Promise<void>((r): void => {
            setTimeout(r, 20);
        });
        await cache.writeFromStream('p1', 'fresh', streamOf(100));
        await cache.evictIfOverCapacity();
        // 200 > 150 cap, but the older entry is pinned so the newer one is dropped.
        expect(await cache.has('p1', 'pinned-old')).toBe(true);
        expect(await cache.has('p1', 'fresh')).toBe(false);
        unpin();
    });

    it('refcounts pin so two pins need two unpins before eviction is allowed', async (): Promise<void> => {
        const cache: AudioCache = new AudioCache(cacheDir, 50);
        await cache.writeFromStream('p1', 'shared', streamOf(100));
        const unpin1: () => void = cache.pin('p1', 'shared');
        const unpin2: () => void = cache.pin('p1', 'shared');
        unpin1();
        // One pin still active — evictIfOverCapacity must keep the file.
        await cache.evictIfOverCapacity();
        expect(await cache.has('p1', 'shared')).toBe(true);
        unpin2();
        // No pins now — eviction can proceed.
        await cache.evictIfOverCapacity();
        expect(await cache.has('p1', 'shared')).toBe(false);
    });

    it('touch bumps mtime so a cache hit moves to the head of the LRU queue', async (): Promise<void> => {
        const cache: AudioCache = new AudioCache(cacheDir, 150);
        await cache.writeFromStream('p1', 'A', streamOf(100));
        await new Promise<void>((r): void => {
            setTimeout(r, 20);
        });
        await cache.writeFromStream('p1', 'B', streamOf(100));
        // Without touch, A would be the eviction target (older mtime). After touch
        // A becomes the newer entry and B is evicted instead.
        await new Promise<void>((r): void => {
            setTimeout(r, 20);
        });
        await cache.touch(cache.pathFor('p1', 'A'));
        await cache.evictIfOverCapacity();
        expect(await cache.has('p1', 'A')).toBe(true);
        expect(await cache.has('p1', 'B')).toBe(false);
    });

    it('delete drops both the .bin and the .mime sidecar', async (): Promise<void> => {
        const cache: AudioCache = new AudioCache(cacheDir);
        await cache.writeFromStream('p1', 'with-mime', streamOf(64), 'audio/flac');
        expect(await cache.has('p1', 'with-mime')).toBe(true);
        expect(await cache.getContentType('p1', 'with-mime')).toBe('audio/flac');

        const deleted: boolean = await cache.delete('p1', 'with-mime');
        expect(deleted).toBe(true);
        expect(await cache.has('p1', 'with-mime')).toBe(false);
        expect(await cache.getContentType('p1', 'with-mime')).toBeNull();
    });

    it('delete refuses to drop a pinned entry and returns false', async (): Promise<void> => {
        const cache: AudioCache = new AudioCache(cacheDir);
        await cache.writeFromStream('p1', 'busy', streamOf(64));
        const unpin: () => void = cache.pin('p1', 'busy');

        const deleted: boolean = await cache.delete('p1', 'busy');
        expect(deleted).toBe(false);
        expect(await cache.has('p1', 'busy')).toBe(true);

        unpin();
        const deletedAfter: boolean = await cache.delete('p1', 'busy');
        expect(deletedAfter).toBe(true);
    });

    it('delete returns false if the entry never existed', async (): Promise<void> => {
        const cache: AudioCache = new AudioCache(cacheDir);
        const deleted: boolean = await cache.delete('p1', 'nope');
        expect(deleted).toBe(false);
    });

    it('writeFromStream cleans up the .tmp file when the source errors', async (): Promise<void> => {
        const cache: AudioCache = new AudioCache(cacheDir);
        const source: Readable = new Readable({
            read(): void {
                this.destroy(new Error('boom'));
            },
        });
        await expect(cache.writeFromStream('p1', 'doomed', source)).rejects.toThrow(/boom/);
        expect(await cache.has('p1', 'doomed')).toBe(false);
        const tempPath: string = `${cache.pathFor('p1', 'doomed')}.tmp`;
        await expect(fs.access(tempPath)).rejects.toBeDefined();
    });
});