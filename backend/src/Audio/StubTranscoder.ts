import type { Readable } from 'node:stream';
import { AudioTranscoder } from './AudioTranscoder.js';

/**
 * Test-only transcoder. Prepends a `prefix` (default `STUB-MP3:`) to the consumed input
 * bytes so callers can assert the route's framing without needing a real ffmpeg binary
 * or a real WebM payload.
 */
export class StubTranscoder extends AudioTranscoder {

    private readonly prefix: Buffer;

    private readonly failWithError: Error | null;

    public constructor(prefix: string = 'STUB-MP3:', failWithError: Error | null = null) {
        super();
        this.prefix = Buffer.from(prefix, 'utf8');
        this.failWithError = failWithError;
    }

    public override transcode(input: Readable): Promise<Buffer> {
        return new Promise<Buffer>((resolve, reject): void => {
            if (this.failWithError !== null) {
                input.resume();
                reject(this.failWithError);
                return;
            }
            const chunks: Buffer[] = [this.prefix];
            input.on('data', (chunk: Buffer): void => {
                chunks.push(chunk);
            });
            input.on('end', (): void => {
                resolve(Buffer.concat(chunks));
            });
            input.on('error', (err: Error): void => {
                reject(err);
            });
        });
    }

}