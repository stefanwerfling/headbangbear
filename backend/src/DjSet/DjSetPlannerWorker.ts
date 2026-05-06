import { parentPort } from 'node:worker_threads';
import type {
    DjSet,
    DjSetStrategy,
    EnergyDirection,
    EnergyShape,
    TrackMetadata,
    TransitionStyle,
} from '@headbangbear/schemas';
import { Camelot } from '../Analysis/Camelot.js';
import { OpenKey } from '../Analysis/OpenKey.js';
import type { SerializedAnalysisResult } from '../Analysis/schemas.js';
import type { AnalyzedTrack } from '../Library/TrackLibrary.js';
import { DjSetPlanner } from './DjSetPlanner.js';

/** Wire shape for an `AnalyzedTrack` — Camelot/OpenKey class instances become
 *  canonical strings. Reconstructed on the worker side before the planner
 *  runs (it dispatches off `camelot.compatibleKeys()` / `isCompatibleWith()`). */
export interface SerializedAnalyzedTrack {
    readonly providerId: string;
    readonly path: string;
    readonly result: SerializedAnalysisResult;
    readonly metadata?: TrackMetadata;
    readonly hasCover: boolean;
}

export interface PlanRequest {
    readonly id: number;
    readonly tracks: SerializedAnalyzedTrack[];
    readonly options: SerializedPlanOptions;
}

export interface SerializedPlanOptions {
    readonly energyDirection?: EnergyDirection;
    readonly energyShape?: EnergyShape;
    readonly strategy?: DjSetStrategy;
    readonly beamWidth?: number;
    readonly tryAllStarts?: boolean;
    readonly targetDurationSec?: number;
    readonly style?: TransitionStyle;
    readonly avoidSameArtist?: boolean;
    /** Resolved start track reference. The worker matches this against the
     *  deserialised track list to recover the start instance. */
    readonly startProviderId?: string;
    readonly startPath?: string;
}

export type PlanResponse =
    | { readonly id: number; readonly type: 'progress'; readonly current: number; readonly total: number; readonly phase: string }
    | { readonly id: number; readonly type: 'done'; readonly result: DjSet }
    | { readonly id: number; readonly type: 'error'; readonly message: string };

if (parentPort === null) {
    throw new Error('DjSetPlannerWorker must be run as a worker thread');
}
const port = parentPort;

function deserializeTrack(s: SerializedAnalyzedTrack): AnalyzedTrack {
    const camelot: Camelot | null = Camelot.fromString(s.result.camelot);
    const openKey: OpenKey | null = OpenKey.fromString(s.result.openKey);
    if (camelot === null || openKey === null) {
        throw new Error(
            `Cannot deserialise track ${s.providerId}|${s.path}: `
            + `camelot="${s.result.camelot}" openKey="${s.result.openKey}"`,
        );
    }
    const track: AnalyzedTrack = {
        providerId: s.providerId,
        path: s.path,
        result: {
            key: s.result.key,
            camelot: camelot,
            openKey: openKey,
            bpm: s.result.bpm,
            energy: s.result.energy,
            durationSec: s.result.durationSec,
            beats: s.result.beats,
            energyTimeline: s.result.energyTimeline,
            drops: s.result.drops,
        },
        hasCover: s.hasCover,
        // The planner runs over `enabledTracks()` already, so disabled is
        // always false here. Field is required by the AnalyzedTrack interface.
        disabled: false,
    };
    if (s.metadata !== undefined) {
        track.metadata = s.metadata;
    }
    return track;
}

port.on('message', (msg: PlanRequest): void => {
    try {
        const tracks: AnalyzedTrack[] = msg.tracks.map(deserializeTrack);
        const start: AnalyzedTrack | undefined = msg.options.startProviderId !== undefined
            && msg.options.startPath !== undefined
            ? tracks.find(
                (t: AnalyzedTrack): boolean =>
                    t.providerId === msg.options.startProviderId
                    && t.path === msg.options.startPath,
            )
            : undefined;
        const result: DjSet = new DjSetPlanner(tracks).plan({
            start: start,
            energyDirection: msg.options.energyDirection,
            energyShape: msg.options.energyShape,
            strategy: msg.options.strategy,
            beamWidth: msg.options.beamWidth,
            tryAllStarts: msg.options.tryAllStarts,
            targetDurationSec: msg.options.targetDurationSec,
            style: msg.options.style,
            avoidSameArtist: msg.options.avoidSameArtist,
            onProgress: (info: { current: number; total: number; phase: string }): void => {
                const progress: PlanResponse = {
                    id: msg.id,
                    type: 'progress',
                    current: info.current,
                    total: info.total,
                    phase: info.phase,
                };
                port.postMessage(progress);
            },
        });
        const done: PlanResponse = { id: msg.id, type: 'done', result: result };
        port.postMessage(done);
    } catch (err) {
        const error: PlanResponse = {
            id: msg.id,
            type: 'error',
            message: err instanceof Error ? err.message : String(err),
        };
        port.postMessage(error);
    }
});