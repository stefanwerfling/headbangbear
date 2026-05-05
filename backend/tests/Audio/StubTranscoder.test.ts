import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { StubTranscoder } from '../../src/Audio/StubTranscoder.js';

describe('StubTranscoder', (): void => {

    it('prepends its prefix and returns the consumed input bytes', async (): Promise<void> => {
        const transcoder: StubTranscoder = new StubTranscoder('PFX:');
        const input: PassThrough = new PassThrough();

        const done: Promise<Buffer> = transcoder.transcode(input);
        input.end(Buffer.from('hello'));

        const result: Buffer = await done;
        expect(result.toString('utf8')).toBe('PFX:hello');
    });

    it('rejects with the configured error', async (): Promise<void> => {
        const failure: Error = new Error('boom');
        const transcoder: StubTranscoder = new StubTranscoder('PFX:', failure);
        const input: PassThrough = new PassThrough();
        input.end(Buffer.from('ignored'));

        await expect(transcoder.transcode(input)).rejects.toThrow(/boom/);
    });

});