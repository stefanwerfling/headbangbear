import { fileURLToPath } from 'node:url';
import { Worker, type WorkerOptions } from 'node:worker_threads';
import { FfmpegDecoder } from '../Audio/FfmpegDecoder.js';
import { AudioAnalyzer, type AnalyzerInput } from './AudioAnalyzer.js';
import { Camelot } from './Camelot.js';
import { OpenKey } from './OpenKey.js';
import type { AnalyzeRequest, AnalyzeResponse } from './EssentiaWorker.js';
import type { AnalysisResult, MusicalKey } from './schemas.js';

interface PendingAnalysis {
    readonly resolve: (response: AnalyzeResponse) => void;
    readonly reject: (err: Error) => void;
}

/**
 * Off-thread essentia analysis. The WASM-bound `KeyExtractor` / `RhythmExtractor2013`
 * / `RMS` calls — each tens to hundreds of milliseconds of solid CPU on a 4-min track —
 * are delegated to a `worker_threads` Worker so the main event loop stays free to serve
 * HTTP during a scan. Audio decoding (ffmpeg subprocess) is already non-blocking and
 * stays on the main thread; only the post-decode samples are transferred (zero-copy
 * via `ArrayBuffer` transfer list) into the worker.
 *
 * The Worker is a process-wide singleton — every analyzer instance shares one worker
 * and one WASM module. KeyProfileSweep instantiates six analyzers (one per profile)
 * but they all funnel through the same worker, so we don't pay six WASM init costs.
 *
 * `profileType` controls essentia's KeyExtractor profile. Default `'bgate'` matches
 * essentia's own default. `KeyProfileSweep` (under `src/Eval/`) compares profiles
 * empirically per library.
 */
export class EssentiaAudioAnalyzer extends AudioAnalyzer {

    private static workerInstance: Worker | null = null;

    private static pending: Map<number, PendingAnalysis> = new Map();

    private static nextId: number = 1;

    /** Number of successful + failed analyses on the current worker. Used to
     *  proactively recycle the worker every `WORKER_RECYCLE_AFTER` calls so the
     *  WASM heap inside essentia.js doesn't grow without bound across long
     *  scans (a 7k-track Jellyfin library has been observed to OOM-kill the
     *  process around track ~700 without recycling). */
    private static workerCallCount: number = 0;

    private static readonly WORKER_RECYCLE_AFTER: number = 200;

    private readonly decoder: FfmpegDecoder;

    private readonly profileType: string;

    public constructor(
        decoder: FfmpegDecoder = new FfmpegDecoder(),
        profileType: string = 'bgate',
    ) {
        super();
        this.decoder = decoder;
        this.profileType = profileType;
    }

    /**
     * Decode + KeyExtractor only, skipping rhythm/RMS/drops. Used by `KeyProfileSweep`
     * which needs many fast key predictions per track and doesn't care about the rest.
     */
    public async analyzeKeyOnly(input: AnalyzerInput): Promise<MusicalKey> {
        const samples: Float32Array = await this.decoder.decode(input);
        if (samples.length === 0) {
            throw new Error(`No audio samples decoded from ${EssentiaAudioAnalyzer.describeInput(input)}`);
        }
        const response: AnalyzeResponse = await EssentiaAudioAnalyzer.dispatch({
            samples: samples,
            sampleRate: this.decoder.rate,
            profileType: this.profileType,
            keyOnly: true,
        });
        if (!response.ok) {
            throw new Error(response.error);
        }
        return { tonic: response.keyTonic, mode: response.keyMode };
    }

    public override async analyze(input: AnalyzerInput): Promise<AnalysisResult> {
        const samples: Float32Array = await this.decoder.decode(input);
        if (samples.length === 0) {
            throw new Error(`No audio samples decoded from ${EssentiaAudioAnalyzer.describeInput(input)}`);
        }
        const response: AnalyzeResponse = await EssentiaAudioAnalyzer.dispatch({
            samples: samples,
            sampleRate: this.decoder.rate,
            profileType: this.profileType,
            keyOnly: false,
        });
        if (!response.ok) {
            throw new Error(response.error);
        }
        // The worker can't ship class instances across postMessage so it returns the
        // primitives and we hydrate Camelot + OpenKey here. Both constructors are
        // O(1) lookups, no measurable cost.
        const key: MusicalKey = { tonic: response.keyTonic, mode: response.keyMode };
        const camelot: Camelot = Camelot.fromKey(key);
        const openKey: OpenKey = OpenKey.fromCamelot(camelot);
        return {
            key: key,
            camelot: camelot,
            openKey: openKey,
            bpm: response.bpm ?? 0,
            energy: response.energy ?? 0,
            durationSec: response.durationSec ?? 0,
            beats: response.beats ?? [],
            energyTimeline: response.energyTimeline ?? [],
            drops: response.drops ?? [],
        };
    }

