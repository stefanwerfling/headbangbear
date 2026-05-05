import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AudioAnalyzer } from '../Analysis/AudioAnalyzer.js';
import { EssentiaAudioAnalyzer } from '../Analysis/EssentiaAudioAnalyzer.js';
import type { AnalysisResult } from '../Analysis/schemas.js';

export interface AnalyzeOutput {
    readonly file: string;
    readonly key: string;
    readonly camelot: string;
    readonly openKey: string;
    readonly bpm: number;
    readonly energy: number;
    readonly durationSec: number;
    readonly drops: number[];
}

export class Analyze {
    private readonly analyzer: AudioAnalyzer;

    public constructor(analyzer: AudioAnalyzer) {
        this.analyzer = analyzer;
    }

    public async run(filePath: string): Promise<AnalyzeOutput> {
        const result: AnalysisResult = await this.analyzer.analyze(filePath);
        return {
            file: filePath,
            key: `${result.key.tonic} ${result.key.mode}`,
            camelot: result.camelot.toString(),
            openKey: result.openKey.toString(),
            bpm: result.bpm,
            energy: result.energy,
            durationSec: result.durationSec,
            drops: result.drops,
        };
    }

    public static async main(argv: readonly string[]): Promise<number> {
        const arg: string | undefined = argv[2];
        if (arg === undefined) {
            console.error('Usage: analyze <file>');
            return 1;
        }
        const filePath: string = resolve(arg);
        try {
            await fs.access(filePath);
        } catch {
            console.error(`File not found or unreadable: ${filePath}`);
            return 1;
        }
        const cli: Analyze = new Analyze(new EssentiaAudioAnalyzer());
        const output: AnalyzeOutput = await cli.run(filePath);
        console.log(JSON.stringify(output, null, 2));
        return 0;
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    void Analyze.main(process.argv).then((code: number): void => {
        process.exit(code);
    });
}
