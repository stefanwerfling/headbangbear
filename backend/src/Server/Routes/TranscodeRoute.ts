import { Router } from 'express';
import { DefaultRoute } from 'figtree';
import { HandlerResultType, type DefaultHandlerReturn } from 'figtree-schemas';
import type { AudioTranscoder } from '../../Audio/AudioTranscoder.js';

/**
 * `POST /api/v1/transcode` — accepts the raw recording bytes (WebM/Opus from
 * `MediaRecorder`, or any other container ffmpeg autodetects) on the request body and
 * responds with the full MP3 buffer. Buffered (not streamed) so encoder failures map
 * cleanly to HTTP 500. For HBB's use case (a single recorded DJ set) the buffer is
 * bounded and stays in process memory only briefly.
 */
export class TranscodeRoute extends DefaultRoute {

    private readonly transcoder: AudioTranscoder;

    public constructor(transcoder: AudioTranscoder) {
        super();
        this._uriBase = '/api/';
        this.transcoder = transcoder;
    }

    public override getExpressRouter(): Router {
        this._post<unknown, unknown, unknown, unknown, unknown, unknown, unknown, unknown, unknown>(
            this._getUrl('v1', 'transcode', ''),
            false,
            async (req, res, _data): Promise<DefaultHandlerReturn> => {
                try {
                    const mp3: Buffer = await this.transcoder.transcode(req);
                    res.status(200);
                    res.setHeader('Content-Type', 'audio/mpeg');
                    res.setHeader('Cache-Control', 'no-store');
                    res.setHeader('Content-Length', mp3.byteLength.toString());
                    res.end(mp3);
                } catch (err) {
                    const message: string = err instanceof Error ? err.message : String(err);
                    res.status(500).json({ error: message });
                }
                return { type: HandlerResultType.handled };
            },
            {
                description: 'Transcode an uploaded recording (WebM/Opus, OGG, MP4) to MP3.',
                tags: ['transcode']
            }
        );
        return super.getExpressRouter();
    }

}