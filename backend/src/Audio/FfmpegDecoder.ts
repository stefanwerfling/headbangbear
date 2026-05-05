import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

const DEFAULT_SAMPLE_RATE: number = 44100;

/**
 * Decodes an audio file (anything ffmpeg understands) into a mono Float32 PCM stream
 * by spawning the system `ffmpeg` binary and reading raw little-endian f32 from stdout.
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

    public decode(filePath: string): Promise<Float32Array> {
        return new Promise<Float32Array>((resolve, reject): void => {
            const proc: ChildProcessWithoutNullStreams = spawn(this.ffmpegPath, [
                '-i',
                filePath,
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
