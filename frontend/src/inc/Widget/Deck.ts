import WaveSurfer from 'wavesurfer.js';
import HoverPlugin from 'wavesurfer.js/dist/plugins/hover.js';
import RegionsPlugin, { type Region } from 'wavesurfer.js/dist/plugins/regions.js';
import SpectrogramPlugin from 'wavesurfer.js/dist/plugins/spectrogram.js';
import TimelinePlugin from 'wavesurfer.js/dist/plugins/timeline.js';
import type { RouteTrack } from '@headbangbear/schemas';
import { HOTCUE_SLOT_COUNT, HotCueStore } from '../Util/HotCueStore.js';
import { TrackDisplayUtil } from '../Util/TrackDisplayUtil.js';

export type DeckLabel = 'A' | 'B' | 'NP';

export interface DeckOptions {
    /** Hide the per-deck Play/Pause button (used for the DJ-Set Now-Playing deck which is driven by `AutoPlayer`). Default `false`. */
    readonly hidePlayButton?: boolean;
    /** Hide the spectrogram checkbox. Default `false`. */
    readonly hideSpectrogramToggle?: boolean;
    /** Hide the 3-band EQ row (LO/MID/HI sliders). Default `false`. The Now-Playing deck uses
     *  this — its wavesurfer is silent (AutoPlayer drives the audio), so per-deck EQ would do nothing. */
    readonly hideEq?: boolean;
    /** Hide the hot-cue row (8 numbered buttons). Default `false`. The Now-Playing deck uses
     *  this — its wavesurfer is silent (AutoPlayer drives the audio), so cue jumps would do nothing. */
    readonly hideHotCues?: boolean;
     /** Hide the loop row (In / Out / Clear + Active toggle). Default `false`. */
    readonly hideLoop?: boolean;
    /** Hide the cover-art thumbnail in the card header. Default `false`. The DJ-Set
     *  Now-Playing deck uses this — it has its own dedicated `nowPlayingCard` above the
     *  deck, so duplicating the cover inside the deck header would just take up space. */
    readonly hideCover?: boolean;
}

const EQ_LOW_FREQ_HZ: number = 250;
const EQ_MID_FREQ_HZ: number = 1000;
const EQ_MID_Q: number = 0.7;
const EQ_HIGH_FREQ_HZ: number = 5000;
const EQ_GAIN_MIN_DB: number = -12;
const EQ_GAIN_MAX_DB: number = 12;

const WAVE_COLOR_BY_DECK: Readonly<Record<DeckLabel, string>> = {
    A: '#17a2b8',
    B: '#28a745',
    NP: '#6f42c1'
};

const HEADER_BADGE_BY_DECK: Readonly<Record<DeckLabel, string>> = {
    A: 'badge badge-info',
    B: 'badge badge-success',
    NP: 'badge badge-purple'
};

const HEADER_LABEL_BY_DECK: Readonly<Record<DeckLabel, string>> = {
    A: 'Deck A',
    B: 'Deck B',
    NP: 'Now Playing'
};

const HEADER_OUTLINE_BY_DECK: Readonly<Record<DeckLabel, string>> = {
    A: 'card-info',
    B: 'card-success',
    NP: 'card-secondary'
};

const DROP_MARKER_COLOR: string = 'rgba(255, 0, 0, 0.85)';
const DROP_REGION_WIDTH_SEC: number = 0.08;
const CUE_REGION_COLOR: string = 'rgba(220, 53, 69, 0.35)';
const ENERGY_LINE_COLOR: string = 'rgba(255, 193, 7, 0.85)';
const BEAT_LINE_COLOR: string = 'rgba(108, 117, 125, 0.18)';
const BAR_LINE_COLOR: string = 'rgba(108, 117, 125, 0.45)';
const HOTCUE_REGION_COLOR: string = 'rgba(23, 162, 184, 0.85)';
const HOTCUE_REGION_WIDTH_SEC: number = 0.08;
const LOOP_REGION_COLOR: string = 'rgba(255, 193, 7, 0.22)';
const BEATS_PER_BAR: number = 4;

/**
 * One DJ deck — info panel (filename, Camelot/Open Key/BPM/Energy/Drops/Duration badges)
 * plus a `wavesurfer.js` waveform that streams the audio from `/api/v1/library/audio`.
 *
 *  - **Drop markers**: red 0.08s vertical bars with `▼ Ns` content labels.
 *  - **Cue overlays**: red translucent regions painted by `setCue()` for mix-plan visualisation.
 *  - **Hover plugin**: tooltip with the time at the mouse position.
 *  - **Timeline plugin**: seconds ticks below the waveform.
 *  - **Energy curve overlay**: read-only orange polyline above the waveform, painted from
 *    `track.energyTimeline` so the DJ sees where the track is loud / quiet without the
 *    overlay actually affecting playback (unlike wavesurfer's `Envelope` plugin which is
 *    a volume controller).
 *  - **Spectrogram toggle**: a checkbox lazily registers / unregisters the heavy
 *    `Spectrogram` plugin so the DJ can flip between the friendly waveform view and the
 *    frequency-domain view on demand.
 */
export class Deck {

    private readonly label: DeckLabel;

    private readonly options: DeckOptions;

    private readonly $card: JQuery<HTMLDivElement>;

    private readonly $title: JQuery<HTMLDivElement>;

    private readonly $artist: JQuery<HTMLDivElement>;

    private readonly $cover: JQuery<HTMLDivElement>;

    private readonly $badges: JQuery<HTMLDivElement>;

    private readonly $waveform: JQuery<HTMLDivElement>;

    private readonly $energyCanvas: JQuery<HTMLCanvasElement>;

    private readonly $timeline: JQuery<HTMLDivElement>;

    private readonly $spectrogram: JQuery<HTMLDivElement>;

