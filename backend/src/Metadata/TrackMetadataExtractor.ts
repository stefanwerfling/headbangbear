import type { TrackMetadata } from '@headbangbear/schemas';

/**
 * Cover image bytes pulled out of a track's embedded metadata. `mime` is whatever the
 * upstream tag declares (`image/jpeg`, `image/png`, …); the {@link CoverArtCache} maps
 * that to a file extension when persisting.
 */
export interface ExtractedCover {
    readonly mime: string;
    readonly data: Uint8Array;
}

/**
 * Result of one extraction pass for a single track. Both fields are independent — a track
 * may have artist/title tags but no cover, or a cover with no other tags.
 */
export interface ExtractedMetadata {
    readonly metadata: TrackMetadata;
    readonly cover: ExtractedCover | null;
}

/**
 * Vertrag for "given a path on disk, give me what you know about this track". Each concrete
 * subclass commits to one extraction strategy (embedded ID3 tags, fingerprint lookup, …).
 * Higher layers compose them — try the cheap one first, fall back to the expensive one.
 */
export abstract class TrackMetadataExtractor {

    public abstract extract(filePath: string): Promise<ExtractedMetadata>;

}