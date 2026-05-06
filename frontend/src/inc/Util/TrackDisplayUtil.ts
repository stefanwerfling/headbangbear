import type { RouteTrack } from '@headbangbear/schemas';

const COVER_THUMB_SIZE_PX: number = 40;

/**
 * Shared rendering helpers for surfacing track cover-art and embedded tag metadata across
 * pages (Library table, DJ-Set chain table, DJ-Set now-playing card). Centralised here so
 * the placeholder, escape, and URL conventions stay in lockstep.
 *
 * `coverUrl` is the only piece that knows about the backend route shape — both `<img>`-tag
 * helpers and the now-playing card rebuild call it so a future move of the cover endpoint
 * only touches one place.
 */
export class TrackDisplayUtil {

    /** Backend cover route URL for a track, regardless of whether a cover actually exists.
     *  Both `providerId` and `path` are required because the cover cache is namespaced per
     *  provider (no cross-provider key collisions). */
    public static coverUrl(track: RouteTrack): string {
        return `api/v1/library/cover?providerId=${encodeURIComponent(track.providerId)}`
            + `&path=${encodeURIComponent(track.path)}`;
    }

    /**
     * `<img>` tag for the small (40×40) thumbnail used in table rows. Falls back to a
     * neutral fa-music placeholder when the backend reports `hasCover: false`.
     */
    public static coverThumbHtml(track: RouteTrack): string {
        if (track.hasCover) {
            return `<img src="${TrackDisplayUtil.coverUrl(track)}" alt="" class="hbb-cover-thumb" style="width:${COVER_THUMB_SIZE_PX.toString()}px;height:${COVER_THUMB_SIZE_PX.toString()}px;object-fit:cover;border-radius:3px;">`;
        }
        return `<span class="hbb-cover-placeholder d-inline-flex align-items-center justify-content-center text-muted" style="width:${COVER_THUMB_SIZE_PX.toString()}px;height:${COVER_THUMB_SIZE_PX.toString()}px;border-radius:3px;background:#e9ecef;"><i class="fas fa-music"></i></span>`;
    }

    /**
     * Cell content for a "Track" column: prominent title + smaller artist line, with the
     * filename as a fallback layer so the user can still identify mistagged tracks.
     */
    public static trackCellHtml(track: RouteTrack, filename: string): string {
        const meta = track.metadata;
        const artist: string | undefined = meta?.artist;
        const title: string | undefined = meta?.title;
        if (title === undefined && artist === undefined) {
            return TrackDisplayUtil.escape(filename);
        }
        const titleLine: string = title !== undefined
            ? TrackDisplayUtil.escape(title)
            : TrackDisplayUtil.escape(filename);
        const subtitle: string = artist !== undefined
            ? `<small class="text-muted d-block">${TrackDisplayUtil.escape(artist)}</small>`
            : `<small class="text-muted d-block">${TrackDisplayUtil.escape(filename)}</small>`;
        return `<div><strong>${titleLine}</strong>${subtitle}</div>`;
    }

    /**
     * Search haystack: filename + every non-empty metadata field, lowercased. Used by the
     * Library page's text filter so users can search by artist/title/album as well as
     * filename.
     */
    public static buildSearchHaystack(track: RouteTrack, filename: string): string {
        const parts: string[] = [filename];
        const meta = track.metadata;
        if (meta !== undefined) {
            if (meta.artist !== undefined) {
                parts.push(meta.artist);
            }
            if (meta.title !== undefined) {
                parts.push(meta.title);
            }
            if (meta.album !== undefined) {
                parts.push(meta.album);
            }
            if (meta.genre !== undefined) {
                parts.push(meta.genre);
            }
        }
        return parts.join(' ').toLowerCase();
    }

    /** Minimal HTML escape for tag-derived strings; metadata may contain `<>&"'`. */
    public static escape(s: string): string {
        return s
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /** Filename portion of an absolute path, with the trailing "/" stripped. */
    public static filenameOf(path: string): string {
        return path.split('/').pop() ?? path;
    }

}
