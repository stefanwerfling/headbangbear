import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { Readable } from 'node:stream';
import { AudioTranscoder } from './AudioTranscoder.js';

const DEFAULT_BITRATE_KBPS: number = 320;

/**
 * Pipes the input stream through the system `ffmpeg` binary and re-encodes to MP3 (CBR
 * via `libmp3lame`). ffmpeg autodetects the input container (WebM/Opus, OGG, MP4, WAV)
 * from the magic bytes — works for every `MediaRecorder` mime type the frontend picks.
 * Output is `-f mp3` so the body is a clean MP3 stream (no MP4 container).
 */
export class FfmpegTranscoder extends AudioTranscoder {

    private readonly bitrateKbps: number;

    private readonly ffmpegPath: string;

    public constructor(bitrateKbps: number = DEFAULT_BITRATE_KBPS, ffmpegPath: string = 'ffmpeg') {
        super();
        this.bitrateKbps = bitrateKbps;
        this.ffmpegPath = ffmpegPath;
    }

    public override transcode(input: Readable): Promise<Buffer> {
        return new Promise<Buffer>((resolve, reject): void => {
            const proc: ChildProcessWithoutNullStreams = spawn(this.ffmpegPath, [
                '-i', 'pipe:0',
                '-vn',
                '-c:a', 'libmp3lame',
                '-b:a', `${this.bitrateKbps.toString()}k`,
                '-f', 'mp3',
                '-loglevel', 'error',
                'pipe:1'
            ]);

            const stdoutChunks: Buffer[] = [];
            const stderrChunks: Buffer[] = [];
            let settled: boolean = false;
            const settle = (err: Error | null): void => {
                if (settled) {
                    return;
                }
                settled = true;
                if (err === null) {
                    resolve(Buffer.concat(stdoutChunks));
                } else {
                    reject(err);
                }
            };

            proc.stdout.on('data', (chunk: Buffer): void => {
                stdoutChunks.push(chunk);
            });
            proc.stderr.on('data', (chunk: Buffer): void => {
                stderrChunks.push(chunk);
            });
            proc.on('error', (err: Error): void => {
                settle(err);
            });
            proc.on('close', (code: number | null): void => {
                if (code === 0) {
                    settle(null);
                    return;
                }
                const message: string = Buffer.concat(stderrChunks).toString().trim();
                settle(new Error(
                    `ffmpeg exited with code ${String(code)}${message.length > 0 ? `: ${message}` : ''}`
                ));
            });

            // ffmpeg may close stdin before consuming all of `input` if it errors early —
            // swallow the EPIPE so we don't double-reject.
            proc.stdin.on('error', (err: NodeJS.ErrnoException): void => {
                if (err.code !== 'EPIPE') {
                    settle(err);
                }
            });
            input.on('error', (err: Error): void => {
                proc.kill('SIGKILL');
                settle(err);
            });

            input.pipe(proc.stdin);
        });
    }

}