import type { DjSet, TrackRef } from '@headbangbear/schemas';
import { DjSetApi } from '../Api/DjSetApi.js';

export type TrackChangeFn = (index: number, providerId: string, trackPath: string) => void;
export type FinishedFn = () => void;

export type TrackProgressFn = (index: number, trackTimeSec: number) => void;

export type EqBand = 'low' | 'mid' | 'high';
export type EqSide = 'A' | 'B';

export interface BandEqState {
    readonly lowDb: number;
    readonly midDb: number;
    readonly highDb: number;
}

export type MasterEqState = BandEqState;

export interface SideEqState {
    readonly A: BandEqState;
    readonly B: BandEqState;
}

const EQ_LOW_FREQ_HZ: number = 250;
const EQ_MID_FREQ_HZ: number = 1000;
const EQ_MID_Q: number = 0.7;
const EQ_HIGH_FREQ_HZ: number = 5000;
const EQ_GAIN_MIN_DB: number = -12;
const EQ_GAIN_MAX_DB: number = 12;

const ZERO_BAND_EQ: BandEqState = { lowDb: 0, midDb: 0, highDb: 0 };

/** Size of the rolling DJ-set prefetch window — `[current, current+1, current+2]`.
 *  Has to match the backend's appetite: bigger means more concurrent Jellyfin
 *  connections in flight, smaller means the next-track might not be hot when
 *  the crossfade arrives. 3 is a balanced default. */
const PREFETCH_WINDOW_SIZE: number = 3;

/** HTMLMediaElement.preservesPitch is the standard; some older Safaris exposed `webkitPreservesPitch`. */
type WithPreservesPitch = HTMLMediaElement & {
    preservesPitch?: boolean;
    webkitPreservesPitch?: boolean;
};

interface ScheduledTrack {
    readonly index: number;
    readonly side: EqSide;
    readonly startWall: number;
    readonly endWall: number;
    readonly startOffsetSec: number;
    readonly pitchRate: number;
    readonly audio: HTMLAudioElement;
    readonly mediaSrc: MediaElementAudioSourceNode;
    readonly gain: GainNode;
    readonly trackEqLow: BiquadFilterNode;
    readonly trackEqMid: BiquadFilterNode;
    readonly trackEqHigh: BiquadFilterNode;
}

/** Side A = even track indices (0, 2, 4, …); Side B = odd (1, 3, 5, …). Mirrors a 2-channel DJ mixer. */
function sideForIndex(index: number): EqSide {
    return index % 2 === 0 ? 'A' : 'B';
}

function setPreservesPitch(audio: HTMLAudioElement, preserve: boolean): void {
    const a: WithPreservesPitch = audio;
    if (a.preservesPitch !== undefined) {
        a.preservesPitch = preserve;
    }
    if (a.webkitPreservesPitch !== undefined) {
        a.webkitPreservesPitch = preserve;
    }
}

/**
 * Plays a `DjSet` end-to-end through the Web Audio API with crossfades and per-track pitch
 * shift derived from each transition's `pitchPercent`.
 *
 * Source nodes are `MediaElementAudioSourceNode`s wrapping `<audio>` elements rather than
 * `AudioBufferSourceNode`s — this lets us flip `audio.preservesPitch` on the fly for
 * **pitch-lock / master-tempo** mode (BPM matching without altering the musical key).
 * Without pitch-lock the AutoPlayer behaves like a turntable (pitch + tempo coupled);
 * with it, playback uses the browser's native time-stretch.
 *
 * Trade-off vs. the previous AudioBuffer-based scheduler: scheduling is ms-accurate
 * (`setTimeout`) instead of sample-accurate. For DJ-set crossfades over seconds, this is
 * imperceptible.
 *
 * Optional `onTrackProgress` callback fires on every animation frame while a track is
 * audible, with the *track-local* time (`audio.currentTime`).
 */
export class AutoPlayer {

    private readonly ctx: AudioContext;

    private readonly master: GainNode;

    private readonly eqLow: BiquadFilterNode;

    private readonly eqMid: BiquadFilterNode;

    private readonly eqHigh: BiquadFilterNode;

    private scheduled: ScheduledTrack[] = [];

    private timers: number[] = [];

    private rafId: number | null = null;

    private streamDest: MediaStreamAudioDestinationNode | null = null;

    private mediaRecorder: MediaRecorder | null = null;

    private recordedChunks: Blob[] = [];

    private recordingMimeType: string = 'audio/webm';

    private pitchLocked: boolean = false;

