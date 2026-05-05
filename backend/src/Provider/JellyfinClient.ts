import type {
    JellyfinSettings,
    JellyfinTestResult,
} from '@headbangbear/schemas';

/**
 * Backend-internal flat representation of one Jellyfin audio item — only the fields
 * `JellyfinLibrary` cares about. Wire shape is not exposed; everything Jellyfin sends
 * is normalised here.
 */
export interface JellyfinAudioItem {
    readonly id: string;
    readonly name: string;
    readonly artist?: string;
    readonly album?: string;
    readonly year?: number;
    readonly genre?: string;
    /** Track length in whole seconds, derived from `RunTimeTicks` (100-ns ticks). */
    readonly durationSec?: number;
    /** File size in bytes, from `MediaSources[0].Size` if available. */
    readonly sizeBytes?: number;
    /** Last modification time (millis since epoch), from `DateModified` ISO. */
    readonly dateModifiedMs?: number;
    /** True iff the item has a Primary image tag — the proxy can fetch it. */
    readonly hasCover: boolean;
}

/**
 * Minimal REST wrapper around the parts of the Jellyfin API we need *right now* —
 * just the connection probe. List-items + audio-stream + cover URLs land in a follow-up
 * iteration when the `JellyfinLibraryProvider` actually starts using the server.
 *
 * Auth: Jellyfin accepts the API key in the `X-Emby-Token` header. Server URLs may or
 * may not include a trailing slash — `joinUrl` normalises that.
 */
export class JellyfinClient {

    private readonly settings: JellyfinSettings;

    public constructor(settings: JellyfinSettings) {
        this.settings = settings;
    }

    /**
     * Hit `/System/Info` with the configured API key, then verify (or auto-discover)
     * the user via `/Users`. Two-stage probe so failures point at exactly what's wrong:
     * a 401 on `/System/Info` means the API key is bad, a 401 on `/Users` means the
     * key works but lacks user-list permission, and a "user not found" means the
     * configured GUID doesn't exist.
     *
     * If `userId` is empty, picks the **first** user the API key can see and reports
     * the discovered GUID back so the frontend can populate the form. Mirrors the
     * "API key alone" UX of other Jellyfin clients — sensible default for the common
     * single-user-server case.
     */
    public async testConnection(): Promise<JellyfinTestResult> {
        const url: string = this.settings.url.trim();
        const apiKey: string = this.settings.apiKey.trim();
        const userId: string = this.settings.userId.trim();
        if (url === '' || apiKey === '') {
            return {
                ok: false,
                message: 'URL and API key are required.',
            };
        }
        let infoResponse: Response;
        try {
            infoResponse = await fetch(JellyfinClient.joinUrl(url, '/System/Info'), {
                headers: { 'X-Emby-Token': apiKey },
            });
        } catch (err) {
            const detail: string = err instanceof Error ? err.message : String(err);
            return { ok: false, message: `Connection failed: ${detail}` };
        }
        if (!infoResponse.ok) {
            return {
                ok: false,
                message: `${infoResponse.status.toString()} ${infoResponse.statusText} — check URL + API key.`,
            };
        }
        let info: { ServerName?: unknown; Version?: unknown };
        try {
            info = await infoResponse.json() as { ServerName?: unknown; Version?: unknown };
        } catch {
            return {
                ok: false,
                message: 'Server returned a non-JSON response — is this really a Jellyfin instance?',
            };
        }
        const serverName: string | undefined = typeof info.ServerName === 'string'
            ? info.ServerName : undefined;
        const serverVersion: string | undefined = typeof info.Version === 'string'
            ? info.Version : undefined;

        // Either verify the configured user ID, or auto-discover one from `/Users`.
        const discovered: { id: string; name: string } | { error: string } =
            await this.resolveUser(url, apiKey, userId === '' ? null : userId);
        if ('error' in discovered) {
            return { ok: false, message: discovered.error };
        }

        const banner: string = serverName !== undefined && serverVersion !== undefined
            ? `Connected to ${serverName} (Jellyfin ${serverVersion})`
            : 'Connected';
        const userTag: string = userId === ''
            ? `auto-selected user ${discovered.name}`
            : `user ${discovered.name}`;

        const result: JellyfinTestResult = {
            ok: true,
            message: `${banner} — ${userTag}.`,
            resolvedUserId: discovered.id,
            resolvedUserName: discovered.name,
        };
        if (serverName !== undefined) {
            result.serverName = serverName;
        }
        if (serverVersion !== undefined) {
            result.serverVersion = serverVersion;
        }
        return result;
    }