    private readonly $playBtn: JQuery<HTMLButtonElement>;

    private readonly $spectrogramToggle: JQuery<HTMLInputElement> | null;

    private readonly $eqRow: JQuery<HTMLDivElement> | null;

    private readonly $eqLow: JQuery<HTMLInputElement> | null;

    private readonly $eqMid: JQuery<HTMLInputElement> | null;

    private readonly $eqHigh: JQuery<HTMLInputElement> | null;

    private readonly $hotcueRow: JQuery<HTMLDivElement> | null;

    private readonly $loopRow: JQuery<HTMLDivElement> | null;

    private deckPlaybackRate: number = 1.0;

    private pitchLocked: boolean = false;

    private loopIn: number | null = null;

    private loopOut: number | null = null;

    private loopActive: boolean = false;

    private wavesurfer: WaveSurfer | null = null;

    private regions: RegionsPlugin | null = null;

    private spectrogramPlugin: SpectrogramPlugin | null = null;

    private currentTrack: RouteTrack | null = null;

    private audioCtx: AudioContext | null = null;

    private eqSource: MediaElementAudioSourceNode | null = null;

    private eqLowNode: BiquadFilterNode | null = null;

    private eqMidNode: BiquadFilterNode | null = null;

    private eqHighNode: BiquadFilterNode | null = null;

