import { promises as fs } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TransitionStyleSchema, type TransitionStyle } from '@headbangbear/schemas';
import { EssentiaAudioAnalyzer } from '../Analysis/EssentiaAudioAnalyzer.js';
import { TrackLibrary, type AnalyzedTrack } from '../Library/TrackLibrary.js';
import { MixTransition, type TransitionPlan } from '../Mix/MixTransition.js';

export class MixPlan {
    private readonly library: TrackLibrary;

    public constructor(library: TrackLibrary) {
        this.library = library;
    }

    public async run(
        fromPath: string,
        toPath: string,
        libraryDir: string,
        style?: TransitionStyle,
    ): Promise<TransitionPlan> {
        await this.library.scan(libraryDir);
        const from: AnalyzedTrack | null = this.library.findByPath(fromPath);
        const to: AnalyzedTrack | null = this.library.findByPath(toPath);
        if (from === null) {
            throw new Error(`Track ${fromPath} not found in library after scan`);
        }
        if (to === null) {
            throw new Error(`Track ${toPath} not found in library after scan`);
        }
        return new MixTransition(from, to).plan({ style: style });
    }

    public static async main(argv: readonly string[]): Promise<number> {
        const fromArg: string | undefined = argv[2];
        const toArg: string | undefined = argv[3];
        if (fromArg === undefined || toArg === undefined) {
            console.error('Usage: mix-plan <from-track> <to-track> [--style=drop-on-drop|tail-out|early-cut|bar-match]');
            return 1;
        }
        const styleArg: string | undefined = argv.find((a: string): boolean => a.startsWith('--style='));
        let style: TransitionStyle | undefined;
        if (styleArg !== undefined) {
            const raw: string = styleArg.slice('--style='.length);
            if (!TransitionStyleSchema.validate(raw, [])) {
                console.error(`Invalid style "${raw}". Allowed: drop-on-drop, tail-out, early-cut, bar-match.`);
                return 1;
            }
            style = raw;
        }
        const fromPath: string = resolve(fromArg);
        const toPath: string = resolve(toArg);
        for (const p of [fromPath, toPath]) {
            try {
                await fs.access(p);
            } catch {
                console.error(`File not found or unreadable: ${p}`);
                return 1;
            }
        }
        const fromDir: string = dirname(fromPath);
        const toDir: string = dirname(toPath);
        if (fromDir !== toDir) {
            console.error(
                `Both tracks must live in the same library directory (got ${fromDir} vs ${toDir}).`,
            );
            return 1;
        }
        const cachePath: string = join(fromDir, '.analysis-cache.json');
        const lib: TrackLibrary = new TrackLibrary(
            new EssentiaAudioAnalyzer(),
            cachePath,
            (event): void => {
                if (event.phase === 'analyse') {
                    process.stderr.write(
                        `[${event.current.toString()}/${event.total.toString()}] analyzing ${basename(event.name)}\n`,
                    );
                }
            },
        );
        const cli: MixPlan = new MixPlan(lib);
        const plan: TransitionPlan = await cli.run(fromPath, toPath, fromDir, style);
        console.log(JSON.stringify(plan, null, 2));
        return 0;
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    void MixPlan.main(process.argv).then((code: number): void => {
        process.exit(code);
    });
}