    /**
     * Look up a single user — by ID if `userId` is given, otherwise pick the first one
     * `/Users` returns. Either branch errors out with a human-readable string the
     * caller surfaces verbatim.
     */
    private async resolveUser(
        url: string,
        apiKey: string,
        userId: string | null,
    ): Promise<{ id: string; name: string } | { error: string }> {
        if (userId !== null) {
            const target: string = JellyfinClient.joinUrl(url, `/Users/${encodeURIComponent(userId)}`);
            let response: Response;
            try {
                response = await fetch(target, { headers: { 'X-Emby-Token': apiKey } });
            } catch (err) {
                const detail: string = err instanceof Error ? err.message : String(err);
                return { error: `User lookup failed: ${detail}` };
            }
            if (!response.ok) {
                return {
                    error: `User ID rejected (${response.status.toString()} ${response.statusText}) — check the GUID.`,
                };
            }
            const body = await response.json().catch((): null => null) as { Id?: unknown; Name?: unknown } | null;
            const id: string | null = typeof body?.Id === 'string' ? body.Id : null;
            const name: string | null = typeof body?.Name === 'string' ? body.Name : null;
            if (id === null || name === null) {
                return { error: 'User payload missing Id / Name fields.' };
            }
            return { id: id, name: name };
        }

        // Auto-discover. `/Users` requires admin scope on most servers; fall back to
        // `/Users/Public` which lists publicly-visible users and is unauthenticated.
        for (const path of ['/Users', '/Users/Public']) {
            let response: Response;
            try {
                response = await fetch(JellyfinClient.joinUrl(url, path), {
                    headers: { 'X-Emby-Token': apiKey },
                });
            } catch (err) {
                const detail: string = err instanceof Error ? err.message : String(err);
                return { error: `User discovery failed: ${detail}` };
            }
            if (!response.ok) {
                continue;
            }
            const list = await response.json().catch((): null => null) as
                Array<{ Id?: unknown; Name?: unknown }> | null;
            if (!Array.isArray(list) || list.length === 0) {
                continue;
            }
            const first = list[0];
            const id: string | null = typeof first?.Id === 'string' ? first.Id : null;
            const name: string | null = typeof first?.Name === 'string' ? first.Name : null;
            if (id !== null && name !== null) {
                return { id: id, name: name };
            }
        }
        return { error: 'No users discoverable — the API key may lack permission. Provide a user ID manually.' };
    }

    /**
     * Fetch every audio item the configured user can see. Single-shot — Jellyfin's
     * `Limit` defaults to 100 unless overridden, so we ask for a much higher cap and
     * trust the server to paginate internally. A few thousand items in one response
     * is fine for today's libraries; if HBB ever sees five-figure libraries we'll
     * batch this with `StartIndex`.
     */
    /**
     * Fetch every audio item the configured user can see, paginated. Two reasons for
     * paging:
     *   - Jellyfin behind a reverse proxy (nginx/traefik/Caddy) commonly returns 504
     *     when a giant `Limit=10000` request takes longer than the proxy's idle timeout
     *     to assemble. Smaller pages return individually fast.
     *   - `MediaSources` is omitted from `Fields` — it forces Jellyfin to enumerate the
     *     underlying files for every item (slow). `DateModified` alone is enough for the
     *     analysis-cache invalidation key; if the file is replaced, the timestamp moves.
     */
    public async listAudioItems(): Promise<JellyfinAudioItem[]> {
        const userId: string = this.settings.userId.trim();
        if (userId === '') {
            throw new Error('JellyfinClient.listAudioItems: userId is required.');
        }
        const fields: string = ['Genres', 'DateModified', 'ProductionYear'].join(',');
        const pageSize: number = 500;
        const all: JellyfinAudioItem[] = [];
        let startIndex: number = 0;
        let total: number | null = null;
        while (true) {
            const url: string = JellyfinClient.joinUrl(
                this.settings.url,
                `/Users/${encodeURIComponent(userId)}/Items`
                    + `?IncludeItemTypes=Audio&Recursive=true`
                    + `&Limit=${pageSize.toString()}&StartIndex=${startIndex.toString()}`
                    + `&Fields=${fields}`,
            );
            // eslint-disable-next-line no-console
            console.log(`[jellyfin] listAudioItems page → StartIndex=${startIndex.toString()}`);
            const response: Response = await fetch(url, {
                headers: this.headers(),
                signal: AbortSignal.timeout(60_000),
            });
            if (!response.ok) {
                throw new Error(
                    `Jellyfin /Items returned ${response.status.toString()} ${response.statusText}`,
                );
            }
            const body = await response.json() as { Items?: unknown; TotalRecordCount?: unknown };
            if (typeof body.TotalRecordCount === 'number' && total === null) {
                total = body.TotalRecordCount;
                // eslint-disable-next-line no-console
                console.log(`[jellyfin] listAudioItems → total ${total.toString()} items`);
            }
            const items: unknown = body.Items;
            if (!Array.isArray(items)) {
                break;
            }
            for (const raw of items) {
                const it: JellyfinAudioItem | null = JellyfinClient.normaliseItem(raw);
                if (it !== null) {
                    all.push(it);
                }
            }
            if (items.length < pageSize) {
                break;
            }
            startIndex += pageSize;
            if (total !== null && startIndex >= total) {
                break;
            }
        }
        // eslint-disable-next-line no-console
        console.log(`[jellyfin] listAudioItems → ${all.length.toString()} items collected`);
        return all;
    }