    public constructor(parent: JQuery<HTMLElement>, label: DeckLabel, options: DeckOptions = {}) {
        this.label = label;
        this.options = options;
        const playBtnDisplay: string = options.hidePlayButton === true ? 'none' : 'inline-block';
        const spectroToggleDisplay: string =
            options.hideSpectrogramToggle === true ? 'none' : 'inline-block';
        const eqRowDisplay: string = options.hideEq === true ? 'none' : 'flex';
        const hotcueRowDisplay: string = options.hideHotCues === true ? 'none' : 'flex';
        const hotcueButtons: string = Array.from(
            { length: HOTCUE_SLOT_COUNT },
            (_, i): string =>
                `<button type="button" class="btn btn-xs btn-default hbb-hotcue-btn" data-slot="${i.toString()}" title="Cue ${(i + 1).toString()}">${(i + 1).toString()}</button>`
        ).join('');
        const loopRowDisplay: string = options.hideLoop === true ? 'none' : 'flex';

        const coverDisplay: string = options.hideCover === true ? 'none' : 'block';
        this.$card = jQuery<HTMLDivElement>(`
            <div class="card ${HEADER_OUTLINE_BY_DECK[label]} card-outline">
                <div class="card-header d-flex align-items-center" style="gap:0.75rem;">
                    <div class="hbb-deck-cover" style="display:${coverDisplay}; flex:0 0 auto;"></div>
                    <div style="flex:1 1 auto; min-width:0;">
                        <h3 class="card-title m-0 d-flex align-items-center" style="gap:0.5rem;">
                            <span class="${HEADER_BADGE_BY_DECK[label]}">${HEADER_LABEL_BY_DECK[label]}</span>
                            <span class="hbb-deck-title text-truncate" style="font-weight:600;">No track loaded</span>
                        </h3>
                        <small class="hbb-deck-artist text-muted text-truncate d-block"></small>
                    </div>
                </div>
                <div class="card-body">
                    <div class="hbb-deck-badges mb-2"></div>
                    <div class="hbb-deck-waveform-container" style="position:relative;">
                        <div class="hbb-deck-waveform" style="background:#f4f6f9; border:1px solid #dee2e6; border-radius:4px 4px 0 0; min-height:96px; position:relative; z-index:1;"></div>
                        <canvas class="hbb-deck-energy" style="position:absolute; left:0; top:0; width:100%; height:96px; pointer-events:none; z-index:2;"></canvas>
                    </div>
                    <div class="hbb-deck-timeline" style="background:#f4f6f9; border:1px solid #dee2e6; border-top:0; border-radius:0 0 4px 4px; min-height:24px;"></div>
                    <div class="hbb-deck-spectrogram" style="display:none; background:#1a1a1a; border:1px solid #dee2e6; border-top:0; min-height:120px;"></div>
                    <div class="mt-2 d-flex align-items-center">
                        <button type="button" class="btn btn-sm btn-default hbb-deck-play" disabled style="display:${playBtnDisplay};">
                            <i class="fas fa-play"></i> Play
                        </button>
                        <label class="ml-3 mb-0 small" style="display:${spectroToggleDisplay};">
                            <input type="checkbox" class="hbb-deck-spectrogram-toggle"> Spectrogram
                        </label>
                    </div>
                    <div class="hbb-deck-eq mt-2 align-items-center small" style="display:${eqRowDisplay}; gap:0.75rem;">
                        <span class="d-inline-flex align-items-center">
                            <strong class="mr-1" style="width:1.8rem;">LO</strong>
                            <input type="range" class="hbb-deck-eq-low" min="${EQ_GAIN_MIN_DB.toString()}" max="${EQ_GAIN_MAX_DB.toString()}" step="0.5" value="0" style="width:100px;">
                            <span class="hbb-deck-eq-low-val ml-1 text-muted" style="width:2.5rem;">0 dB</span>
                        </span>
                        <span class="d-inline-flex align-items-center">
                            <strong class="mr-1" style="width:2.2rem;">MID</strong>
                            <input type="range" class="hbb-deck-eq-mid" min="${EQ_GAIN_MIN_DB.toString()}" max="${EQ_GAIN_MAX_DB.toString()}" step="0.5" value="0" style="width:100px;">
                            <span class="hbb-deck-eq-mid-val ml-1 text-muted" style="width:2.5rem;">0 dB</span>
                        </span>
                        <span class="d-inline-flex align-items-center">
                            <strong class="mr-1" style="width:1.8rem;">HI</strong>
                            <input type="range" class="hbb-deck-eq-high" min="${EQ_GAIN_MIN_DB.toString()}" max="${EQ_GAIN_MAX_DB.toString()}" step="0.5" value="0" style="width:100px;">
                            <span class="hbb-deck-eq-high-val ml-1 text-muted" style="width:2.5rem;">0 dB</span>
                        </span>
                        <button type="button" class="btn btn-xs btn-default hbb-deck-eq-reset">Reset</button>
                    </div>
                    <div class="hbb-deck-hotcues mt-2 align-items-center small" style="display:${hotcueRowDisplay}; gap:0.25rem;">
                        <strong class="text-muted mr-2" style="min-width:2.5rem;">CUE</strong>
                        ${hotcueButtons}
                        <small class="text-muted ml-2">click empty = set at current time · click filled = jump · shift+click = clear</small>
                    </div>
                    <div class="hbb-deck-loop mt-2 align-items-center small" style="display:${loopRowDisplay}; gap:0.5rem;">
                        <strong class="text-muted mr-1" style="min-width:2.5rem;">LOOP</strong>
                        <button type="button" class="btn btn-xs btn-default hbb-loop-in">Set In</button>
                        <button type="button" class="btn btn-xs btn-default hbb-loop-out">Set Out</button>
                        <button type="button" class="btn btn-xs btn-default hbb-loop-clear">Clear</button>
                        <label class="mb-0 ml-2">
                            <input type="checkbox" class="hbb-loop-active"> active
                        </label>
                        <span class="hbb-loop-status text-muted ml-2"></span>
                    </div>
                    <div class="hbb-deck-pitch mt-2 d-flex align-items-center small" style="gap:0.5rem;">
                        <strong class="text-muted mr-1" style="min-width:2.5rem;">TEMPO</strong>
                        <input type="range" class="hbb-deck-tempo" min="0.7" max="1.3" step="0.005" value="1" style="width:140px;">
                        <span class="hbb-deck-tempo-val text-muted" style="width:3rem;">1.000×</span>
                        <button type="button" class="btn btn-xs btn-default hbb-deck-tempo-reset">Reset</button>
                        <label class="mb-0 ml-2" title="Preserve pitch when changing tempo (browser-side time-stretch).">
                            <input type="checkbox" class="hbb-deck-pitch-lock"> Pitch lock
                        </label>
                    </div>
                </div>
            </div>
        `);
        parent.append(this.$card);
        this.$title = this.$card.find('.hbb-deck-title');
        this.$artist = this.$card.find<HTMLDivElement>('.hbb-deck-artist');
        this.$cover = this.$card.find<HTMLDivElement>('.hbb-deck-cover');
        this.$badges = this.$card.find<HTMLDivElement>('.hbb-deck-badges');
        this.renderCover(null);
        this.$waveform = this.$card.find<HTMLDivElement>('.hbb-deck-waveform');
        this.$energyCanvas = this.$card.find<HTMLCanvasElement>('.hbb-deck-energy');
        this.$timeline = this.$card.find<HTMLDivElement>('.hbb-deck-timeline');
        this.$spectrogram = this.$card.find<HTMLDivElement>('.hbb-deck-spectrogram');
        this.$playBtn = this.$card.find<HTMLButtonElement>('.hbb-deck-play');
        this.$spectrogramToggle = options.hideSpectrogramToggle === true
            ? null
            : this.$card.find<HTMLInputElement>('.hbb-deck-spectrogram-toggle');

        if (options.hideEq === true) {
            this.$eqRow = null;
            this.$eqLow = null;
            this.$eqMid = null;
            this.$eqHigh = null;
        } else {
            this.$eqRow = this.$card.find<HTMLDivElement>('.hbb-deck-eq');
            this.$eqLow = this.$card.find<HTMLInputElement>('.hbb-deck-eq-low');
            this.$eqMid = this.$card.find<HTMLInputElement>('.hbb-deck-eq-mid');
            this.$eqHigh = this.$card.find<HTMLInputElement>('.hbb-deck-eq-high');
        }

        this.$hotcueRow = options.hideHotCues === true
            ? null
            : this.$card.find<HTMLDivElement>('.hbb-deck-hotcues');

        this.$loopRow = options.hideLoop === true
            ? null
            : this.$card.find<HTMLDivElement>('.hbb-deck-loop');

        this.$playBtn.on('click', (): void => {
            if (this.wavesurfer === null) {
                return;
            }
            this.wavesurfer.playPause();
        });

        if (this.$spectrogramToggle !== null) {
            this.$spectrogramToggle.on('change', (e: JQuery.ChangeEvent): void => {
                const checked: boolean = jQuery(e.currentTarget).is(':checked');
                this.toggleSpectrogram(checked);
            });
        }

        this.wireEqSliders();
        this.wireHotCueButtons();
        this.wireLoopButtons();
        this.wirePitchControls();
    }

