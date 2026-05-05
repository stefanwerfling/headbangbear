import { Router } from 'express';
import { DefaultRoute } from 'figtree';
import { HandlerResultType, type DefaultHandlerReturn } from 'figtree-schemas';
import { Vts, type ExtractSchemaResultType } from 'vts';
import type { TrackLibrary } from '../../Library/TrackLibrary.js';
import type { CoverArtCache } from '../../Metadata/CoverArtCache.js';

const CoverQuerySchema = Vts.object({
    path: Vts.string(),
});
type CoverQuery = ExtractSchemaResultType<typeof CoverQuerySchema>;

/**
 * `GET /api/v1/library/cover?path=<abs-path>` — returns the cached cover image bytes for a
 * track, or 404 when none was extracted. Mirrors `AudioRoute`'s contract:
 *
 *   - `path` is validated against the loaded library, so the route cannot be used to read
 *     arbitrary files from the host filesystem.
 *   - Binary out via `res.sendFile()`; Express picks the `Content-Type` from the cover-cache
 *     filename (`.jpg`/`.png`/`.webp`/`.gif`).
 *   - `HandlerResultType.handled` so figtree's default JSON envelope doesn't wrap the bytes.
 */
export class LibraryCoverRoute extends DefaultRoute {

    private readonly library: TrackLibrary;

    private readonly coverCache: CoverArtCache;

    public constructor(library: TrackLibrary, coverCache: CoverArtCache) {
        super();
        this._uriBase = '/api/';
        this.library = library;
        this.coverCache = coverCache;
    }

    public override getExpressRouter(): Router {
        this._get<unknown, CoverQuery, unknown, unknown, unknown, unknown, unknown, unknown, unknown>(
            this._getUrl('v1', 'library', 'cover'),
            false,
            async (_req, res, data): Promise<DefaultHandlerReturn> => {
                const path: string | undefined = data.query?.path;
                if (path === undefined) {
                    res.status(400).send('Missing required query parameter: path');
                    return { type: HandlerResultType.handled };
                }
                if (this.library.findByPath(path) === null) {
                    res.status(404).send('Track not found in library');
                    return { type: HandlerResultType.handled };
                }
                const coverFile: string | null = await this.coverCache.coverPath(path);
                if (coverFile === null) {
                    res.status(404).send('No cover art for this track');
                    return { type: HandlerResultType.handled };
                }
                // `dotfiles: 'allow'` is required because the cover cache lives under a
                // `.covers/` subdirectory — express's default `dotfiles: 'ignore'` would
                // refuse to serve any path containing a dot-segment, returning a synthetic
                // 404-style error to the callback that we'd surface as a generic 500.
                await new Promise<void>((resolve): void => {
                    res.sendFile(
                        coverFile,
                        { dotfiles: 'allow' },
                        (err: Error | undefined): void => {
                            if (err !== undefined && !res.headersSent) {
                                res.status(500).send('Failed to stream cover');
                            }
                            resolve();
                        },
                    );
                });
                return { type: HandlerResultType.handled };
            },
            {
                description: 'Stream the cached cover image for a track (404 when none exists).',
                tags: ['library'],
                querySchema: CoverQuerySchema,
            },
        );
        return super.getExpressRouter();
    }

}