import type { DjSet } from '@headbangbear/schemas';

export type TrackChangeFn = (index: number, trackPath: string) => void;
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

        // Pre-load all audio elements before scheduling so we know they're ready to play
        // when their start timeouts fire. `canplaythrough` is the strongest readiness signal.
        const audios: HTMLAudioElement[] = await Promise.all(
            djSet.tracks.map((t): Promise<HTMLAudioElement> => this.fetchAudio(t.path))
        );

        let scheduleTime: number = this.ctx.currentTime + 0.5;
        let lastEndWall: number = scheduleTime;

        for (let i = 0; i < djSet.tracks.length; i++) {
            const audio: HTMLAudioElement = audios[i] as HTMLAudioElement;
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
            audio.currentTime = startOffsetSec;
            const startWall: number = scheduleTime;
            let endWall: number;

            // Fade in
            if (transitionIn !== undefined) {
                gain.gain.setValueAtTime(0, startWall);
                gain.gain.linearRampToValueAtTime(1, startWall + transitionIn.mixDurationSec);
            } else {
                gain.gain.setValueAtTime(1, startWall);
            }

            const playDelayMs: number = Math.max(0, (startWall - this.ctx.currentTime) * 1000);
            const playTimer: number = window.setTimeout((): void => {
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
                endWall = startWall + (audio.duration - startOffsetSec) / pitchRate;
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

            if (onTrackChange !== undefined) {
                const trackIndex: number = i;
                const path: string = djSet.tracks[i]?.path ?? '';
                const delayMs: number = Math.max(0, (startWall - this.ctx.currentTime) * 1000);
                const timerId: number = window.setTimeout((): void => {
                    onTrackChange(trackIndex, path);
                }, delayMs);
                this.timers.push(timerId);
            }
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

    private fetchAudio(trackPath: string): Promise<HTMLAudioElement> {
        const url: string = `api/v1/library/audio?path=${encodeURIComponent(trackPath)}`;
        return new Promise<HTMLAudioElement>((resolve, reject): void => {
            const audio: HTMLAudioElement = new Audio();
            audio.crossOrigin = 'anonymous';
            audio.preload = 'auto';
            // Hidden detached element. Some browsers historically refused to play unless
            // attached to the DOM; appending a hidden node is the safe path.
            audio.style.display = 'none';
            const onReady = (): void => {
                cleanup();
                resolve(audio);
            };
            const onError = (): void => {
                cleanup();
                reject(new Error(`Failed to load audio: ${url}`));
            };
            const cleanup = (): void => {
                audio.removeEventListener('canplaythrough', onReady);
                audio.removeEventListener('error', onError);
            };
            audio.addEventListener('canplaythrough', onReady, { once: true });
            audio.addEventListener('error', onError, { once: true });
            audio.src = url;
            document.body.appendChild(audio);
            audio.load();
        });
    }

}