    /** Send one analyze request to the (singleton) worker and await the matching
     *  response. Concurrent calls are multiplexed by the request `id`.
     *
     *  After every response (ok or error) the worker is recycled if either
     *  (a) the response is an error — Essentia's WASM module sometimes calls
     *  `abort(undefined)` on malformed audio, which corrupts subsequent state
     *  even though our `vector.delete()` ran in the finally — or (b) the call
     *  count exceeds `WORKER_RECYCLE_AFTER`, capping accumulated WASM-heap
     *  growth. Both rules together keep the process's RSS bounded over the
     *  lifetime of a 7k-track scan. */
    private static async dispatch(req: Omit<AnalyzeRequest, 'id'>): Promise<AnalyzeResponse> {
        const worker: Worker = EssentiaAudioAnalyzer.getWorker();
        const id: number = EssentiaAudioAnalyzer.nextId++;
        const response: AnalyzeResponse = await new Promise<AnalyzeResponse>(
            (resolve, reject): void => {
                EssentiaAudioAnalyzer.pending.set(id, { resolve: resolve, reject: reject });
                const fullReq: AnalyzeRequest = {
                    id: id,
                    samples: req.samples,
                    sampleRate: req.sampleRate,
                    profileType: req.profileType,
                    keyOnly: req.keyOnly,
                };
                // Transfer the underlying buffer so we don't pay a structured-clone copy
                // (a 4-min track's PCM is ~40 MB at 44.1 kHz mono Float32). The cast is
                // safe — `FfmpegDecoder` always returns a `Float32Array` over a fresh
                // `ArrayBuffer` (never a `SharedArrayBuffer`), but the type system
                // widens `Float32Array['buffer']` to `ArrayBufferLike`.
                worker.postMessage(fullReq, [fullReq.samples.buffer as ArrayBuffer]);
            },
        );
        EssentiaAudioAnalyzer.workerCallCount += 1;
        const shouldRecycle: boolean = !response.ok
            || EssentiaAudioAnalyzer.workerCallCount >= EssentiaAudioAnalyzer.WORKER_RECYCLE_AFTER;
        if (shouldRecycle) {
            EssentiaAudioAnalyzer.recycleWorker();
        }
        return response;
    }

    /** Tear down the current worker so the next `dispatch` lazy-spawns a fresh
     *  one. In-flight requests on the dying worker are left to the existing
     *  `error` / `exit` handlers — `terminate()` triggers `exit` which clears
     *  `pending`. */
    private static recycleWorker(): void {
        if (EssentiaAudioAnalyzer.workerInstance === null) {
            return;
        }
        const w: Worker = EssentiaAudioAnalyzer.workerInstance;
        EssentiaAudioAnalyzer.workerInstance = null;
        EssentiaAudioAnalyzer.workerCallCount = 0;
        void w.terminate();
    }

    private static getWorker(): Worker {
        if (EssentiaAudioAnalyzer.workerInstance !== null) {
            return EssentiaAudioAnalyzer.workerInstance;
        }
        const here: string = fileURLToPath(import.meta.url);
        // Sibling `EssentiaWorker.<ts|js>` next to this file. Dev runs under `tsx
        // watch` (source `.ts`); prod runs the `tsc`-built `.js`. We pick the
        // matching extension from `import.meta.url` so the same code resolves
        // correctly in both modes.
        const workerEntry: string = here.replace(
            /EssentiaAudioAnalyzer\.(ts|js)$/,
            'EssentiaWorker.$1',
        );
        const isTs: boolean = workerEntry.endsWith('.ts');
        // tsx 4.x supports `--import tsx` to register its loader for the worker
        // process. The loader transpiles `.ts` on demand, just like in the parent.
        const options: WorkerOptions = isTs ? { execArgv: ['--import', 'tsx'] } : {};
        const w: Worker = new Worker(workerEntry, options);
        w.on('message', (msg: AnalyzeResponse): void => {
            const pending: PendingAnalysis | undefined = EssentiaAudioAnalyzer.pending.get(msg.id);
            if (pending === undefined) {
                return;
            }
            EssentiaAudioAnalyzer.pending.delete(msg.id);
            pending.resolve(msg);
        });
        w.on('error', (err: Error): void => {
            // Worker-level error — fail every in-flight request and reset the
            // singleton so the next analyze() spawns a fresh worker.
            for (const p of EssentiaAudioAnalyzer.pending.values()) {
                p.reject(err);
            }
            EssentiaAudioAnalyzer.pending.clear();
            // Only clear the singleton if it still points at the dying worker.
            // `recycleWorker()` may have already set a fresh one — don't null it.
            if (EssentiaAudioAnalyzer.workerInstance === w) {
                EssentiaAudioAnalyzer.workerInstance = null;
            }
        });
        w.on('exit', (code: number): void => {
            if (EssentiaAudioAnalyzer.workerInstance === w) {
                EssentiaAudioAnalyzer.workerInstance = null;
            }
            if (EssentiaAudioAnalyzer.pending.size > 0) {
                const err: Error = new Error(
                    `EssentiaWorker exited unexpectedly with code ${code.toString()}`,
                );
                for (const p of EssentiaAudioAnalyzer.pending.values()) {
                    p.reject(err);
                }
                EssentiaAudioAnalyzer.pending.clear();
            }
        });
        EssentiaAudioAnalyzer.workerInstance = w;
        return w;
    }

    /** Best-effort label for use in error messages — paths get returned as-is, streams
     *  collapse to the constant `<stream>` (we don't expose individual Readable details). */
    private static describeInput(input: AnalyzerInput): string {
        return typeof input === 'string' ? input : '<stream>';
    }

}