    private wireLoopButtons(): void {
        if (this.$loopRow === null) {
            return;
        }
        this.$loopRow.find<HTMLButtonElement>('.hbb-loop-in').on('click', (): void => {
            if (this.wavesurfer === null) {
                return;
            }
            this.loopIn = this.wavesurfer.getCurrentTime();
            if (this.loopOut !== null && this.loopOut <= this.loopIn) {
                this.loopOut = null;
            }
            this.refreshLoopUi();
        });
        this.$loopRow.find<HTMLButtonElement>('.hbb-loop-out').on('click', (): void => {
            if (this.wavesurfer === null) {
                return;
            }
            this.loopOut = this.wavesurfer.getCurrentTime();
            if (this.loopIn !== null && this.loopOut <= this.loopIn) {
                this.loopIn = null;
            }
            this.refreshLoopUi();
        });
        this.$loopRow.find<HTMLButtonElement>('.hbb-loop-clear').on('click', (): void => {
            this.loopIn = null;
            this.loopOut = null;
            this.loopActive = false;
            this.$loopRow?.find<HTMLInputElement>('.hbb-loop-active').prop('checked', false);
            this.refreshLoopUi();
        });
        this.$loopRow.find<HTMLInputElement>('.hbb-loop-active').on('change', (e): void => {
            this.loopActive = jQuery(e.currentTarget).is(':checked');
            // If we're past the loop-out when activating, jump back so the loop kicks in immediately.
            if (this.loopActive
                && this.wavesurfer !== null
                && this.loopIn !== null
                && this.loopOut !== null
                && this.wavesurfer.getCurrentTime() >= this.loopOut) {
                this.wavesurfer.setTime(this.loopIn);
            }
            this.refreshLoopUi();
        });
    }

    private refreshLoopUi(): void {
        if (this.$loopRow === null || this.regions === null) {
            return;
        }
        // Remove any previous loop region.
        this.regions.getRegions()
            .filter((r: Region): boolean => r.id === `loop-${this.label}`)
            .forEach((r: Region): void => {
                r.remove();
            });
        if (this.loopIn !== null && this.loopOut !== null) {
            this.regions.addRegion({
                id: `loop-${this.label}`,
                start: this.loopIn,
                end: this.loopOut,
                color: LOOP_REGION_COLOR,
                drag: true,
                resize: true,
                content: '↻ loop'
            });
        }
        this.refreshLoopStatus();
    }

    /**
     * Updates the in/out status text without rebuilding the region (used after `region-updated`
     * events where the region itself already reflects the new bounds — rebuilding would
     * cause a flicker and break the user's active drag handle).
     */
    private refreshLoopStatus(): void {
        if (this.$loopRow === null) {
            return;
        }
        const $status = this.$loopRow.find<HTMLSpanElement>('.hbb-loop-status');
        const inStr: string = this.loopIn !== null ? `${this.loopIn.toFixed(2)}s` : '—';
        const outStr: string = this.loopOut !== null ? `${this.loopOut.toFixed(2)}s` : '—';
        $status.text(`in ${inStr} · out ${outStr}`);
    }

    private maybeLoop(): void {
        if (!this.loopActive
            || this.loopIn === null
            || this.loopOut === null
            || this.wavesurfer === null) {
            return;
        }
        if (this.wavesurfer.getCurrentTime() >= this.loopOut) {
            this.wavesurfer.setTime(this.loopIn);
        }
    }

    private wirePitchControls(): void {
        const $pitchRow = this.$card.find<HTMLDivElement>('.hbb-deck-pitch');
        if ($pitchRow.length === 0) {
            return;
        }
        const $tempo = $pitchRow.find<HTMLInputElement>('.hbb-deck-tempo');
        const $tempoVal = $pitchRow.find<HTMLSpanElement>('.hbb-deck-tempo-val');
        const $lock = $pitchRow.find<HTMLInputElement>('.hbb-deck-pitch-lock');

        // Restore persisted prefs (per-deck): `hbb.deck-pitch.<label>`
        const stored: { rate: number; lock: boolean } = Deck.loadPitchPrefs(this.label);
        this.deckPlaybackRate = stored.rate;
        this.pitchLocked = stored.lock;
        $tempo.val(this.deckPlaybackRate.toString());
        $tempoVal.text(`${this.deckPlaybackRate.toFixed(3)}×`);
        $lock.prop('checked', this.pitchLocked);

        $tempo.on('input', (e): void => {
            const v: number = Number.parseFloat(jQuery(e.currentTarget).val()?.toString() ?? '1');
            this.deckPlaybackRate = Number.isFinite(v) ? v : 1.0;
            $tempoVal.text(`${this.deckPlaybackRate.toFixed(3)}×`);
            this.applyPitchToMedia();
            Deck.savePitchPrefs(this.label, this.deckPlaybackRate, this.pitchLocked);
        });
        $pitchRow.find<HTMLButtonElement>('.hbb-deck-tempo-reset').on('click', (): void => {
            this.deckPlaybackRate = 1.0;
            $tempo.val('1');
            $tempoVal.text('1.000×');
            this.applyPitchToMedia();
            Deck.savePitchPrefs(this.label, this.deckPlaybackRate, this.pitchLocked);
        });
        $lock.on('change', (e): void => {
            this.pitchLocked = jQuery(e.currentTarget).is(':checked');
            this.applyPitchToMedia();
            Deck.savePitchPrefs(this.label, this.deckPlaybackRate, this.pitchLocked);
        });
    }

    private static loadPitchPrefs(label: DeckLabel): { rate: number; lock: boolean } {
        try {
            const raw: string | null = localStorage.getItem(`hbb.deck-pitch.${label}.v1`);
            if (raw === null) {
                return { rate: 1.0, lock: false };
            }
            const parsed: unknown = JSON.parse(raw);
            if (parsed === null || typeof parsed !== 'object') {
                return { rate: 1.0, lock: false };
            }
            const obj = parsed as Record<string, unknown>;
            const rate: number = typeof obj.rate === 'number' ? obj.rate : 1.0;
            const lock: boolean = typeof obj.lock === 'boolean' ? obj.lock : false;
            return { rate: rate, lock: lock };
        } catch {
            return { rate: 1.0, lock: false };
        }
    }

    private static savePitchPrefs(label: DeckLabel, rate: number, lock: boolean): void {
        try {
            localStorage.setItem(`hbb.deck-pitch.${label}.v1`, JSON.stringify({ rate: rate, lock: lock }));
        } catch {
            // localStorage unavailable — keep in-memory only.
        }
    }

