import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { ExtractedCover } from './TrackMetadataExtractor.js';

const KNOWN_EXTS: readonly string[] = ['jpg', 'png', 'webp', 'gif'];

/**
 * Filesystem-backed cache for cover-art images. The cache is **per-provider** —
 * `LibraryService` builds one `CoverArtCache` per `local` provider rooted at
 * `<dataDir>/covers/<providerId>/`. Each track's cover is written to
 * `<coverDir>/<sha1(sourceId)>.<ext>`.
 *
 * The hash input is the **per-provider source-id** (relative path under the
 * provider's `rootDir`), not an absolute path. That way moving the whole
 * library directory to a different on-disk location keeps every cover valid —
 * the relative path inside the library is stable. Renaming or moving an
 * individual file inside the library still invalidates that one entry, which
 * is the right behaviour.
 */
export class CoverArtCache {

    private readonly coverDir: string;

    public constructor(coverDir: string) {
        this.coverDir = coverDir;
    }

    public getDir(): string {
        return this.coverDir;
    }

    /**
     * Probe for an existing cover file (one of the known extensions) and return
     * its absolute path, or `null` if none exists. At most four `access` calls.
     */
    public async coverPath(sourceId: string): Promise<string | null> {
        for (const ext of KNOWN_EXTS) {
            const candidate: string = this.candidatePath(sourceId, ext);
            try {
                await fs.access(candidate);
                return candidate;
            } catch {
                // try the next extension
            }
        }
        return null;
    }

    /**
     * Persist the cover bytes. Stale variants under different extensions are removed so a
     * later `coverPath()` call returns exactly one match. Returns the absolute path written.
     */
    public async write(sourceId: string, cover: ExtractedCover): Promise<string> {
        await this.ensureDir();
        const ext: string = CoverArtCache.extForMime(cover.mime);
        const target: string = this.candidatePath(sourceId, ext);
        await this.clearOtherExtensions(sourceId, ext);
        await fs.writeFile(target, cover.data);
        return target;
    }

    /** Delete every cover variant for a source-id. Used when re-extraction supersedes
     *  the old cover or when a track is removed from the library. */
    public async clear(sourceId: string): Promise<void> {
        for (const ext of KNOWN_EXTS) {
            const candidate: string = this.candidatePath(sourceId, ext);
            try {
                await fs.unlink(candidate);
            } catch {
                // already absent
            }
        }
    }

    private async ensureDir(): Promise<void> {
        await fs.mkdir(this.coverDir, { recursive: true });
    }

    private async clearOtherExtensions(sourceId: string, keep: string): Promise<void> {
        for (const ext of KNOWN_EXTS) {
            if (ext === keep) {
                continue;
            }
            const stale: string = this.candidatePath(sourceId, ext);
            try {
                await fs.unlink(stale);
            } catch {
                // already absent
            }
        }
    }

    private candidatePath(sourceId: string, ext: string): string {
        const hash: string = createHash('sha1').update(sourceId).digest('hex');
        return join(this.coverDir, `${hash}.${ext}`);
    }

    private static extForMime(mime: string): string {
        const lower: string = mime.toLowerCase();
        if (lower.includes('png')) {
            return 'png';
        }
        if (lower.includes('webp')) {
            return 'webp';
        }
        if (lower.includes('gif')) {
            return 'gif';
        }
        return 'jpg';
    }

}