    private sideEq: { A: BandEqState; B: BandEqState } = {
        A: { ...ZERO_BAND_EQ },
        B: { ...ZERO_BAND_EQ }
    };

    public constructor(
        initialMasterVolume: number = 1.0,
        initialEq?: MasterEqState,
        initialSideEq?: SideEqState,
        initialPitchLocked: boolean = false,
    ) {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = AutoPlayer.clampVolume(initialMasterVolume);

        // Master EQ chain: master gain → lowshelf → peaking (mid) → highshelf → destination.
        // All three filters default to 0 dB unless `initialEq` overrides — so a player that
        // never touches the EQ behaves identically to one without filters.
        this.eqLow = this.ctx.createBiquadFilter();
        this.eqLow.type = 'lowshelf';
        this.eqLow.frequency.value = EQ_LOW_FREQ_HZ;

        this.eqMid = this.ctx.createBiquadFilter();
        this.eqMid.type = 'peaking';
        this.eqMid.frequency.value = EQ_MID_FREQ_HZ;
        this.eqMid.Q.value = EQ_MID_Q;

        this.eqHigh = this.ctx.createBiquadFilter();
        this.eqHigh.type = 'highshelf';
        this.eqHigh.frequency.value = EQ_HIGH_FREQ_HZ;

        if (initialEq !== undefined) {
            this.eqLow.gain.value = AutoPlayer.clampDb(initialEq.lowDb);
            this.eqMid.gain.value = AutoPlayer.clampDb(initialEq.midDb);
            this.eqHigh.gain.value = AutoPlayer.clampDb(initialEq.highDb);
        }

        if (initialSideEq !== undefined) {
            this.sideEq = {
                A: AutoPlayer.clampBandEq(initialSideEq.A),
                B: AutoPlayer.clampBandEq(initialSideEq.B)
            };
        }

        this.pitchLocked = initialPitchLocked;

        this.master
            .connect(this.eqLow)
            .connect(this.eqMid)
            .connect(this.eqHigh)
            .connect(this.ctx.destination);
    }

    /** Set the master output volume (0..1). Applied immediately. */
    public setMasterVolume(volume: number): void {
        this.master.gain.value = AutoPlayer.clampVolume(volume);
    }

    public getMasterVolume(): number {
        return this.master.gain.value;
    }

    /** Live-adjust one band of the master EQ. Range −12 dB to +12 dB. */
    public setEqGainDb(band: EqBand, db: number): void {
        const clamped: number = AutoPlayer.clampDb(db);
        switch (band) {
            case 'low':
                this.eqLow.gain.value = clamped;
                break;
            case 'mid':
                this.eqMid.gain.value = clamped;
                break;
            case 'high':
                this.eqHigh.gain.value = clamped;
                break;
        }
    }

    public resetEq(): void {
        this.eqLow.gain.value = 0;
        this.eqMid.gain.value = 0;
        this.eqHigh.gain.value = 0;
    }

    public getEqState(): MasterEqState {
        return {
            lowDb: this.eqLow.gain.value,
            midDb: this.eqMid.gain.value,
            highDb: this.eqHigh.gain.value
        };
    }

    /**
     * Live-adjust one band of the per-side EQ. Affects every currently-scheduled track
     * on the requested side (so changes take effect mid-playback) and is remembered for
     * future tracks on that side. This is the DJ-classic move — cut the bass on the
     * outgoing side during a crossfade, bring it in on the incoming side.
     */
    public setSideEqGainDb(side: EqSide, band: EqBand, db: number): void {
        const clamped: number = AutoPlayer.clampDb(db);
        const current: BandEqState = this.sideEq[side];
        this.sideEq[side] = {
            lowDb: band === 'low' ? clamped : current.lowDb,
            midDb: band === 'mid' ? clamped : current.midDb,
            highDb: band === 'high' ? clamped : current.highDb
        };
        for (const t of this.scheduled) {
            if (t.side !== side) {
                continue;
            }
            const node: BiquadFilterNode =
                band === 'low'
                    ? t.trackEqLow
                    : band === 'mid'
                        ? t.trackEqMid
                        : t.trackEqHigh;
            node.gain.value = clamped;
        }
    }

    public resetSideEq(side: EqSide): void {
        this.setSideEqGainDb(side, 'low', 0);
        this.setSideEqGainDb(side, 'mid', 0);
        this.setSideEqGainDb(side, 'high', 0);
    }

    public getSideEqState(): SideEqState {
        return { A: this.sideEq.A, B: this.sideEq.B };
    }