    private wireHotCueButtons(): void {
        if (this.$hotcueRow === null) {
            return;
        }
        this.$hotcueRow.find<HTMLButtonElement>('.hbb-hotcue-btn').on('click', (e: JQuery.ClickEvent): void => {
            const $btn = jQuery<HTMLButtonElement>(e.currentTarget);
            const slot: number = Number.parseInt($btn.attr('data-slot') ?? '-1', 10);
            if (slot < 0) {
                return;
            }
            const key: string | undefined = Deck.hotCueKeyOf(this.currentTrack);
            if (key === undefined || this.wavesurfer === null) {
                return;
            }
            const store: HotCueStore = HotCueStore.getInstance();
            const cues: readonly (number | null)[] = store.get(key);
            const existing: number | null = cues[slot] ?? null;
            const shiftPressed: boolean =
                e.shiftKey === true || (e.originalEvent as MouseEvent | undefined)?.shiftKey === true;
            if (shiftPressed) {
                if (existing !== null) {
                    store.set(key, slot, null);
                    this.refreshHotCueUi();
                }
                return;
            }
            if (existing === null) {
                const now: number = this.wavesurfer.getCurrentTime();
                store.set(key, slot, now);
                this.refreshHotCueUi();
            } else {
                this.wavesurfer.setTime(existing);
            }
        });
    }

    private refreshHotCueUi(): void {
        if (this.$hotcueRow === null || this.regions === null) {
            return;
        }
        const key: string | undefined = Deck.hotCueKeyOf(this.currentTrack);
        if (key === undefined) {
            return;
        }
        const cues: readonly (number | null)[] = HotCueStore.getInstance().get(key);

        // Re-render buttons (filled vs empty visual state).
        this.$hotcueRow.find<HTMLButtonElement>('.hbb-hotcue-btn').each((idx, btn): void => {
            const $btn = jQuery<HTMLButtonElement>(btn);
            const sec: number | null = cues[idx] ?? null;
            $btn.removeClass('btn-default btn-info');
            if (sec === null) {
                $btn.addClass('btn-default').attr('title', `Cue ${(idx + 1).toString()} (empty — click to set)`);
            } else {
                $btn.addClass('btn-info').attr('title', `Cue ${(idx + 1).toString()} @ ${sec.toFixed(1)}s — click to jump, shift+click to clear`);
            }
        });

        // Re-paint waveform regions for cues.
        this.regions.getRegions()
            .filter((r: Region): boolean => r.id.startsWith(`hotcue-${this.label}-`))
            .forEach((r: Region): void => {
                r.remove();
            });
        for (let i = 0; i < cues.length; i++) {
            const sec: number | null = cues[i] ?? null;
            if (sec === null) {
                continue;
            }
            this.regions.addRegion({
                id: `hotcue-${this.label}-${i.toString()}`,
                start: sec,
                end: sec + HOTCUE_REGION_WIDTH_SEC,
                color: HOTCUE_REGION_COLOR,
                drag: false,
                resize: false,
                content: (i + 1).toString()
            });
        }
    }

    private wireEqSliders(): void {
        if (this.$eqLow === null || this.$eqMid === null || this.$eqHigh === null || this.$eqRow === null) {
            return;
        }
        const bind = ($slider: JQuery<HTMLInputElement>, valueSelector: string, apply: (db: number) => void): void => {
            $slider.on('input', (e): void => {
                const db: number = Number.parseFloat(jQuery(e.currentTarget).val()?.toString() ?? '0');
                apply(db);
                this.$card.find<HTMLSpanElement>(valueSelector).text(`${db.toFixed(1)} dB`);
            });
        };
        bind(this.$eqLow, '.hbb-deck-eq-low-val', (db): void => {
            if (this.eqLowNode !== null) {
                this.eqLowNode.gain.value = db;
            }
        });
        bind(this.$eqMid, '.hbb-deck-eq-mid-val', (db): void => {
            if (this.eqMidNode !== null) {
                this.eqMidNode.gain.value = db;
            }
        });
        bind(this.$eqHigh, '.hbb-deck-eq-high-val', (db): void => {
            if (this.eqHighNode !== null) {
                this.eqHighNode.gain.value = db;
            }
        });
        this.$eqRow.find<HTMLButtonElement>('.hbb-deck-eq-reset').on('click', (): void => {
            this.resetEq();
        });
    }

    private resetEq(): void {
        if (this.$eqLow !== null) {
            this.$eqLow.val('0');
        }
        if (this.$eqMid !== null) {
            this.$eqMid.val('0');
        }
        if (this.$eqHigh !== null) {
            this.$eqHigh.val('0');
        }
        this.$card.find<HTMLSpanElement>('.hbb-deck-eq-low-val, .hbb-deck-eq-mid-val, .hbb-deck-eq-high-val').text('0 dB');
        if (this.eqLowNode !== null) {
            this.eqLowNode.gain.value = 0;
        }
        if (this.eqMidNode !== null) {
            this.eqMidNode.gain.value = 0;
        }
        if (this.eqHighNode !== null) {
            this.eqHighNode.gain.value = 0;
        }
    }

    public getLabel(): DeckLabel {
        return this.label;
    }

    public getTrack(): RouteTrack | null {
        return this.currentTrack;
    }

    public setTrack(track: RouteTrack): void {
        this.currentTrack = track;
        const filename: string = TrackDisplayUtil.filenameOf(track.path);
        const meta = track.metadata;
        this.$title.text(meta?.title ?? filename);
        this.$artist.text(meta?.artist ?? '');
        this.renderCover(track);
        this.renderBadges(track);
        this.loadWaveform(track);
    }

