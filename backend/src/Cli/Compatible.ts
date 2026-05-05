import { promises as fs } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EssentiaAudioAnalyzer } from '../Analysis/EssentiaAudioAnalyzer.js';
import { TrackLibrary, type AnalyzedTrack } from '../Library/TrackLibrary.js';

export interface CompatibleMatch {
    readonly path: string;
    readonly camelot: string;
    readonly bpm: number;
    readonly bpmDelta: number;
    readonly energy: number;
}

export interface CompatibleOutput {
    readonly track: string;
    readonly camelot: string;
    readonly openKey: string;
    readonly bpm: number;
    readonly libraryDir: string;
    readonly scanned: number;
    readonly compatible: CompatibleMatch[];
}

export class Compatible {
    private readonly library: TrackLibrary;

    public constructor(library: TrackLibrary) {
        this.library = library;
    }

    public async run(trackPath: string, libraryDir: string): Promise<CompatibleOutput> {
        const all: AnalyzedTrack[] = await this.library.scan(libraryDir);
        const track: AnalyzedTrack | null = this.library.findByPath(trackPath);
        if (track === null) {
            throw new Error(`Track ${trackPath} not found in library after scan`);
        }
        const matches: AnalyzedTrack[] = this.library.compatible(track);

        return {
            track: trackPath,
            camelot: track.result.camelot.toString(),
            openKey: track.result.openKey.toString(),
            bpm: track.result.bpm,
            libraryDir: libraryDir,
            scanned: all.length,
            compatible: matches.map(
                (e: AnalyzedTrack): CompatibleMatch => ({
                    path: e.path,
                    camelot: e.result.camelot.toString(),
                    bpm: e.result.bpm,
                    bpmDelta: Math.round((e.result.bpm - track.result.bpm) * 10) / 10,
                    energy: e.result.energy,
                }),
            ),
        };
    }

    public static async main(argv: readonly string[]): Promise<number> {
        const arg: string | undefined = argv[2];
        if (arg === undefined) {
            console.error('Usage: compatible <file>');
            return 1;
        }
        const trackPath: string = resolve(arg);
        try {
            await fs.access(trackPath);
        } catch {
            console.error(`File not found or unreadable: ${trackPath}`);
            return 1;
        }
        const libraryDir: string = dirname(trackPath);
        const cachePath: string = join(libraryDir, '.analysis-cache.json');
        const lib: TrackLibrary = new TrackLibrary(
            new EssentiaAudioAnalyzer(),
            cachePath,
            (file: string): void => {
                process.stderr.write(`analyzing ${basename(file)}\n`);
            },
        );
        const cli: Compatible = new Compatible(lib);
        const output: CompatibleOutput = await cli.run(trackPath, libraryDir);
        console.log(JSON.stringify(output, null, 2));
        return 0;
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    void Compatible.main(process.argv).then((code: number): void => {
        process.exit(code);
    });
}
