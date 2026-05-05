import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { Readable } from 'node:stream';

const DEFAULT_SAMPLE_RATE: number = 44100;

/** Source of bytes for the decoder — either an on-disk file path or a `Readable` stream
 *  that gets piped into ffmpeg's stdin (used by the Jellyfin provider, which never
 *  materialises tracks on local disk). */
export type DecoderInput = string | Readable;

/**
 * Decodes an audio file or stream (anything ffmpeg understands) into a mono Float32 PCM
 * stream by spawning the system `ffmpeg` binary and reading raw little-endian f32 from
 * stdout. Two input modes:
 *  - **String path** — `-i <path>` (existing local-library flow).
 *  - **`Readable` stream** — `-i pipe:0`, the stream is piped into ffmpeg's stdin
 *    (Jellyfin / future remote sources). The stream's bytes never touch local disk.
 */
export class FfmpegDecoder {
    private readonly sampleRate: number;

    private readonly ffmpegPath: string;

    public constructor(sampleRate: number = DEFAULT_SAMPLE_RATE, ffmpegPath: string = 'ffmpeg') {
        this.sampleRate = sampleRate;
        this.ffmpegPath = ffmpegPath;
    }

    public get rate(): number {
        return this.sampleRate;
    }

    public decode(input: DecoderInput): Promise<Float32Array> {
        return new Promise<Float32Array>((resolve, reject): void => {
            const isStream: boolean = typeof input !== 'string';
            const proc: ChildProcessWithoutNullStreams = spawn(this.ffmpegPath, [
                '-i',
                isStream ? 'pipe:0' : (input as string),
                '-f',
                'f32le',
                '-ac',
                '1',
                '-ar',
                String(this.sampleRate),
                '-loglevel',
                'error',
                '-',
            ]);

            const stdoutChunks: Buffer[] = [];
            const stderrChunks: Buffer[] = [];

            proc.stdout.on('data', (chunk: Buffer): void => {
                stdoutChunks.push(chunk);
            });
            proc.stderr.on('data', (chunk: Buffer): void => {
                stderrChunks.push(chunk);
            });
            proc.on('error', (err: Error): void => {
                reject(err);
            });
            proc.on('close', (code: number | null): void => {
                if (code !== 0) {
                    const message: string = Buffer.concat(stderrChunks).toString().trim();
                    reject(
                        new Error(
                            `ffmpeg exited with code ${String(code)}${message.length > 0 ? `: ${message}` : ''}`,
                        ),
                    );
                    return;
                }
                resolve(FfmpegDecoder.bufferToFloat32(Buffer.concat(stdoutChunks)));
            });

            if (isStream) {
                const stream: Readable = input as Readable;
                // Swallow EPIPE — ffmpeg may close stdin early when it has enough audio
                // (or on a decode error) and Node would otherwise propagate the write
                // error and crash the analysis. The proc-level error/close handlers
                // surface real failures through the rejection path.
                proc.stdin.on('error', (): void => {});
                stream.on('error', (err: Error): void => {
                    reject(err);
                });
                stream.pipe(proc.stdin);
            }
        });
    }

    private static bufferToFloat32(buf: Buffer): Float32Array {
        const sampleCount: number = Math.floor(buf.byteLength / 4);
        const samples: Float32Array = new Float32Array(sampleCount);
        for (let i = 0; i < sampleCount; i++) {
            samples[i] = buf.readFloatLE(i * 4);
        }
        return samples;
    }
}