    /**
     * Repaint the header cover slot. `null` shows the empty fa-music placeholder; passing a
     * track with `hasCover: true` swaps in the real image. Sized 56×56 — visually balanced
     * against the badge + title row in the card-header.
     */
    private renderCover(track: RouteTrack | null): void {
        const size: number = 56;
        const sz: string = size.toString();
        if (track !== null && track.hasCover) {
            this.$cover.html(`<img src="${TrackDisplayUtil.coverUrl(track)}" alt="" style="width:${sz}px;height:${sz}px;object-fit:cover;border-radius:4px;">`);
            return;
        }
        this.$cover.html(`<span class="d-inline-flex align-items-center justify-content-center text-muted" style="width:${sz}px;height:${sz}px;border-radius:4px;background:#e9ecef;font-size:1.1rem;"><i class="fas fa-music"></i></span>`);
    }

    public setCue(positionSec: number, which: 'in' | 'out'): void {
        if (this.regions === null || this.wavesurfer === null) {
            return;
        }
        const duration: number = this.wavesurfer.getDuration();
        if (duration <= 0) {
            return;
        }
        this.regions.getRegions()
            .filter((r: Region): boolean => r.id.startsWith('cue-'))
            .forEach((r: Region): void => {
                r.remove();
            });
        if (which === 'out') {
            this.regions.addRegion({
                id: `cue-out-${this.label}`,
                start: positionSec,
                end: duration,
                color: CUE_REGION_COLOR,
                drag: false,
                resize: false,
                content: 'cue-out'
            });
        } else {
            this.regions.addRegion({
                id: `cue-in-${this.label}`,
                start: 0,
                end: positionSec,
                color: CUE_REGION_COLOR,
                drag: false,
                resize: false,
                content: 'cue-in'
            });
        }
    }

    public pause(): void {
        if (this.wavesurfer === null) {
            return;
        }
        if (this.wavesurfer.isPlaying()) {
            this.wavesurfer.pause();
        }
    }

    public clearCues(): void {
        if (this.regions === null) {
            return;
        }
        this.regions.getRegions()
            .filter((r: Region): boolean => r.id.startsWith('cue-'))
            .forEach((r: Region): void => {
                r.remove();
            });
    }

    public syncToTime(sec: number): void {
        if (this.wavesurfer === null) {
            return;
        }
        const duration: number = this.wavesurfer.getDuration();
        if (duration <= 0) {
            return;
        }
        const clamped: number = Math.max(0, Math.min(sec, duration));
        this.wavesurfer.setTime(clamped);
    }

    public togglePlayPause(): void {
        if (this.wavesurfer === null) {
            return;
        }
        if (this.wavesurfer.isPlaying()) {
            this.wavesurfer.pause();
        } else {
            void this.wavesurfer.play();
        }
    }

    /** Programmatic equivalent of clicking a hot-cue button (slot 0–7). */
    public triggerHotCue(slot: number, shift: boolean): void {
        if (slot < 0 || slot >= HOTCUE_SLOT_COUNT) {
            return;
        }
        const key: string | undefined = Deck.hotCueKeyOf(this.currentTrack);
        if (key === undefined || this.wavesurfer === null) {
            return;
        }
        const store: HotCueStore = HotCueStore.getInstance();
        const cues: readonly (number | null)[] = store.get(key);
        const existing: number | null = cues[slot] ?? null;
        if (shift) {
            if (existing !== null) {
                store.set(key, slot, null);
                this.refreshHotCueUi();
            }
            return;
        }
        if (existing === null) {
            store.set(key, slot, this.wavesurfer.getCurrentTime());
            this.refreshHotCueUi();
        } else {
            this.wavesurfer.setTime(existing);
        }
    }

    /** Composite hot-cue key combining `providerId` and `path`. Both are user-controlled
     *  strings, so a delimiter that's invalid in either is safest — `|` works because
     *  provider ids are validated as identifiers and relative paths use `/`. */
    private static hotCueKeyOf(track: RouteTrack | null): string | undefined {
        if (track === null) {
            return undefined;
        }
        return `${track.providerId}|${track.path}`;
    }

    public triggerLoopIn(): void {
        this.$loopRow?.find<HTMLButtonElement>('.hbb-loop-in').trigger('click');
    }

    public triggerLoopOut(): void {
        this.$loopRow?.find<HTMLButtonElement>('.hbb-loop-out').trigger('click');
    }

    public triggerLoopClear(): void {
        this.$loopRow?.find<HTMLButtonElement>('.hbb-loop-clear').trigger('click');
    }

    /** Visual-only — paints a coloured border around the deck card to mark keyboard focus. */
    public setActive(active: boolean): void {
        this.$card.toggleClass('hbb-deck-active', active);
    }

    public getCardElement(): JQuery<HTMLDivElement> {
        return this.$card;
    }

    private renderBadges(track: RouteTrack): void {
        const energyPct: number = Math.round(track.energy * 1000) / 10;
        this.$badges.html(`
            <span class="badge badge-info mr-1">${track.camelot}</span>
            <span class="badge badge-secondary mr-1">${track.openKey}</span>
            <span class="badge badge-warning mr-1">${track.bpm.toFixed(1)} BPM</span>
            <span class="badge badge-light mr-1">Energy ${energyPct.toFixed(1)}%</span>
            <span class="badge badge-dark mr-1">${track.drops.length} drops</span>
            <span class="badge badge-light">${Math.round(track.durationSec)}s</span>
        `);
    }

