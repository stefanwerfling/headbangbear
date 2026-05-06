import { createHash } from 'node:crypto';
import { createWriteStream, promises as fs } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const DEFAULT_MAX_BYTES: number = 1 * 1024 * 1024 * 1024;

interface CacheStat {
    readonly absPath: string;
    readonly pinKey: string;
    readonly mtimeMs: number;
    readonly size: number;
}

/**
 * Local on-disk copy of remote audio (Jellyfin downloads, primarily) so the same
 * MP3 isn't re-pulled every time it's analysed or played back. Files live at
 * `<rootDir>/<providerId>/<sha1(sourceId)>.bin`. mtime doubles as last-access
 * time — bumped on every cache hit, used as the LRU key during eviction.
 *
 * **Pinning** — `pin(providerId, sourceId)` returns an unpin function that
 * protects a key from eviction while it's actively being analysed or streamed.
 * Pin counts are refcounted so concurrent reads (scanner + playback of the same
 * track) don't release each other early. Pinned files are *never* evicted; if
 * every file is pinned, the cache is allowed to exceed `maxBytes` until pins are
 * released (the alternative — deleting actively-used files mid-stream — is worse
 * than the soft-cap overshoot).
 *
 * **Eviction** — triggered by callers (typically after each scan-loop write).
 * Walks the cache dir, totals sizes, and if over `maxBytes` deletes the
 * oldest-mtime unpinned files until the total fits.
 */
export class AudioCache {

    private readonly rootDir: string;

    private readonly maxBytes: number;

    private readonly pinCounts: Map<string, number> = new Map();

    public constructor(rootDir: string, maxBytes: number = DEFAULT_MAX_BYTES) {
        this.rootDir = rootDir;
        this.maxBytes = maxBytes;
    }

    public getRootDir(): string {
        return this.rootDir;
    }

    public getMaxBytes(): number {
        return this.maxBytes;
    }

    /** On-disk path where the cached copy of `(providerId, sourceId)` lives —
     *  whether or not it's actually present. The `<providerId>` directory means
     *  per-provider purges are a single `rm -rf`. */
    public pathFor(providerId: string, sourceId: string): string {
        return join(this.rootDir, providerId, `${AudioCache.hash(sourceId)}.bin`);
    }

    public async has(providerId: string, sourceId: string): Promise<boolean> {
        try {
            const stat = await fs.stat(this.pathFor(providerId, sourceId));
            return stat.isFile() && stat.size > 0;
        } catch {
            return false;
        }
    }

    /** Read the upstream Content-Type stored alongside the cached file.
     *  Returns `null` if no sidecar exists (older entries pre-mime-storage, or
     *  the sidecar got removed) — callers default to `audio/mpeg` since the
     *  library is MP3-leaning. */
    public async getContentType(providerId: string, sourceId: string): Promise<string | null> {
        const sidecar: string = `${this.pathFor(providerId, sourceId)}.mime`;
        try {
            const raw: string = await fs.readFile(sidecar, 'utf8');
            const trimmed: string = raw.trim();
            return trimmed.length > 0 ? trimmed : null;
        } catch {
            return null;
        }
    }

    /** Bump the file's mtime so LRU eviction treats it as recently-used.
     *  Best-effort — a missing/locked file just leaves the timestamp alone. */
    public async touch(absPath: string): Promise<void> {
        const now: Date = new Date();
        try {
            await fs.utimes(absPath, now, now);
        } catch {
            // file may have been evicted between calls; ignore
        }
    }

    /**
     * Refcounted pin. Returns an unpin function — caller must invoke it (typically
     * in a `try/finally`) when the read/write is done. Multiple concurrent pins on
     * the same key are tracked independently, so two unpins are needed to allow
     * eviction. Calling the unpin twice is a no-op.
     */
    public pin(providerId: string, sourceId: string): () => void {
        const k: string = AudioCache.pinKey(providerId, sourceId);
        this.pinCounts.set(k, (this.pinCounts.get(k) ?? 0) + 1);
        let released: boolean = false;
        return (): void => {
            if (released) {
                return;
            }
            released = true;
            const c: number = this.pinCounts.get(k) ?? 0;
            if (c <= 1) {
                this.pinCounts.delete(k);
            } else {
                this.pinCounts.set(k, c - 1);
            }
        };
    }

    public isPinned(providerId: string, sourceId: string): boolean {
        return (this.pinCounts.get(AudioCache.pinKey(providerId, sourceId)) ?? 0) > 0;
    }

