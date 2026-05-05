import { parseFile, type ICommonTagsResult, type IPicture } from 'music-metadata';
import type { TrackMetadata } from '@headbangbear/schemas';
import {
    TrackMetadataExtractor,
    type ExtractedCover,
    type ExtractedMetadata,
} from './TrackMetadataExtractor.js';

/**
 * Reads embedded tags via the `music-metadata` package. Despite the name, this works for
 * ID3v1/v2 (MP3), Vorbis comments (FLAC/OGG), MP4 atoms (M4A/AAC) and many more — the
 * library normalises every container into a single `common` shape, so the same code path
 * covers them all. We only surface the user-facing fields plus the first attached picture.
 *
 * No network, no rate limits, no API keys — purely local filesystem reads.
 */
export class Id3TagExtractor extends TrackMetadataExtractor {

    public override async extract(filePath: string): Promise<ExtractedMetadata> {
        const parsed = await parseFile(filePath, { duration: false });
        const common: ICommonTagsResult = parsed.common;
        const metadata: TrackMetadata = {};
        if (typeof common.artist === 'string' && common.artist.length > 0) {
            metadata.artist = common.artist;
        }
        if (typeof common.title === 'string' && common.title.length > 0) {
            metadata.title = common.title;
        }
        if (typeof common.album === 'string' && common.album.length > 0) {
            metadata.album = common.album;
        }
        if (typeof common.year === 'number' && Number.isFinite(common.year)) {
            metadata.year = common.year;
        }
        const genre: string | undefined = Id3TagExtractor.firstNonEmpty(common.genre);
        if (genre !== undefined) {
            metadata.genre = genre;
        }
        const cover: ExtractedCover | null = Id3TagExtractor.firstCover(common.picture);
        return { metadata: metadata, cover: cover };
    }

    private static firstNonEmpty(values: readonly string[] | undefined): string | undefined {
        if (values === undefined) {
            return undefined;
        }
        for (const v of values) {
            if (typeof v === 'string' && v.length > 0) {
                return v;
            }
        }
        return undefined;
    }

    private static firstCover(pictures: readonly IPicture[] | undefined): ExtractedCover | null {
        if (pictures === undefined || pictures.length === 0) {
            return null;
        }
        const first: IPicture | undefined = pictures[0];
        if (first === undefined) {
            return null;
        }
        return { mime: first.format, data: first.data };
    }

}