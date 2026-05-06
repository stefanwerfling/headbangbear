import { fileURLToPath } from 'node:url';
import { Worker, type WorkerOptions } from 'node:worker_threads';
import type { DjSet, DjSetPlanStatus } from '@headbangbear/schemas';
import type { AnalyzedTrack } from '../Library/TrackLibrary.js';
import type { DjSetPlannerOptions } from './DjSetPlanner.js';
import type {
    PlanRequest,
    PlanResponse,
    SerializedAnalyzedTrack,
    SerializedPlanOptions,
} from './DjSetPlannerWorker.js';

/**
 * Singleton job runner for `DjSetPlanner`. The plan endpoint is async so the
 * heavy beam search doesn't block the HTTP event loop:
 *
 *  - `start(tracks, options)` — terminates any previous worker, spawns a fresh
 *    one, and returns the new status (`running` with `startedAtMs` set).
 *  - `getStatus()` — current snapshot. The frontend polls this to learn when
 *    the result is ready (state `done` with `result`) or failed (`error`).
 *
 * Cancellation policy is "replace": a fresh `start()` while one is already
 * running terminates the old worker — its result is discarded. Matches user
 * intent ("they clicked Generate again, ignore the old one").
 */
export class DjSetPlannerJob {

    private static instance: DjSetPlannerJob | null = null;

    public static getInstance(): DjSetPlannerJob {
        if (DjSetPlannerJob.instance === null) {
            DjSetPlannerJob.instance = new DjSetPlannerJob();
        }
        return DjSetPlannerJob.instance;
    }

    private worker: Worker | null = null;

    private state: DjSetPlanStatus['state'] = 'idle';

    private startedAtMs: number | null = null;

    private finishedAtMs: number | null = null;

    private progress: { current: number; total: number; phase: string } | null = null;

    private result: DjSet | null = null;

    private error: string | null = null;

    private currentRequestId: number = 0;

    public start(tracks: AnalyzedTrack[], options: DjSetPlannerOptions): DjSetPlanStatus {
        // Kill any in-flight worker — user clicked Generate again, the old
        // result is no longer wanted. terminate() is async but we don't await:
        // the post-terminate `exit` handler is keyed off `currentRequestId` and
        // will see it bumped, so old messages get ignored.
        if (this.worker !== null) {
            void this.worker.terminate();
            this.worker = null;
        }
        this.currentRequestId += 1;
        const requestId: number = this.currentRequestId;
        this.state = 'running';
        this.startedAtMs = Date.now();
        this.finishedAtMs = null;
        this.progress = null;
        this.result = null;
        this.error = null;

        const w: Worker = DjSetPlannerJob.spawnWorker();
        w.on('message', (msg: PlanResponse): void => {
            // Stale message — a newer start() has superseded this worker.
            if (msg.id !== requestId) {
                return;
            }
            if (msg.type === 'progress') {
                this.progress = {
                    current: msg.current,
                    total: msg.total,
                    phase: msg.phase,
                };
                return;
            }
            if (msg.type === 'done') {
                this.state = 'done';
                this.result = msg.result;
                this.finishedAtMs = Date.now();
                void w.terminate();
                if (this.worker === w) {
                    this.worker = null;
                }
                return;
            }
            this.state = 'error';
            this.error = msg.message;
            this.finishedAtMs = Date.now();
            void w.terminate();
            if (this.worker === w) {
                this.worker = null;
            }
        });
        w.on('error', (err: Error): void => {
            // `error` only matches the in-flight request — superseded workers
            // get their `currentRequestId` bumped before terminate, so a late
            // error from them won't flip our state.
            if (this.currentRequestId !== requestId) {
                return;
            }
            this.state = 'error';
            this.error = err.message;
            this.finishedAtMs = Date.now();
            if (this.worker === w) {
                this.worker = null;
            }
        });
        w.on('exit', (code: number): void => {
            if (this.currentRequestId !== requestId) {
                return;
            }
            // Worker exited without a `done` / `error` message — that only
            // happens on terminate(), which we trigger ourselves on supersede
            // OR after done/error. Catch the rogue case: state still `running`
            // → mark as error so the UI doesn't poll forever.
            if (this.state === 'running') {
                this.state = 'error';
                this.error = `Worker exited with code ${code.toString()}`;
                this.finishedAtMs = Date.now();
            }
            if (this.worker === w) {
                this.worker = null;
            }
        });
        this.worker = w;

        const serialized: PlanRequest = {
            id: requestId,
            tracks: tracks.map(DjSetPlannerJob.serializeTrack),
            options: DjSetPlannerJob.serializeOptions(options),
        };
        w.postMessage(serialized);
        return this.getStatus();
    }