    private loadWaveform(track: RouteTrack): void {
        if (this.wavesurfer !== null) {
            this.wavesurfer.destroy();
            this.wavesurfer = null;
            this.regions = null;
            this.spectrogramPlugin = null;
        }
        this.teardownEqChain();
        // Loop is per-track session state; reset on every load.
        this.loopIn = null;
        this.loopOut = null;
        this.loopActive = false;
        if (this.$loopRow !== null) {
            this.$loopRow.find<HTMLInputElement>('.hbb-loop-active').prop('checked', false);
        }
        if (this.$spectrogramToggle !== null) {
            this.$spectrogramToggle.prop('checked', false);
        }
        this.$spectrogram.hide().empty();
        this.$playBtn.prop('disabled', true);
        this.clearEnergyCurve();

        const regions: RegionsPlugin = RegionsPlugin.create();
        const timeline: TimelinePlugin = TimelinePlugin.create({
            container: this.$timeline[0] as HTMLElement,
            height: 20,
            primaryLabelInterval: 30,
            secondaryLabelInterval: 5,
            style: {
                fontSize: '10px',
                color: '#6c757d'
            }
        });
        const hover: HoverPlugin = HoverPlugin.create({
            lineColor: '#dc3545',
            lineWidth: 1,
            labelBackground: '#343a40',
            labelColor: '#f8f9fa',
            labelSize: '11px',
            formatTimeCallback: Deck.formatTime
        });
        const ws: WaveSurfer = WaveSurfer.create({
            container: this.$waveform[0] as HTMLElement,
            waveColor: WAVE_COLOR_BY_DECK[this.label],
            progressColor: '#343a40',
            cursorColor: '#dc3545',
            cursorWidth: 2,
            height: 96,
            barWidth: 2,
            barGap: 1,
            barRadius: 1,
            normalize: true,
            url: `api/v1/library/audio?providerId=${encodeURIComponent(track.providerId)}&path=${encodeURIComponent(track.path)}`,
            plugins: [regions, timeline, hover]
        });
        ws.on('ready', (): void => {
            for (let i = 0; i < track.drops.length; i++) {
                const dropSec: number = track.drops[i] as number;
                regions.addRegion({
                    id: `drop-${this.label}-${i.toString()}`,
                    start: dropSec,
                    end: dropSec + DROP_REGION_WIDTH_SEC,
                    color: DROP_MARKER_COLOR,
                    drag: false,
                    resize: false,
                    content: `▼ ${dropSec.toFixed(0)}s`
                });
            }
            this.drawOverlays(track);
            this.setupEqChain(ws);
            this.refreshHotCueUi();
            this.refreshLoopUi();
            this.$playBtn.prop('disabled', false);
        });
        ws.on('play', (): void => {
            this.$playBtn.html('<i class="fas fa-pause"></i> Pause');
        });
        ws.on('pause', (): void => {
            this.$playBtn.html('<i class="fas fa-play"></i> Play');
        });
        ws.on('finish', (): void => {
            this.$playBtn.html('<i class="fas fa-play"></i> Play');
        });
        ws.on('error', (e: unknown): void => {
            console.error(`Deck ${this.label} wavesurfer error:`, e);
        });
        ws.on('audioprocess', (): void => {
            this.maybeLoop();
        });
        // `timeupdate` covers the case where playback is paused and the user seeks.
        ws.on('timeupdate', (): void => {
            this.maybeLoop();
        });
        // Drag/resize on the loop region writes the new bounds back into our own state so
        // (a) the active-loop wraparound uses the latest values and (b) the status text stays
        // in sync. Rebuilding the region here would yank the drag handle from under the user;
        // we just refresh the in/out text instead.
        regions.on('region-updated', (region: Region): void => {
            if (region.id !== `loop-${this.label}`) {
                return;
            }
            this.loopIn = region.start;
            this.loopOut = region.end;
            this.refreshLoopStatus();
        });
        this.wavesurfer = ws;
        this.regions = regions;
        // Apply persisted pitch / pitch-lock prefs to the new media element so reload-after-
        // page-refresh feels consistent. Wavesurfer's underlying media element accepts
        // `playbackRate` and `preservesPitch` directly (Chrome/Firefox both support).
        this.applyPitchToMedia();
    }

    private applyPitchToMedia(): void {
        if (this.wavesurfer === null) {
            return;
        }
        const media: HTMLMediaElement | null = this.wavesurfer.getMediaElement();
        if (media === null) {
            return;
        }
        media.playbackRate = this.deckPlaybackRate;
        // `preservesPitch` is camelCase; older browsers used `mozPreservesPitch` /
        // `webkitPreservesPitch`. Set the standard property; legacy fallbacks elided.
        type WithPitch = HTMLMediaElement & { preservesPitch?: boolean };
        (media as WithPitch).preservesPitch = this.pitchLocked;
    }

    private drawOverlays(track: RouteTrack): void {
        const canvas: HTMLCanvasElement = this.$energyCanvas[0] as HTMLCanvasElement;
        const ctx: CanvasRenderingContext2D | null = canvas.getContext('2d');
        if (ctx === null) {
            return;
        }
        const wrapper: HTMLDivElement = this.$waveform[0] as HTMLDivElement;
        const dpr: number = window.devicePixelRatio || 1;
        const width: number = wrapper.clientWidth;
        const height: number = wrapper.clientHeight || 96;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.width = `${width.toString()}px`;
        canvas.style.height = `${height.toString()}px`;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);

        // Beat grid first (under the energy curve).
        this.drawBeatGrid(ctx, track, width, height);