    /**
     * Drop a cache entry explicitly. Pin-aware — a pinned entry (currently
     * analysed or streamed) is left in place so the active read doesn't EBADF.
     * Returns true iff the file was deleted.
     *
     * Used by the scanner immediately after a successful DB upsert: the analysis
     * is now in the source-of-truth DB, so keeping the raw audio bytes around
     * just bloats the disk. Bridge to a "rolling window" cache where size at any
     * moment ≈ the prefetch window size.
     */
    public async delete(providerId: string, sourceId: string): Promise<boolean> {
        if (this.isPinned(providerId, sourceId)) {
            return false;
        }
        const target: string = this.pathFor(providerId, sourceId);
        try {
            await fs.unlink(target);
        } catch {
            return false;
        }
        // Sidecar may or may not exist (older entries pre-mime persistence); ignore.
        await fs.unlink(`${target}.mime`).catch((): void => {});
        return true;
    }

    /**
     * Stream `source` into the cache file at `pathFor(providerId, sourceId)` via
     * a `.tmp` rename so a torn write never leaves a partial cache file. The
     * caller is responsible for `pin()`-ing across the call (we don't pin here
     * because the lock should also cover the analyzer pass that follows).
     *
     * `contentType` is persisted as a `<file>.mime` sidecar so subsequent serve-
     * from-cache responses reproduce the upstream MIME. Without it the response
     * defaults to `application/octet-stream` (Express's guess for `.bin`), which
     * `<audio>` elements refuse to play.
     */
    public async writeFromStream(
        providerId: string,
        sourceId: string,
        source: Readable,
        contentType?: string,
    ): Promise<string> {
        const target: string = this.pathFor(providerId, sourceId);
        await fs.mkdir(dirname(target), { recursive: true });
        const temp: string = `${target}.tmp`;
        try {
            await pipeline(source, createWriteStream(temp));
            await fs.rename(temp, target);
            if (contentType !== undefined && contentType.length > 0) {
                await fs.writeFile(`${target}.mime`, contentType, 'utf8').catch((): void => {});
            }
            return target;
        } catch (err) {
            await fs.unlink(temp).catch((): void => {});
            throw err;
        }
    }

    /**
     * Walk every cache file under the root dir. If the total exceeds `maxBytes`,
     * delete oldest-mtime unpinned files until the total fits. Best-effort —
     * deletion failures (file already gone, EACCES) are swallowed and the loop
     * moves on. No error means a clean state, not necessarily "fit under cap"
     * (everything could be pinned).
     */
    public async evictIfOverCapacity(): Promise<void> {
        const entries: CacheStat[] = await this.listEntries();
        let total: number = 0;
        for (const e of entries) {
            total += e.size;
        }
        if (total <= this.maxBytes) {
            return;
        }
        entries.sort((a: CacheStat, b: CacheStat): number => a.mtimeMs - b.mtimeMs);
        for (const e of entries) {
            if (total <= this.maxBytes) {
                return;
            }
            if ((this.pinCounts.get(e.pinKey) ?? 0) > 0) {
                continue;
            }
            try {
                await fs.unlink(e.absPath);
                // Sidecar may not exist (older entries written before mime persistence);
                // ignore failures — the main file is the source of truth.
                await fs.unlink(`${e.absPath}.mime`).catch((): void => {});
                total -= e.size;
            } catch {
                // already gone or unwritable; skip
            }
        }
    }

    private async listEntries(): Promise<CacheStat[]> {
        const out: CacheStat[] = [];
        let providerDirs: string[];
        try {
            providerDirs = await fs.readdir(this.rootDir);
        } catch {
            return out;
        }
        for (const provider of providerDirs) {
            const providerDir: string = join(this.rootDir, provider);
            let files: string[];
            try {
                files = await fs.readdir(providerDir);
            } catch {
                continue;
            }
            for (const file of files) {
                if (!file.endsWith('.bin')) {
                    continue;
                }
                const abs: string = join(providerDir, file);
                let stat;
                try {
                    stat = await fs.stat(abs);
                } catch {
                    continue;
                }
                if (!stat.isFile()) {
                    continue;
                }
                const hash: string = basename(file, '.bin');
                out.push({
                    absPath: abs,
                    // `pinKey` matches what `pin()` builds — both use sha1(sourceId) prefixed
                    // with providerId. That's how isPinned-by-path works without a reverse
                    // hash→sourceId map.
                    pinKey: `${provider}|${hash}`,
                    mtimeMs: stat.mtimeMs,
                    size: stat.size,
                });
            }
        }
        return out;
    }

    private static hash(sourceId: string): string {
        return createHash('sha1').update(sourceId).digest('hex');
    }

    private static pinKey(providerId: string, sourceId: string): string {
        return `${providerId}|${AudioCache.hash(sourceId)}`;
    }

}