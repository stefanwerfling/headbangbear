import { promises as fs } from 'node:fs';
import { basename, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DataSource } from 'typeorm';
import { TransitionStyleSchema, type TransitionStyle } from '@headbangbear/schemas';
import { EssentiaAudioAnalyzer } from '../Analysis/EssentiaAudioAnalyzer.js';
import { AnalyzedTrackEntity } from '../Database/Entity/AnalyzedTrackEntity.js';
import { TrackMetadataEntity } from '../Database/Entity/TrackMetadataEntity.js';
import {
    DjSetPlanner,
    type DjSet as DjSetResult,
    type DjSetStrategy,
    type EnergyDirection,
    type EnergyShape,
} from '../DjSet/DjSetPlanner.js';
import { TrackLibrary, type AnalyzedTrack } from '../Library/TrackLibrary.js';
import { createCliDataSource } from './cliDataSource.js';

const CLI_PROVIDER_ID: string = 'cli';

interface CliArgs {
    readonly libraryDir: string;
    readonly direction: EnergyDirection;
    readonly strategy: DjSetStrategy;
    readonly beamWidth: number | undefined;
    readonly tryAllStarts: boolean;
    readonly shape: EnergyShape | undefined;
    readonly startPath: string | undefined;
    readonly targetDurationSec: number | undefined;
    readonly style: TransitionStyle | undefined;
}

export class DjSet {

    private readonly library: TrackLibrary;

    public constructor(library: TrackLibrary) {
        this.library = library;
    }

    public async run(args: CliArgs): Promise<DjSetResult> {
        const tracks: AnalyzedTrack[] = await this.library.scan();
        const startTrack: AnalyzedTrack | undefined = args.startPath !== undefined
            ? tracks.find((t: AnalyzedTrack): boolean => t.path === args.startPath)
            : undefined;
        if (args.startPath !== undefined && startTrack === undefined) {
            throw new Error(`--start path not found in library: ${args.startPath}`);
        }
        return new DjSetPlanner(tracks).plan({
            energyDirection: args.direction,
            energyShape: args.shape,
            strategy: args.strategy,
            beamWidth: args.beamWidth,
            tryAllStarts: args.tryAllStarts,
            start: startTrack,
            targetDurationSec: args.targetDurationSec,
            style: args.style,
        });
    }

    public static async main(argv: readonly string[]): Promise<number> {
        const parsed: CliArgs | string = DjSet.parseArgs(argv);
        if (typeof parsed === 'string') {
            console.error(parsed);
            return 1;
        }
        try {
            const stat = await fs.stat(parsed.libraryDir);
            if (!stat.isDirectory()) {
                console.error(`Not a directory: ${parsed.libraryDir}`);
                return 1;
            }
        } catch {
            console.error(`Directory not found or unreadable: ${parsed.libraryDir}`);
            return 1;
        }
        const ds: DataSource = await createCliDataSource();
        try {
            const lib: TrackLibrary = new TrackLibrary(
                CLI_PROVIDER_ID,
                parsed.libraryDir,
                new EssentiaAudioAnalyzer(),
                ds.getRepository(AnalyzedTrackEntity),
                ds.getRepository(TrackMetadataEntity),
                (event): void => {
                    if (event.phase === 'analyse') {
                        process.stderr.write(
                            `[${event.current.toString()}/${event.total.toString()}] analyzing ${basename(event.name)}\n`,
                        );
                    }
                },
            );
            const cli: DjSet = new DjSet(lib);
            try {
                const result: DjSetResult = await cli.run(parsed);
                console.log(JSON.stringify(result, null, 2));
                return 0;
            } catch (e) {
                console.error(e instanceof Error ? e.message : String(e));
                return 1;
            }
        } finally {
            await ds.destroy();
        }
    }

    private static parseArgs(argv: readonly string[]): CliArgs | string {
        const usage: string =
            'Usage: dj-set <library-dir> [up|down|either] [greedy|beam] '
            + '[--beam-width=N] [--single-start] [--shape=rising|arc|descending] '
            + '[--start=<path>] [--target-min=N] '
            + '[--style=drop-on-drop|tail-out|early-cut|bar-match]';
        const positional: string[] = [];
        let beamWidth: number | undefined;
        let tryAllStarts: boolean = true;
        let shape: EnergyShape | undefined;
        let startPathRaw: string | undefined;
        let targetDurationSec: number | undefined;
        let style: TransitionStyle | undefined;
        for (let i = 2; i < argv.length; i++) {
            const arg: string = argv[i] as string;
            if (arg.startsWith('--beam-width=')) {
                const raw: string = arg.slice('--beam-width='.length);
                const parsed: number = Number.parseInt(raw, 10);
                if (!Number.isFinite(parsed) || parsed < 1) {
                    return `Invalid --beam-width value: ${raw}`;
                }
                beamWidth = parsed;
                continue;
            }
            if (arg === '--single-start') {
                tryAllStarts = false;
                continue;
            }
            if (arg.startsWith('--shape=')) {
                const raw: string = arg.slice('--shape='.length);
                if (raw !== 'rising' && raw !== 'arc' && raw !== 'descending') {
                    return `Invalid --shape value: ${raw} (expected rising|arc|descending)`;
                }
                shape = raw;
                continue;
            }
            if (arg.startsWith('--start=')) {
                const raw: string = arg.slice('--start='.length);
                if (raw === '') {
                    return '--start requires a path';
                }
                startPathRaw = raw;
                continue;
            }
            if (arg.startsWith('--target-min=')) {
                const raw: string = arg.slice('--target-min='.length);
                const parsed: number = Number.parseFloat(raw);
                if (!Number.isFinite(parsed) || parsed <= 0) {
                    return `Invalid --target-min value: ${raw}`;
                }
                targetDurationSec = parsed * 60;
                continue;
            }
            if (arg.startsWith('--style=')) {
                const raw: string = arg.slice('--style='.length);
                if (!TransitionStyleSchema.validate(raw, [])) {
                    return `Invalid --style value: ${raw} (expected drop-on-drop|tail-out|early-cut|bar-match)`;
                }
                style = raw;
                continue;
            }
            positional.push(arg);
        }
        const dirArg: string | undefined = positional[0];
        if (dirArg === undefined) {
            return usage;
        }
        const libraryDir: string = resolve(dirArg);
        const startPath: string | undefined = startPathRaw !== undefined
            ? DjSet.toLibraryRelative(libraryDir, resolve(startPathRaw))
            : undefined;
        return {
            libraryDir: libraryDir,
            direction: DjSet.parseDirection(positional[1]),
            strategy: DjSet.parseStrategy(positional[2]),
            beamWidth: beamWidth,
            tryAllStarts: tryAllStarts,
            shape: shape,
            startPath: startPath,
            targetDurationSec: targetDurationSec,
            style: style,
        };
    }

    /** Match TrackLibrary's `sourceId` normalisation: forward-slash separators
     *  regardless of OS, so an `--start=` lookup hits the in-memory map. */
    private static toLibraryRelative(libraryDir: string, absPath: string): string {
        const rel: string = relative(libraryDir, absPath);
        return sep === '/' ? rel : rel.split(sep).join('/');
    }

    private static parseDirection(arg: string | undefined): EnergyDirection {
        if (arg === 'down' || arg === 'either') {
            return arg;
        }
        return 'up';
    }

    private static parseStrategy(arg: string | undefined): DjSetStrategy {
        return arg === 'beam' ? 'beam' : 'greedy';
    }

}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    void DjSet.main(process.argv).then((code: number): void => {
        process.exit(code);
    });
}