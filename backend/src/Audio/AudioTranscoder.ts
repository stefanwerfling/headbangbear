import type { Readable } from 'node:stream';

/**
 * Contract for piping a recording through a transcoder. Implementations consume `input`
 * (e.g. WebM/Opus from MediaRecorder) and resolve with the fully-transcoded bytes.
 *
 * Buffered (not streamed) so the route can map an encoder failure to a real HTTP 5xx —
 * a streaming response can't change its status code once headers are sent. For HBB's use
 * case (a single recorded DJ set, ≤ a few hundred MB), in-memory is fine.
 */
export abstract class AudioTranscoder {

    public abstract transcode(input: Readable): Promise<Buffer>;

}