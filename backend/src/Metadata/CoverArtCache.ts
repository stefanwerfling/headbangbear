import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { ExtractedCover } from './TrackMetadataExtractor.js';

const COVER_DIR_NAME: string = '.covers';
const KNOWN_EXTS: readonly string[] = ['jpg', 'png', 'webp', 'gif'];

/**
 * Filesystem-backed cache for cover-art images. Each track's cover is written to
 * `<library>/.covers/<sha1-of-abs-path>.<ext>`. The SHA1 keeps the filename safe regardless
 * of unicode/spaces/punctuation in the original audio path, and the extension preserves the
 * original image format so the browser can render it without conversion.
 *
 * Trade-off: SHA1's input is the **absolute** track path, so moving the library directory
 * orphans every cover and forces a re-extraction on the next scan. That's the simplest
 * invariant; library moves are rare in practice. A path-relative SHA would survive moves but
 * would clash if the same filename ever appeared in multiple library roots.
 */
export class CoverArtCache {

    private readonly libraryDir: string;

    public constructor(libraryDir: string) {
        this.libraryDir = libraryDir;
    }

    public getDir(): string {
        return join(this.libraryDir, COVER_DIR_NAME);
    }

    /**
     * Probes for an existing cover file (one of the known extensions) and returns its
     * absolute path, or `null` if none exists. Cheap — at most four `stat`-style calls.
     */
    public async coverPath(trackPath: string): Promise<string | null> {
        for (const ext of KNOWN_EXTS) {
            const candidate: string = this.candidatePath(trackPath, ext);
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
    public async write(trackPath: string, cover: ExtractedCover): Promise<string> {
        await this.ensureDir();
        const ext: string = CoverArtCache.extForMime(cover.mime);
        const target: string = this.candidatePath(trackPath, ext);
        await this.clearOtherExtensions(trackPath, ext);
        await fs.writeFile(target, cover.data);
        return target;
    }

    /** Delete every cover variant for a track. Used when metadata-cache marks an entry stale. */
    public async clear(trackPath: string): Promise<void> {
        for (const ext of KNOWN_EXTS) {
            const candidate: string = this.candidatePath(trackPath, ext);
            try {
                await fs.unlink(candidate);
            } catch {
                // already absent
            }
        }
    }

    private async ensureDir(): Promise<void> {
        await fs.mkdir(this.getDir(), { recursive: true });
    }

    private async clearOtherExtensions(trackPath: string, keep: string): Promise<void> {
        for (const ext of KNOWN_EXTS) {
            if (ext === keep) {
                continue;
            }
            const stale: string = this.candidatePath(trackPath, ext);
            try {
                await fs.unlink(stale);
            } catch {
                // already absent
            }
        }
    }

    private candidatePath(trackPath: string, ext: string): string {
        const hash: string = createHash('sha1').update(trackPath).digest('hex');
        return join(this.getDir(), `${hash}.${ext}`);
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