import { Router } from 'express';
import { DefaultRoute } from 'figtree';
import { HandlerResultType, type DefaultHandlerReturn } from 'figtree-schemas';
import { Vts, type ExtractSchemaResultType } from 'vts';
import type { TrackLibrary } from '../../Library/TrackLibrary.js';

const AudioQuerySchema = Vts.object({
    path: Vts.string()
});
type AudioQuery = ExtractSchemaResultType<typeof AudioQuerySchema>;

/**
 * `GET /api/v1/library/audio?path=<abs-path>` — streams the requested mp3 with HTTP Range
 * support (express's `res.sendFile()` handles `Range:` headers natively, which is what
 * `wavesurfer.js` and `<audio>` elements need to seek without re-downloading).
 *
 * Path is validated against the loaded library so this endpoint cannot be used to read
 * arbitrary files from the host fs.
 */
export class AudioRoute extends DefaultRoute {
    private readonly library: TrackLibrary;

    public constructor(library: TrackLibrary) {
        super();
        this._uriBase = '/api/';
        this.library = library;
    }

    public override getExpressRouter(): Router {
        this._get<unknown, AudioQuery, unknown, unknown, unknown, unknown, unknown, unknown, unknown>(
            this._getUrl('v1', 'library', 'audio'),
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
                await new Promise<void>((resolve): void => {
                    res.sendFile(path, {}, (err: Error | undefined): void => {
                        if (err !== undefined && !res.headersSent) {
                            res.status(500).send('Failed to stream audio');
                        }
                        resolve();
                    });
                });
                return { type: HandlerResultType.handled };
            },
            {
                description: 'Stream the requested track\'s audio file (range-supporting).',
                tags: ['library'],
                querySchema: AudioQuerySchema
            }
        );
        return super.getExpressRouter();
    }
}