    public getStatus(): DjSetPlanStatus {
        const out: DjSetPlanStatus = { state: this.state };
        if (this.startedAtMs !== null) {
            out.startedAtMs = this.startedAtMs;
        }
        if (this.finishedAtMs !== null) {
            out.finishedAtMs = this.finishedAtMs;
        }
        if (this.progress !== null) {
            out.progress = this.progress;
        }
        if (this.result !== null) {
            out.result = this.result;
        }
        if (this.error !== null) {
            out.error = this.error;
        }
        return out;
    }

    private static spawnWorker(): Worker {
        const here: string = fileURLToPath(import.meta.url);
        // Sibling `DjSetPlannerWorker.<ts|js>`. Same dev-vs-prod resolution as
        // `EssentiaAudioAnalyzer` — pick the right extension from
        // `import.meta.url`, register the tsx loader for the worker process
        // when running under `tsx watch`.
        const workerEntry: string = here.replace(
            /DjSetPlannerJob\.(ts|js)$/,
            'DjSetPlannerWorker.$1',
        );
        const isTs: boolean = workerEntry.endsWith('.ts');
        const opts: WorkerOptions = isTs ? { execArgv: ['--import', 'tsx'] } : {};
        return new Worker(workerEntry, opts);
    }

    private static serializeTrack(t: AnalyzedTrack): SerializedAnalyzedTrack {
        const out: SerializedAnalyzedTrack = {
            providerId: t.providerId,
            path: t.path,
            result: {
                key: t.result.key,
                camelot: t.result.camelot.toString(),
                openKey: t.result.openKey.toString(),
                bpm: t.result.bpm,
                energy: t.result.energy,
                durationSec: t.result.durationSec,
                beats: t.result.beats,
                energyTimeline: t.result.energyTimeline,
                drops: t.result.drops,
            },
            hasCover: t.hasCover,
        };
        if (t.metadata !== undefined) {
            (out as { metadata?: typeof t.metadata }).metadata = t.metadata;
        }
        return out;
    }

    private static serializeOptions(o: DjSetPlannerOptions): SerializedPlanOptions {
        const out: SerializedPlanOptions = {};
        if (o.energyDirection !== undefined) {
            (out as { energyDirection?: typeof o.energyDirection }).energyDirection = o.energyDirection;
        }
        if (o.energyShape !== undefined) {
            (out as { energyShape?: typeof o.energyShape }).energyShape = o.energyShape;
        }
        if (o.strategy !== undefined) {
            (out as { strategy?: typeof o.strategy }).strategy = o.strategy;
        }
        if (o.beamWidth !== undefined) {
            (out as { beamWidth?: number }).beamWidth = o.beamWidth;
        }
        if (o.tryAllStarts !== undefined) {
            (out as { tryAllStarts?: boolean }).tryAllStarts = o.tryAllStarts;
        }
        if (o.targetDurationSec !== undefined) {
            (out as { targetDurationSec?: number }).targetDurationSec = o.targetDurationSec;
        }
        if (o.style !== undefined) {
            (out as { style?: typeof o.style }).style = o.style;
        }
        if (o.avoidSameArtist !== undefined) {
            (out as { avoidSameArtist?: boolean }).avoidSameArtist = o.avoidSameArtist;
        }
        if (o.start !== undefined) {
            (out as { startProviderId?: string; startPath?: string }).startProviderId = o.start.providerId;
            (out as { startPath?: string }).startPath = o.start.path;
        }
        return out;
    }

}