    /**
     * Toggle pitch-lock (a.k.a. master-tempo, key-lock) for the master output. When `true`,
     * the browser preserves musical pitch across the per-track `playbackRate` adjustments
     * so BPM matching no longer re-pitches the keys — the natural DJ-mixing setting. When
     * `false`, pitch and tempo move together (turntable mode). Affects all currently-loaded
     * audio elements *and* future ones for the duration of this player.
     */
    public setPitchLocked(locked: boolean): void {
        this.pitchLocked = locked;
        for (const t of this.scheduled) {
            setPreservesPitch(t.audio, locked);
        }
    }

    public isPitchLocked(): boolean {
        return this.pitchLocked;
    }

    private static clampBandEq(s: BandEqState): BandEqState {
        return {
            lowDb: AutoPlayer.clampDb(s.lowDb),
            midDb: AutoPlayer.clampDb(s.midDb),
            highDb: AutoPlayer.clampDb(s.highDb)
        };
    }

    /**
     * Arms recording for the next `play()` call. Must be invoked **before** play() because
     * the underlying `MediaStreamAudioDestinationNode` is wired into the master chain only
     * once and the `MediaRecorder` starts on `play()`.
     */
    public startRecording(): void {
        if (this.mediaRecorder !== null) {
            return;
        }
        this.recordedChunks = [];
        this.recordingMimeType = AutoPlayer.pickRecordingMimeType();
        this.streamDest = this.ctx.createMediaStreamDestination();
        // Tap the master chain after the EQ — same signal that reaches `ctx.destination`.
        this.eqHigh.connect(this.streamDest);
        const recorder: MediaRecorder = new MediaRecorder(this.streamDest.stream, {
            mimeType: this.recordingMimeType
        });
        recorder.ondataavailable = (e: BlobEvent): void => {
            if (e.data.size > 0) {
                this.recordedChunks.push(e.data);
            }
        };
        this.mediaRecorder = recorder;
        recorder.start();
    }

    /**
     * Stops the in-flight recording and resolves with the assembled blob (or `null` if
     * recording was never armed).
     */
    public async stopRecording(): Promise<Blob | null> {
        const recorder: MediaRecorder | null = this.mediaRecorder;
        if (recorder === null) {
            return null;
        }
        const mimeType: string = this.recordingMimeType;
        const finished: Promise<Blob> = new Promise<Blob>((resolve): void => {
            recorder.onstop = (): void => {
                resolve(new Blob(this.recordedChunks, { type: mimeType }));
            };
        });
        if (recorder.state !== 'inactive') {
            recorder.stop();
        }
        const blob: Blob = await finished;
        if (this.streamDest !== null) {
            try {
                this.eqHigh.disconnect(this.streamDest);
            } catch {
                // already disconnected
            }
            this.streamDest = null;
        }
        this.mediaRecorder = null;
        this.recordedChunks = [];
        return blob;
    }

    public isRecording(): boolean {
        return this.mediaRecorder !== null && this.mediaRecorder.state === 'recording';
    }

    public getRecordingMimeType(): string {
        return this.recordingMimeType;
    }

