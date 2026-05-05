import { spawnSync } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { FfmpegTranscoder } from '../../src/Audio/FfmpegTranscoder.js';

function ffmpegAvailable(): boolean {
    const result = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return result.status === 0;
}

const HAS_FFMPEG: boolean = ffmpegAvailable();

describe.skipIf(!HAS_FFMPEG)('FfmpegTranscoder', (): void => {

    it('encodes a generated WAV silence stream into MP3 bytes', async (): Promise<void> => {
        // Build a 1-second mono 44.1kHz silent WAV in memory — ffmpeg autodetects WAV
        // from the RIFF header just like it does WebM/EBML in real use.
        const sampleRate: number = 44100;
        const numSamples: number = sampleRate;
        const dataSize: number = numSamples * 2;
        const wav: Buffer = Buffer.alloc(44 + dataSize);
        wav.write('RIFF', 0);
        wav.writeUInt32LE(36 + dataSize, 4);
        wav.write('WAVE', 8);
        wav.write('fmt ', 12);
        wav.writeUInt32LE(16, 16);
        wav.writeUInt16LE(1, 20);
        wav.writeUInt16LE(1, 22);
        wav.writeUInt32LE(sampleRate, 24);
        wav.writeUInt32LE(sampleRate * 2, 28);
        wav.writeUInt16LE(2, 32);
        wav.writeUInt16LE(16, 34);
        wav.write('data', 36);
        wav.writeUInt32LE(dataSize, 40);
        // PCM samples remain 0 = silence.

        const transcoder: FfmpegTranscoder = new FfmpegTranscoder(128);
        const input: PassThrough = new PassThrough();

        const done: Promise<Buffer> = transcoder.transcode(input);
        input.end(wav);
        const mp3: Buffer = await done;

        expect(mp3.length).toBeGreaterThan(0);
        // libmp3lame prepends an ID3v2 header ("ID3" magic) before the first MP3 frame
        // (sync word 0xFF…). Accept either start.
        const head: string = mp3.subarray(0, 3).toString('ascii');
        const isId3: boolean = head === 'ID3';
        const isMp3Sync: boolean = mp3[0] === 0xff && mp3[1] !== undefined && (mp3[1] & 0xe0) === 0xe0;
        expect(isId3 || isMp3Sync).toBe(true);
    });

    it('rejects with ffmpeg stderr when the input is invalid', async (): Promise<void> => {
        const transcoder: FfmpegTranscoder = new FfmpegTranscoder(128);
        const input: PassThrough = new PassThrough();

        const done: Promise<Buffer> = transcoder.transcode(input);
        input.end(Buffer.from('this is not audio'));

        await expect(done).rejects.toThrow(/ffmpeg exited with code/);
    });

});