        // Energy curve last so it sits on top of the grid.
        this.drawEnergyCurve(ctx, track, width, height);
    }

    private drawBeatGrid(
        ctx: CanvasRenderingContext2D,
        track: RouteTrack,
        width: number,
        height: number
    ): void {
        const beats: readonly number[] = track.beats ?? [];
        if (beats.length === 0 || track.durationSec <= 0) {
            return;
        }
        for (let i = 0; i < beats.length; i++) {
            const beatSec: number = beats[i] ?? 0;
            const x: number = (beatSec / track.durationSec) * width;
            if (x < 0 || x > width) {
                continue;
            }
            const isBar: boolean = i % BEATS_PER_BAR === 0;
            ctx.beginPath();
            ctx.strokeStyle = isBar ? BAR_LINE_COLOR : BEAT_LINE_COLOR;
            ctx.lineWidth = isBar ? 1.5 : 0.5;
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
        }
    }

    private drawEnergyCurve(
        ctx: CanvasRenderingContext2D,
        track: RouteTrack,
        width: number,
        height: number
    ): void {
        const timeline: readonly number[] = track.energyTimeline ?? [];
        if (timeline.length < 2) {
            return;
        }
        let max: number = 0;
        for (const v of timeline) {
            if (v > max) {
                max = v;
            }
        }
        if (max <= 0) {
            return;
        }
        ctx.beginPath();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = ENERGY_LINE_COLOR;
        for (let i = 0; i < timeline.length; i++) {
            const v: number = timeline[i] ?? 0;
            const x: number = (i / (timeline.length - 1)) * width;
            // Plot in the upper half of the canvas, leaving the wave's centreline visible.
            const y: number = height * 0.05 + (1 - v / max) * height * 0.4;
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.stroke();
    }

    private clearEnergyCurve(): void {
        const canvas: HTMLCanvasElement = this.$energyCanvas[0] as HTMLCanvasElement;
        const ctx: CanvasRenderingContext2D | null = canvas.getContext('2d');
        if (ctx === null) {
            return;
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    /**
     * Wires the wavesurfer-owned `<audio>` element through a 3-band EQ
     * (lowshelf 250 Hz / peaking 1 kHz Q=0.7 / highshelf 5 kHz) and into the AudioContext
     * destination. Skipped when `hideEq` is set.
     *
     * Once `createMediaElementSource(el)` is called for an element, the element's normal
     * playback no longer reaches the speakers — Web Audio is fully responsible. So the
     * filter chain *must* be connected to `ctx.destination`, otherwise the deck goes silent.
     */
    private setupEqChain(ws: WaveSurfer): void {
        if (this.options.hideEq === true) {
            return;
        }
        const audioEl: HTMLMediaElement | null = ws.getMediaElement();
        if (audioEl === null) {
            return;
        }
        if (this.audioCtx === null) {
            this.audioCtx = new AudioContext();
        }
        const ctx: AudioContext = this.audioCtx;
        try {
            this.eqSource = ctx.createMediaElementSource(audioEl);
        } catch (err) {
            // Element was already wired to a previous source (can happen if wavesurfer reuses
            // the same audio el across loads). Nothing we can do here — leave EQ inactive.
            console.warn(`Deck ${this.label}: createMediaElementSource failed, EQ disabled:`, err);
            return;
        }
        this.eqLowNode = ctx.createBiquadFilter();
        this.eqLowNode.type = 'lowshelf';
        this.eqLowNode.frequency.value = EQ_LOW_FREQ_HZ;
        this.eqLowNode.gain.value = Deck.parseDb(this.$eqLow);

        this.eqMidNode = ctx.createBiquadFilter();
        this.eqMidNode.type = 'peaking';
        this.eqMidNode.frequency.value = EQ_MID_FREQ_HZ;
        this.eqMidNode.Q.value = EQ_MID_Q;
        this.eqMidNode.gain.value = Deck.parseDb(this.$eqMid);

        this.eqHighNode = ctx.createBiquadFilter();
        this.eqHighNode.type = 'highshelf';
        this.eqHighNode.frequency.value = EQ_HIGH_FREQ_HZ;
        this.eqHighNode.gain.value = Deck.parseDb(this.$eqHigh);

        this.eqSource
            .connect(this.eqLowNode)
            .connect(this.eqMidNode)
            .connect(this.eqHighNode)
            .connect(ctx.destination);
    }

    private teardownEqChain(): void {
        if (this.eqSource !== null) {
            try {
                this.eqSource.disconnect();
            } catch {
                // already disconnected
            }
            this.eqSource = null;
        }
        for (const node of [this.eqLowNode, this.eqMidNode, this.eqHighNode]) {
            if (node !== null) {
                try {
                    node.disconnect();
                } catch {
                    // already disconnected
                }
            }
        }
        this.eqLowNode = null;
        this.eqMidNode = null;
        this.eqHighNode = null;
    }

    private static parseDb($slider: JQuery<HTMLInputElement> | null): number {
        if ($slider === null) {
            return 0;
        }
        const v: number = Number.parseFloat($slider.val()?.toString() ?? '0');
        return Number.isFinite(v) ? v : 0;
    }

    private toggleSpectrogram(enable: boolean): void {
        if (this.wavesurfer === null) {
            return;
        }
        if (enable) {
            if (this.spectrogramPlugin !== null) {
                this.$spectrogram.show();
                return;
            }
            this.$spectrogram.show();
            const plugin: SpectrogramPlugin = SpectrogramPlugin.create({
                container: this.$spectrogram[0] as HTMLElement,
                labels: true,
                height: 120,
                fftSamples: 512,
                splitChannels: false
            });
            this.spectrogramPlugin = plugin;
            this.wavesurfer.registerPlugin(plugin);
        } else {
            if (this.spectrogramPlugin !== null) {
                this.spectrogramPlugin.destroy();
                this.spectrogramPlugin = null;
            }
            this.$spectrogram.hide().empty();
        }
    }

    private static formatTime(sec: number): string {
        const total: number = Math.max(0, Math.floor(sec));
        const m: number = Math.floor(total / 60);
        const s: number = total % 60;
        const ms: number = Math.floor((sec - total) * 1000);
        if (m === 0) {
            return `${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}s`;
        }
        return `${m.toString()}:${s.toString().padStart(2, '0')}`;
    }

}