    private static pickRecordingMimeType(): string {
        const candidates: readonly string[] = [
            'audio/webm;codecs=opus',
            'audio/webm',
            'audio/ogg;codecs=opus',
            'audio/mp4'
        ];
        for (const c of candidates) {
            if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c)) {
                return c;
            }
        }
        return 'audio/webm';
    }

    /** Slice of `[fromIndex, fromIndex+PREFETCH_WINDOW_SIZE)` mapped down to
     *  `TrackRef`s for the prefetch endpoint. Returns up to N entries — fewer
     *  near the end of the chain. */
    private static windowFrom(djSet: DjSet, fromIndex: number): TrackRef[] {
        const out: TrackRef[] = [];
        const end: number = Math.min(fromIndex + PREFETCH_WINDOW_SIZE, djSet.tracks.length);
        for (let i = fromIndex; i < end; i++) {
            const t = djSet.tracks[i];
            if (t === undefined) {
                continue;
            }
            out.push({ providerId: t.providerId, path: t.path });
        }
        return out;
    }

    private static clampVolume(v: number): number {
        if (!Number.isFinite(v)) {
            return 1.0;
        }
        return Math.max(0, Math.min(1, v));
    }

    private static clampDb(db: number): number {
        if (!Number.isFinite(db)) {
            return 0;
        }
        return Math.max(EQ_GAIN_MIN_DB, Math.min(EQ_GAIN_MAX_DB, db));
    }

    public async play(
        djSet: DjSet,
        onTrackChange?: TrackChangeFn,
        onFinished?: FinishedFn,
        onTrackProgress?: TrackProgressFn
    ): Promise<void> {
        if (this.ctx.state === 'suspended') {
            await this.ctx.resume();
        }
        if (djSet.tracks.length === 0) {
            return;
        }

        // Tell the backend to pre-warm the audio cache for the first 3 tracks. We
        // await this so the first audio.load() below hits a hot cache rather than
        // racing against the Jellyfin proxy. Best-effort: a backend that doesn't
        // have the endpoint (older builds) just yields a 404, which we swallow.
        try {
            await DjSetApi.prefetch({ window: AutoPlayer.windowFrom(djSet, 0) });
        } catch (err) {
            console.warn('AutoPlayer: initial prefetch failed (continuing):', err);
        }

        // Create the `<audio>` shells + audio graph for ALL tracks upfront, but DO
        // NOT set `src` yet. Eagerly setting all `src` would fire one HTTP request
        // per track in parallel; with N=200 tracks the browser queues 194 (only 6
        // concurrent connections allowed) and the backend buckles under the 6
        // simultaneous Jellyfin proxies + scanner. Lazy-load (audio.src set just
        // before play, see PRELOAD_LEAD_MS) spaces the load over the chain's
        // play-time so backend pressure is constant rather than burst.
        const audios: HTMLAudioElement[] = djSet.tracks.map((): HTMLAudioElement => {
            const a: HTMLAudioElement = new Audio();
            a.crossOrigin = 'anonymous';
            a.preload = 'auto';
            a.style.display = 'none';
            document.body.appendChild(a);
            return a;
        });
        // Track 0 is loaded synchronously and we await `canplay` — by the time
        // play() returns, the first track is genuinely ready. Subsequent tracks
        // load just-in-time via the per-track schedule below.
        const firstAudio: HTMLAudioElement = audios[0] as HTMLAudioElement;
        const firstTrack = djSet.tracks[0];
        if (firstTrack !== undefined) {
            firstAudio.src = AutoPlayer.audioUrl(firstTrack.providerId, firstTrack.path);
            firstAudio.load();
            await AutoPlayer.awaitCanPlay(firstAudio);
        }

        let scheduleTime: number = this.ctx.currentTime + 0.5;
        let lastEndWall: number = scheduleTime;

        for (let i = 0; i < djSet.tracks.length; i++) {
            const audio: HTMLAudioElement = audios[i] as HTMLAudioElement;
            const track = djSet.tracks[i];
            if (track === undefined) {
                continue;
            }
            const transitionIn = i > 0 ? djSet.transitions[i - 1] : undefined;
            const transitionOut = i < djSet.transitions.length ? djSet.transitions[i] : undefined;

            const mediaSrc: MediaElementAudioSourceNode = this.ctx.createMediaElementSource(audio);
            const gain: GainNode = this.ctx.createGain();

            // Per-source EQ chain — each scheduled track gets its own LO/MID/HI BiquadFilters,
            // initialised from the current `sideEq` state for its side. Live changes are
            // propagated to these nodes by `setSideEqGainDb`.
            const side: EqSide = sideForIndex(i);
            const sideState: BandEqState = this.sideEq[side];
            const trackEqLow: BiquadFilterNode = this.ctx.createBiquadFilter();
            trackEqLow.type = 'lowshelf';
            trackEqLow.frequency.value = EQ_LOW_FREQ_HZ;
            trackEqLow.gain.value = sideState.lowDb;
            const trackEqMid: BiquadFilterNode = this.ctx.createBiquadFilter();
            trackEqMid.type = 'peaking';
            trackEqMid.frequency.value = EQ_MID_FREQ_HZ;
            trackEqMid.Q.value = EQ_MID_Q;
            trackEqMid.gain.value = sideState.midDb;
            const trackEqHigh: BiquadFilterNode = this.ctx.createBiquadFilter();
            trackEqHigh.type = 'highshelf';
            trackEqHigh.frequency.value = EQ_HIGH_FREQ_HZ;
            trackEqHigh.gain.value = sideState.highDb;

            mediaSrc
                .connect(gain)
                .connect(trackEqLow)
                .connect(trackEqMid)
                .connect(trackEqHigh)
                .connect(this.master);

            const pitchRate: number =
                transitionIn !== undefined ? 1 + transitionIn.to.pitchPercent / 100 : 1.0;
            audio.playbackRate = pitchRate;
            setPreservesPitch(audio, this.pitchLocked);

            const startOffsetSec: number =
                transitionIn !== undefined ? transitionIn.cueInSec : 0;
            const startWall: number = scheduleTime;
            let endWall: number;

            // Fade in
            if (transitionIn !== undefined) {
                gain.gain.setValueAtTime(0, startWall);
                gain.gain.linearRampToValueAtTime(1, startWall + transitionIn.mixDurationSec);
            } else {
                gain.gain.setValueAtTime(1, startWall);
            }

            // Lazy load: track 0 is already loaded above; tracks 1..N get a load
            // timer that fires `audio.src = url; audio.load()` PRELOAD_LEAD_MS
            // before their scheduled play. The backend's rolling 3-window
            // prefetch keeps the cache warm a few tracks ahead, so by the time
            // the load fires the bytes are usually local (sendFile, fast).
            if (i > 0) {
                const url: string = AutoPlayer.audioUrl(track.providerId, track.path);
                const PRELOAD_LEAD_MS: number = 30_000;
                const loadDelayMs: number = Math.max(
                    0,
                    (startWall - this.ctx.currentTime) * 1000 - PRELOAD_LEAD_MS,
                );
                const loadTimer: number = window.setTimeout((): void => {
                    audio.src = url;
                    audio.load();
                }, loadDelayMs);
                this.timers.push(loadTimer);
            }

            const playDelayMs: number = Math.max(0, (startWall - this.ctx.currentTime) * 1000);
            const playTimer: number = window.setTimeout((): void => {
                // currentTime can only be set after metadata is loaded — we do
                // it here so it sticks even if the load() fired late. If the
                // browser hasn't loaded metadata yet, this throws; swallow and
                // let play() drive (it will queue the seek).
                try {
                    audio.currentTime = startOffsetSec;
                } catch {
                    // metadata not ready; play() will buffer and start at 0 briefly
                }
                void audio.play().catch((err: unknown): void => {
                    console.warn('AutoPlayer: audio.play() rejected', err);
                });
            }, playDelayMs);
            this.timers.push(playTimer);

            if (transitionOut !== undefined) {
                const fadeOutStartWall: number =
                    startWall + (transitionOut.cueOutSec - startOffsetSec) / pitchRate;
                const fadeOutEndWall: number = fadeOutStartWall + transitionOut.mixDurationSec;
                gain.gain.setValueAtTime(1, fadeOutStartWall);
                gain.gain.linearRampToValueAtTime(0, fadeOutEndWall);

                const stopDelayMs: number = Math.max(
                    0,
                    (fadeOutEndWall - this.ctx.currentTime) * 1000
                );
                const stopTimer: number = window.setTimeout((): void => {
                    audio.pause();
                }, stopDelayMs);
                this.timers.push(stopTimer);

                scheduleTime = fadeOutStartWall;
                endWall = fadeOutEndWall;
            } else {
                // Last track: use the analysed `track.durationSec` instead of
                // `audio.duration` because the latter requires loadedmetadata,
                // which hasn't fired yet for lazy-loaded tracks.
                endWall = startWall + (track.durationSec - startOffsetSec) / pitchRate;
            }
            lastEndWall = Math.max(lastEndWall, endWall);

            this.scheduled.push({
                index: i,
                side: side,
                startWall: startWall,
                endWall: endWall,
                startOffsetSec: startOffsetSec,
                pitchRate: pitchRate,
                audio: audio,
                mediaSrc: mediaSrc,
                gain: gain,
                trackEqLow: trackEqLow,
                trackEqMid: trackEqMid,
                trackEqHigh: trackEqHigh
            });

            // Schedule the track-change callback AND a sliding prefetch update
            // for the same wall-clock instant. The window-update is fire-and-
            // forget — by the time the user actually needs track[i+1] / [i+2],
            // either the backend has them ready (cache hit) or it's still
            // proxying from Jellyfin (cache miss). Both work; the prefetch is
            // an optimisation, not a barrier.
            const trackIndex: number = i;
            const path: string = djSet.tracks[i]?.path ?? '';
            const providerId: string = djSet.tracks[i]?.providerId ?? '';
            const delayMs: number = Math.max(0, (startWall - this.ctx.currentTime) * 1000);
            const timerId: number = window.setTimeout((): void => {
                if (onTrackChange !== undefined) {
                    onTrackChange(trackIndex, providerId, path);
                }
                void DjSetApi.prefetch({
                    window: AutoPlayer.windowFrom(djSet, trackIndex),
                }).catch((err: unknown): void => {
                    console.warn('AutoPlayer: sliding prefetch failed:', err);
                });
            }, delayMs);
            this.timers.push(timerId);
        }

        if (onFinished !== undefined) {
            const delayMs: number = Math.max(0, (lastEndWall - this.ctx.currentTime) * 1000);
            const timerId: number = window.setTimeout((): void => {
                if (onTrackProgress !== undefined) {
                    this.stopProgressLoop();
                }
                onFinished();
            }, delayMs);
            this.timers.push(timerId);
        }

        if (onTrackProgress !== undefined) {
            this.startProgressLoop(onTrackProgress, lastEndWall);
        }
    }

    public stop(): void {
        this.stopProgressLoop();
        for (const timerId of this.timers) {
            window.clearTimeout(timerId);
        }
        this.timers = [];
        // Release the prefetch window so the backend evicts the last few cached
        // tracks. Fire-and-forget — `stop()` is sync and the cache delete is
        // best-effort cleanup, not on the user's critical path.
        void DjSetApi.prefetch({ window: [] }).catch((): void => {
            // already-disconnected backend; nothing to do
        });
        for (const t of this.scheduled) {
            try {
                t.audio.pause();
            } catch {
                // already paused
            }
            // Detach the audio element from the DOM and release its source so the browser
            // can free the underlying decoder. `mediaSrc.disconnect()` is enough for the
            // graph; the audio element itself is GC'd once we drop our reference.
            try {
                t.mediaSrc.disconnect();
            } catch {
                // already disconnected
            }
            t.audio.removeAttribute('src');
            t.audio.load();
            t.audio.remove();
        }
        this.scheduled = [];
    }

    public async dispose(): Promise<void> {
        this.stop();
        await this.ctx.close();
    }

    private startProgressLoop(onTrackProgress: TrackProgressFn, lastEndWall: number): void {
        const tick = (): void => {
            const now: number = this.ctx.currentTime;
            if (now >= lastEndWall) {
                this.rafId = null;
                return;
            }
            for (const s of this.scheduled) {
                if (now < s.startWall || now >= s.endWall) {
                    continue;
                }
                // `audio.currentTime` is the source of truth — `preservesPitch` doesn't
                // change how fast the playhead advances, only how the audio sounds. The
                // wall-time formula would also work but reading the element directly is
                // immune to setTimeout drift if we schedule far in the future.
                onTrackProgress(s.index, s.audio.currentTime);
            }
            this.rafId = window.requestAnimationFrame(tick);
        };
        this.rafId = window.requestAnimationFrame(tick);
    }

    private stopProgressLoop(): void {
        if (this.rafId !== null) {
            window.cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
    }

    /** Backend audio URL for a `(providerId, path)` pair. Centralised so URL
     *  encoding is consistent everywhere. */
    private static audioUrl(providerId: string, trackPath: string): string {
        return `api/v1/library/audio?providerId=${encodeURIComponent(providerId)}`
            + `&path=${encodeURIComponent(trackPath)}`;
    }

    /** Resolve when the browser can start playing the audio (`canplay` /
     *  `loadeddata` event), or after a 30 s safety timeout. Always resolves —
     *  play() decides what to do on a non-ready element. Used for the very
     *  first track where we genuinely need the metadata before scheduling. */
    private static awaitCanPlay(audio: HTMLAudioElement): Promise<void> {
        return new Promise<void>((resolve): void => {
            const SAFETY_TIMEOUT_MS: number = 30_000;
            let timeoutId: number | null = null;
            const cleanup = (): void => {
                audio.removeEventListener('canplay', onReady);
                audio.removeEventListener('loadeddata', onReady);
                audio.removeEventListener('error', onError);
                if (timeoutId !== null) {
                    window.clearTimeout(timeoutId);
                    timeoutId = null;
                }
            };
            const onReady = (): void => {
                cleanup();
                resolve();
            };
            const onError = (): void => {
                cleanup();
                resolve();
            };
            audio.addEventListener('canplay', onReady, { once: true });
            audio.addEventListener('loadeddata', onReady, { once: true });
            audio.addEventListener('error', onError, { once: true });
            timeoutId = window.setTimeout((): void => {
                console.warn(
                    `AutoPlayer: first track not ready after ${(SAFETY_TIMEOUT_MS / 1000).toString()}s — proceeding anyway`,
                );
                cleanup();
                resolve();
            }, SAFETY_TIMEOUT_MS);
        });
    }

}