    /**
     * Open a stream for an audio item — used by both the analysis pipeline (full
     * sequential read, no Range) and the playback proxy (forwards the browser's Range
     * header so seeking works). Returns the raw `Response` so the caller picks how to
     * consume the body (`.body` for piping, status/headers for the proxy).
     */
    public async openAudioStream(itemId: string, range?: string): Promise<Response> {
        const url: string = JellyfinClient.joinUrl(
            this.settings.url,
            `/Items/${encodeURIComponent(itemId)}/Download`,
        );
        const headers: Record<string, string> = this.headers();
        if (range !== undefined && range.length > 0) {
            headers['Range'] = range;
        }
        return fetch(url, { headers: headers });
    }

    /**
     * Open a stream for an item's primary cover image. Same proxy idiom as
     * `openAudioStream`. No Range — covers are small enough that the browser fetches
     * them in one go.
     */
    public async openCoverStream(itemId: string): Promise<Response> {
        const url: string = JellyfinClient.joinUrl(
            this.settings.url,
            `/Items/${encodeURIComponent(itemId)}/Images/Primary`,
        );
        return fetch(url, { headers: this.headers() });
    }

    /** Auth headers for every request — single place to flip if Jellyfin's scheme changes. */
    private headers(): Record<string, string> {
        return { 'X-Emby-Token': this.settings.apiKey };
    }

    /** Pull only the fields HBB needs from one raw item, with type-narrowing. Returns
     *  null if the item's missing a stable Id (which Jellyfin should never do, but we
     *  prefer to skip a bad row over crashing the scan). */
    private static normaliseItem(raw: unknown): JellyfinAudioItem | null {
        if (raw === null || typeof raw !== 'object') {
            return null;
        }
        const r = raw as Record<string, unknown>;
        const id: unknown = r.Id;
        const name: unknown = r.Name;
        if (typeof id !== 'string' || typeof name !== 'string') {
            return null;
        }
        const item: { -readonly [K in keyof JellyfinAudioItem]: JellyfinAudioItem[K] } = {
            id: id,
            name: name,
            hasCover: false,
        };
        const artists: unknown = r.Artists;
        if (Array.isArray(artists) && typeof artists[0] === 'string' && artists[0].length > 0) {
            item.artist = artists[0];
        } else if (typeof r.AlbumArtist === 'string' && r.AlbumArtist.length > 0) {
            item.artist = r.AlbumArtist;
        }
        if (typeof r.Album === 'string' && r.Album.length > 0) {
            item.album = r.Album;
        }
        if (typeof r.ProductionYear === 'number' && Number.isFinite(r.ProductionYear)) {
            item.year = r.ProductionYear;
        }
        const genres: unknown = r.Genres;
        if (Array.isArray(genres) && typeof genres[0] === 'string' && genres[0].length > 0) {
            item.genre = genres[0];
        }
        if (typeof r.RunTimeTicks === 'number' && r.RunTimeTicks > 0) {
            // Jellyfin ticks are 100-ns. 10_000_000 per second.
            item.durationSec = Math.round(r.RunTimeTicks / 10_000_000);
        }
        // `MediaSources.Size` is intentionally omitted from the listing request to keep
        // pages fast; if a future caller adds it back, this block already handles it.
        const mediaSources: unknown = r.MediaSources;
        if (Array.isArray(mediaSources) && mediaSources.length > 0) {
            const first = mediaSources[0] as { Size?: unknown };
            if (typeof first.Size === 'number' && Number.isFinite(first.Size)) {
                item.sizeBytes = first.Size;
            }
        }
        if (typeof r.DateModified === 'string') {
            const ms: number = Date.parse(r.DateModified);
            if (!Number.isNaN(ms)) {
                item.dateModifiedMs = ms;
            }
        }
        const imageTags: unknown = r.ImageTags;
        if (imageTags !== null && typeof imageTags === 'object'
            && typeof (imageTags as Record<string, unknown>).Primary === 'string') {
            item.hasCover = true;
        }
        return item;
    }

    /** Strip a trailing slash from `base` and prepend `/` to `path` if missing. */
    private static joinUrl(base: string, path: string): string {
        const normalisedBase: string = base.endsWith('/') ? base.slice(0, -1) : base;
        const normalisedPath: string = path.startsWith('/') ? path : `/${path}`;
        return `${normalisedBase}${normalisedPath}`;
    }

}