import {
    Card,
    ColumnContent,
    ContentCol,
    ContentColSize,
    ContentRow,
    Lang,
    LangText,
    Table,
    Th,
    Tr
} from 'bambooo';
import { DjSetApi } from '../Api/DjSetApi.js';
import { LibraryApi } from '../Api/LibraryApi.js';
import { TracksApi } from '../Api/TracksApi.js';
import { TranscodeApi } from '../Api/TranscodeApi.js';
import {
    type DjSet as DjSetData,
    type DjSetBody,
    type DjSetStrategy,
    type EnergyDirection,
    type EnergyShape,
    type RouteTrack,
} from '@headbangbear/schemas';
import {
    AutoPlayer,
    type EqBand,
    type EqSide,
    type MasterEqState,
    type SideEqState
} from '../Widget/AutoPlayer.js';
import { TrackDisplayUtil } from '../Util/TrackDisplayUtil.js';
import { Deck } from '../Widget/Deck.js';
import { SetlistStore } from '../Widget/SetlistStore.js';
import { TransitionStyleStore } from '../Widget/TransitionStyleStore.js';
import { BasePage } from './BasePage.js';

type SetSource = 'auto' | 'manual';

/**
 * DJ-Set page: generate a Camelot-compatible chain (auto, via the backend's `DjSetPlanner`)
 * **or** play the user's manually-built setlist (entries collected from the Library page),
 * preview the track order, and play it through the browser with crossfades + per-track
 * pitch shift derived from each transition.
 */
export class DjSet extends BasePage {

    protected override _name: string = 'dj-set';

    private currentSet: DjSetData | null = null;

    private player: AutoPlayer | null = null;

    private source: SetSource = 'auto';

    private unsubscribeSetlist: (() => void) | null = null;

    private $controlsCard: JQuery<HTMLDivElement> | null = null;

    private $playBtn: JQuery<HTMLButtonElement> | null = null;

    private $stopBtn: JQuery<HTMLButtonElement> | null = null;

    private $statusEl: JQuery<HTMLDivElement> | null = null;

    private $chainBody: JQuery<HTMLDivElement> | null = null;

    private $autoControls: JQuery<HTMLDivElement> | null = null;

    private $manualControls: JQuery<HTMLDivElement> | null = null;

    private nowPlayingDeck: Deck | null = null;

    private $nowPlayingCard: JQuery<HTMLDivElement> | null = null;

    private currentNowPlayingIndex: number = -1;

    private libraryByPath: Map<string, RouteTrack> = new Map();

    /** Backing data for the chunked chain renderer — stored when `renderChain`
     *  is called, consumed by `renderMoreChainRows` on scroll. */
    private chainTracks: DjSetData['tracks'] = [];

    private chainTransitions: DjSetData['transitions'] = [];

    private chainManual: boolean = false;

    private renderedChainCount: number = 0;

    private chainScrollHandler: ((e: Event) => void) | null = null;

    private static readonly CHAIN_CHUNK_SIZE: number = 100;

    private masterVolume: number = 0.85;

    private masterEq: MasterEqState = { lowDb: 0, midDb: 0, highDb: 0 };

    private sideEq: SideEqState = {
        A: { lowDb: 0, midDb: 0, highDb: 0 },
        B: { lowDb: 0, midDb: 0, highDb: 0 }
    };

    private recordingArmed: boolean = false;

    private pitchLocked: boolean = DjSet.loadPitchLockPref();

    private isTranscoding: boolean = false;

    private lastRecordingUrl: string | null = null;

    public constructor() {
        super();
        this.setTitle('DJ Set');
    }

    public override async unloadContent(): Promise<void> {
        if (this.player !== null) {
            await this.player.dispose();
            this.player = null;
        }
        if (this.unsubscribeSetlist !== null) {
            this.unsubscribeSetlist();
            this.unsubscribeSetlist = null;
        }
        if (this.lastRecordingUrl !== null) {
            URL.revokeObjectURL(this.lastRecordingUrl);
            this.lastRecordingUrl = null;
        }
        if (this.chainScrollHandler !== null) {
            window.removeEventListener('scroll', this.chainScrollHandler);
            this.chainScrollHandler = null;
        }
    }

    public override async loadContent(): Promise<void> {
        const content = this.getContent();
        content.empty();

        const helpRow = new ContentRow(content);
        const helpCol = new ContentCol(helpRow, ContentColSize.col12);
        const $helpCard: JQuery<HTMLDivElement> = jQuery<HTMLDivElement>(`
            <div class="card card-info card-outline collapsed-card">
                <div class="card-header">
                    <h3 class="card-title">
                        <i class="fas fa-info-circle mr-1"></i>${DjSet.langOrFallback('dj_set_help_title')}
                    </h3>
                    <div class="card-tools">
                        <button type="button" class="btn btn-tool" data-card-widget="collapse"><i class="fas fa-plus"></i></button>
                    </div>
                </div>
                <div class="card-body" style="display:none;">
                    <p class="mb-0">${DjSet.langOrFallback('dj_set_help_body')}</p>
                </div>
            </div>
        `);
        helpCol.getElement().append($helpCard);

        const controlsRow = new ContentRow(content);
        const controlsCol = new ContentCol(controlsRow, ContentColSize.col12);
        this.$controlsCard = jQuery<HTMLDivElement>(`
            <div class="card">
                <div class="card-header"><h3 class="card-title">${DjSet.langOrFallback('dj_set')}</h3></div>
                <div class="card-body">
                    <div class="form-group">
                        <label class="mr-3">${DjSet.langOrFallback('dj_set_source_label')}</label>
                        <div class="custom-control custom-radio custom-control-inline">
                            <input type="radio" name="hbb-source" value="auto" id="hbb-source-auto" class="custom-control-input" checked>
                            <label class="custom-control-label" for="hbb-source-auto">${DjSet.langOrFallback('dj_set_source_auto')}</label>
                        </div>
                        <div class="custom-control custom-radio custom-control-inline">
                            <input type="radio" name="hbb-source" value="manual" id="hbb-source-manual" class="custom-control-input">
                            <label class="custom-control-label" for="hbb-source-manual">${DjSet.langOrFallback('dj_set_source_manual')} (<span class="hbb-setlist-count">0</span>)</label>
                        </div>
                    </div>

                    <div class="hbb-auto-controls">
                        <div class="form-row">
                            <div class="form-group col-md-2">
                                <label>${DjSet.langOrFallback('dj_set_strategy')}</label>
                                <select class="form-control form-control-sm hbb-strategy">
                                    <option value="greedy">greedy</option>
                                    <option value="beam" selected>beam (multi-start)</option>
                                </select>
                            </div>
                            <div class="form-group col-md-2">
                                <label>${DjSet.langOrFallback('dj_set_direction')}</label>
                                <select class="form-control form-control-sm hbb-direction">
                                    <option value="up" selected>up</option>
                                    <option value="down">down</option>
                                    <option value="either">either</option>
                                </select>
                            </div>
                            <div class="form-group col-md-3">
                                <label class="hbb-shape-label" title="${DjSet.langOrFallback('dj_set_shape_help')}">${DjSet.langOrFallback('dj_set_shape')}</label>
                                <div class="d-flex align-items-center" style="gap:0.5rem;">
                                    <select class="form-control form-control-sm hbb-shape" style="flex:1;">
                                        <option value="" selected>—</option>
                                        <option value="rising">rising</option>
                                        <option value="arc">arc</option>
                                        <option value="descending">descending</option>
                                    </select>
                                    <svg class="hbb-shape-preview" width="56" height="28" viewBox="0 0 56 28" style="border:1px solid #ced4da; border-radius:3px; background:#fafafa;">
                                        <polyline class="hbb-shape-curve" fill="none" stroke="#6c757d" stroke-width="1.5" points=""></polyline>
                                    </svg>
                                </div>
                                <small class="text-muted hbb-shape-hint">${DjSet.langOrFallback('dj_set_shape_help')}</small>
                            </div>
                            <div class="form-group col-md-1">
                                <label>${DjSet.langOrFallback('dj_set_beam_width')}</label>
                                <input type="number" class="form-control form-control-sm hbb-beam-width" value="8" min="1" max="64">
                            </div>
                            <div class="form-group col-md-2">
                                <label title="Empty = no limit">${DjSet.langOrFallback('dj_set_target')}</label>
                                <input type="number" class="form-control form-control-sm hbb-target-duration" placeholder="—" min="0" step="0.5">
                            </div>
                            <div class="form-group col-md-3">
                                <label>${DjSet.langOrFallback('transition_style_label')}</label>
                                <select class="form-control form-control-sm hbb-style">
                                    <option value="drop-on-drop">${DjSet.langOrFallback('transition_style_drop_on_drop')}</option>
                                    <option value="tail-out">${DjSet.langOrFallback('transition_style_tail_out')}</option>
                                    <option value="early-cut">${DjSet.langOrFallback('transition_style_early_cut')}</option>
                                    <option value="bar-match">${DjSet.langOrFallback('transition_style_bar_match')}</option>
                                </select>
                            </div>
                            <div class="form-group col-md-3 d-flex align-items-end">
                                <label class="mb-0" title="${DjSet.langOrFallback('dj_set_avoid_same_artist_help')}">
                                    <input type="checkbox" class="hbb-avoid-same-artist"> ${DjSet.langOrFallback('dj_set_avoid_same_artist')}
                                </label>
                            </div>
                            <div class="form-group col-md-2 d-flex align-items-end">
                                <button type="button" class="btn btn-sm btn-primary hbb-generate-btn">
                                    <i class="fas fa-magic mr-1"></i> ${DjSet.langOrFallback('dj_set_generate')}
                                </button>
                            </div>
                        </div>
                    </div>

                    <div class="hbb-manual-controls" style="display:none;">
                        <button type="button" class="btn btn-sm btn-default hbb-load-manual-btn">
                            <i class="fas fa-redo-alt mr-1"></i> ${DjSet.langOrFallback('dj_set_load_setlist')}
                        </button>
                        <button type="button" class="btn btn-sm btn-warning hbb-clear-setlist-btn">
                            <i class="fas fa-trash mr-1"></i> ${DjSet.langOrFallback('dj_set_clear_setlist')}
                        </button>
                    </div>

                    <div class="mt-3 d-flex align-items-center flex-wrap" style="gap:0.75rem;">
                        <button type="button" class="btn btn-sm btn-success hbb-play-btn" disabled>
                            <i class="fas fa-play mr-1"></i> ${DjSet.langOrFallback('dj_set_play')}
                        </button>
                        <button type="button" class="btn btn-sm btn-danger hbb-stop-btn" disabled>
                            <i class="fas fa-stop mr-1"></i> ${DjSet.langOrFallback('dj_set_stop')}
                        </button>
                        <span class="d-inline-flex align-items-center small text-muted ml-3">
                            <i class="fas fa-volume-up mr-1"></i>
                            <input type="range" class="hbb-master-volume" min="0" max="1" step="0.01" value="0.85" style="width:140px;">
                        </span>
                        <span class="d-inline-flex align-items-center small ml-3">
                            <strong class="mr-1">LO</strong>
                            <input type="range" class="hbb-master-eq-low" min="-12" max="12" step="0.5" value="0" style="width:100px;">
                            <span class="hbb-master-eq-low-val ml-1 text-muted" style="width:2.5rem;">0 dB</span>
                        </span>
                        <span class="d-inline-flex align-items-center small">
                            <strong class="mr-1">MID</strong>
                            <input type="range" class="hbb-master-eq-mid" min="-12" max="12" step="0.5" value="0" style="width:100px;">
                            <span class="hbb-master-eq-mid-val ml-1 text-muted" style="width:2.5rem;">0 dB</span>
                        </span>
                        <span class="d-inline-flex align-items-center small">
                            <strong class="mr-1">HI</strong>
                            <input type="range" class="hbb-master-eq-high" min="-12" max="12" step="0.5" value="0" style="width:100px;">
                            <span class="hbb-master-eq-high-val ml-1 text-muted" style="width:2.5rem;">0 dB</span>
                        </span>
                        <button type="button" class="btn btn-xs btn-default hbb-master-eq-reset">${DjSet.langOrFallback('dj_set_master_eq_reset')}</button>
                    </div>
                    <div class="mt-2 d-flex align-items-center flex-wrap small hbb-side-row" data-side="A" style="gap:0.75rem;">
                        <strong class="hbb-side-label" style="min-width:5rem;">Side A <span class="badge badge-secondary hbb-side-active">●</span></strong>
                        <span class="d-inline-flex align-items-center">
                            <strong class="mr-1">LO</strong>
                            <input type="range" class="hbb-side-eq" data-side="A" data-band="low" min="-12" max="12" step="0.5" value="0" style="width:100px;">
                            <span class="hbb-side-eq-val ml-1 text-muted" data-side="A" data-band="low" style="width:2.5rem;">0 dB</span>
                        </span>
                        <span class="d-inline-flex align-items-center">
                            <strong class="mr-1">MID</strong>
                            <input type="range" class="hbb-side-eq" data-side="A" data-band="mid" min="-12" max="12" step="0.5" value="0" style="width:100px;">
                            <span class="hbb-side-eq-val ml-1 text-muted" data-side="A" data-band="mid" style="width:2.5rem;">0 dB</span>
                        </span>
                        <span class="d-inline-flex align-items-center">
                            <strong class="mr-1">HI</strong>
                            <input type="range" class="hbb-side-eq" data-side="A" data-band="high" min="-12" max="12" step="0.5" value="0" style="width:100px;">
                            <span class="hbb-side-eq-val ml-1 text-muted" data-side="A" data-band="high" style="width:2.5rem;">0 dB</span>
                        </span>
                        <button type="button" class="btn btn-xs btn-default hbb-side-eq-reset" data-side="A">${DjSet.langOrFallback('dj_set_reset_a')}</button>
                    </div>
                    <div class="mt-1 d-flex align-items-center flex-wrap small hbb-side-row" data-side="B" style="gap:0.75rem;">
                        <strong class="hbb-side-label" style="min-width:5rem;">Side B <span class="badge badge-secondary hbb-side-active">●</span></strong>
                        <span class="d-inline-flex align-items-center">
                            <strong class="mr-1">LO</strong>
                            <input type="range" class="hbb-side-eq" data-side="B" data-band="low" min="-12" max="12" step="0.5" value="0" style="width:100px;">
                            <span class="hbb-side-eq-val ml-1 text-muted" data-side="B" data-band="low" style="width:2.5rem;">0 dB</span>
                        </span>
                        <span class="d-inline-flex align-items-center">
                            <strong class="mr-1">MID</strong>
                            <input type="range" class="hbb-side-eq" data-side="B" data-band="mid" min="-12" max="12" step="0.5" value="0" style="width:100px;">
                            <span class="hbb-side-eq-val ml-1 text-muted" data-side="B" data-band="mid" style="width:2.5rem;">0 dB</span>
                        </span>
                        <span class="d-inline-flex align-items-center">
                            <strong class="mr-1">HI</strong>
                            <input type="range" class="hbb-side-eq" data-side="B" data-band="high" min="-12" max="12" step="0.5" value="0" style="width:100px;">
                            <span class="hbb-side-eq-val ml-1 text-muted" data-side="B" data-band="high" style="width:2.5rem;">0 dB</span>
                        </span>
                        <button type="button" class="btn btn-xs btn-default hbb-side-eq-reset" data-side="B">${DjSet.langOrFallback('dj_set_reset_b')}</button>
                    </div>
                    <div class="mt-2 d-flex align-items-center small" style="gap:1rem;">
                        <label class="mb-0">
                            <input type="checkbox" class="hbb-record-toggle"> ${DjSet.langOrFallback('dj_set_record')}
                        </label>
                        <label class="mb-0" title="${DjSet.langOrFallback('dj_set_pitch_lock_help')}">
                            <input type="checkbox" class="hbb-pitch-lock"> ${DjSet.langOrFallback('dj_set_pitch_lock')}
                        </label>
                        <span class="hbb-record-status text-muted"></span>
                        <span class="hbb-download-link"></span>
                    </div>
                    <div class="hbb-status text-muted small mt-2"></div>
                </div>
            </div>
        `);
        controlsCol.getElement().append(this.$controlsCard);
        this.$playBtn = this.$controlsCard.find<HTMLButtonElement>('.hbb-play-btn');
        this.$stopBtn = this.$controlsCard.find<HTMLButtonElement>('.hbb-stop-btn');
        this.$statusEl = this.$controlsCard.find<HTMLDivElement>('.hbb-status');
        this.$autoControls = this.$controlsCard.find<HTMLDivElement>('.hbb-auto-controls');
        this.$manualControls = this.$controlsCard.find<HTMLDivElement>('.hbb-manual-controls');
        const $setlistCount = this.$controlsCard.find<HTMLSpanElement>('.hbb-setlist-count');

        const store: SetlistStore = SetlistStore.getInstance();
        $setlistCount.text(store.size().toString());
        this.unsubscribeSetlist = store.onChange((): void => {
            $setlistCount.text(store.size().toString());
            if (this.source === 'manual') {
                this.loadManualSet();
            }
        });

        this.$controlsCard.find<HTMLInputElement>('input[name="hbb-source"]').on('change', (e): void => {
            const value: string = jQuery(e.currentTarget).val()?.toString() ?? 'auto';
            this.source = value === 'manual' ? 'manual' : 'auto';
            this.$autoControls?.toggle(this.source === 'auto');
            this.$manualControls?.toggle(this.source === 'manual');
            if (this.source === 'manual') {
                this.loadManualSet();
            } else {
                this.currentSet = null;
                this.$playBtn?.prop('disabled', true);
                if (this.$chainBody !== null) {
                    this.$chainBody.empty();
                    this.$chainBody.html(
                        `<p class="text-muted m-3">${DjSet.langOrFallback('dj_set_click_generate')}</p>`
                    );
                }
            }
        });

        // Wire shape-preview SVG: redraw on shape-select change + once at init.
        const $shapeSelect = this.$controlsCard.find<HTMLSelectElement>('.hbb-shape');
        const updateShapePreview = (): void => {
            const v: string = $shapeSelect.val()?.toString() ?? '';
            const shape: 'rising' | 'arc' | 'descending' | null =
                v === 'rising' || v === 'arc' || v === 'descending' ? v : null;
            DjSet.drawShapePreview(this.$controlsCard, shape);
        };
        $shapeSelect.on('change', updateShapePreview);
        updateShapePreview();

        // Wire transition-style select: initialise from store + write back on change.
        const $styleSelect = this.$controlsCard.find<HTMLSelectElement>('.hbb-style');
        $styleSelect.val(TransitionStyleStore.getInstance().get());
        $styleSelect.on('change', (): void => {
            const v: string = $styleSelect.val()?.toString() ?? 'drop-on-drop';
            if (v === 'drop-on-drop' || v === 'tail-out' || v === 'early-cut' || v === 'bar-match') {
                TransitionStyleStore.getInstance().set(v);
            }
        });

        this.$controlsCard.find<HTMLButtonElement>('.hbb-generate-btn').on('click', (): void => {
            void this.generate();
        });
        this.$controlsCard.find<HTMLButtonElement>('.hbb-load-manual-btn').on('click', (): void => {
            this.loadManualSet();
        });
        this.$controlsCard.find<HTMLButtonElement>('.hbb-clear-setlist-btn').on('click', (): void => {
            SetlistStore.getInstance().clear();
            this.loadManualSet();
        });
        this.$playBtn.on('click', (): void => {
            void this.startPlayback();
        });
        this.$stopBtn.on('click', (): void => {
            this.stopPlayback();
        });
        this.$controlsCard.find<HTMLInputElement>('.hbb-master-volume').on('input', (e): void => {
            const v: number = Number.parseFloat(jQuery(e.currentTarget).val()?.toString() ?? '1');
            this.masterVolume = v;
            this.player?.setMasterVolume(v);
        });
        const $pitchLock = this.$controlsCard.find<HTMLInputElement>('.hbb-pitch-lock');
        $pitchLock.prop('checked', this.pitchLocked);
        $pitchLock.on('change', (e): void => {
            this.pitchLocked = jQuery(e.currentTarget).is(':checked');
            DjSet.savePitchLockPref(this.pitchLocked);
            this.player?.setPitchLocked(this.pitchLocked);
        });

        const wireEqBand = (band: EqBand, sliderClass: string, valueClass: string): void => {
            this.$controlsCard?.find<HTMLInputElement>(sliderClass).on('input', (e): void => {
                const db: number = Number.parseFloat(jQuery(e.currentTarget).val()?.toString() ?? '0');
                this.masterEq = {
                    lowDb: band === 'low' ? db : this.masterEq.lowDb,
                    midDb: band === 'mid' ? db : this.masterEq.midDb,
                    highDb: band === 'high' ? db : this.masterEq.highDb
                };
                this.$controlsCard?.find<HTMLSpanElement>(valueClass).text(`${db.toFixed(1)} dB`);
                this.player?.setEqGainDb(band, db);
            });
        };
        wireEqBand('low', '.hbb-master-eq-low', '.hbb-master-eq-low-val');
        wireEqBand('mid', '.hbb-master-eq-mid', '.hbb-master-eq-mid-val');
        wireEqBand('high', '.hbb-master-eq-high', '.hbb-master-eq-high-val');
        this.$controlsCard.find<HTMLButtonElement>('.hbb-master-eq-reset').on('click', (): void => {
            this.masterEq = { lowDb: 0, midDb: 0, highDb: 0 };
            this.$controlsCard?.find<HTMLInputElement>(
                '.hbb-master-eq-low, .hbb-master-eq-mid, .hbb-master-eq-high'
            ).val('0');
            this.$controlsCard?.find<HTMLSpanElement>(
                '.hbb-master-eq-low-val, .hbb-master-eq-mid-val, .hbb-master-eq-high-val'
            ).text('0 dB');
            this.player?.resetEq();
        });

        this.$controlsCard.find<HTMLInputElement>('.hbb-record-toggle').on('change', (e): void => {
            this.recordingArmed = jQuery(e.currentTarget).is(':checked');
            this.updateRecordStatus();
        });

        this.$controlsCard.find<HTMLInputElement>('.hbb-side-eq').on('input', (e): void => {
            const $el = jQuery(e.currentTarget);
            const side: EqSide = ($el.attr('data-side') ?? 'A') as EqSide;
            const band: EqBand = ($el.attr('data-band') ?? 'low') as EqBand;
            const db: number = Number.parseFloat($el.val()?.toString() ?? '0');
            const next: typeof this.sideEq[EqSide] = {
                lowDb: band === 'low' ? db : this.sideEq[side].lowDb,
                midDb: band === 'mid' ? db : this.sideEq[side].midDb,
                highDb: band === 'high' ? db : this.sideEq[side].highDb
            };
            this.sideEq = side === 'A'
                ? { A: next, B: this.sideEq.B }
                : { A: this.sideEq.A, B: next };
            this.$controlsCard
                ?.find<HTMLSpanElement>(
                    `.hbb-side-eq-val[data-side="${side}"][data-band="${band}"]`
                )
                .text(`${db.toFixed(1)} dB`);
            this.player?.setSideEqGainDb(side, band, db);
        });

        this.$controlsCard.find<HTMLButtonElement>('.hbb-side-eq-reset').on('click', (e): void => {
            const side: EqSide = (jQuery(e.currentTarget).attr('data-side') ?? 'A') as EqSide;
            const zero: typeof this.sideEq[EqSide] = { lowDb: 0, midDb: 0, highDb: 0 };
            this.sideEq = side === 'A'
                ? { A: zero, B: this.sideEq.B }
                : { A: this.sideEq.A, B: zero };
            this.$controlsCard
                ?.find<HTMLInputElement>(`.hbb-side-eq[data-side="${side}"]`)
                .val('0');
            this.$controlsCard
                ?.find<HTMLSpanElement>(`.hbb-side-eq-val[data-side="${side}"]`)
                .text('0 dB');
            this.player?.resetSideEq(side);
        });

        this.refreshActiveSide(null);

        // Now-Playing card: cover + artist/title/album header above the bare waveform deck.
        // Updated on every track change via `setNowPlaying`. When idle (no playback or in
        // between tracks) the card collapses to a neutral "—" state.
        const npRow = new ContentRow(content);
        const $npCol = jQuery<HTMLDivElement>('<div class="col-12"></div>');
        npRow.getElement().append($npCol);
        this.$nowPlayingCard = jQuery<HTMLDivElement>(`
            <div class="card hbb-now-playing">
                <div class="card-body py-2 d-flex align-items-center" style="gap:1rem;">
                    <div class="hbb-np-cover-wrap" style="flex:0 0 auto;"></div>
                    <div class="hbb-np-meta" style="flex:1 1 auto; min-width:0;">
                        <div class="small text-muted hbb-np-index">${DjSet.langOrFallback('dj_set_now_playing_idle')}</div>
                        <div class="hbb-np-title h5 mb-0 text-truncate" style="font-weight:600;">—</div>
                        <div class="hbb-np-artist text-muted small text-truncate"></div>
                        <div class="hbb-np-album text-muted small text-truncate" style="font-style:italic;"></div>
                    </div>
                </div>
            </div>
        `);
        $npCol.append(this.$nowPlayingCard);
        this.setNowPlaying(null);

        this.nowPlayingDeck = new Deck($npCol, 'NP', {
            hidePlayButton: true,
            hideEq: true,
            hideHotCues: true,
            hideLoop: true,
            hideCover: true
        });

        // Chain card
        const chainRow = new ContentRow(content);
        const chainCard = new Card(new ContentCol(chainRow, ContentColSize.col12));
        chainCard.setTitle(new LangText('tracks'));
        chainCard.getBodyElement().html(
            '<p class="text-muted m-3">Click <b>Generate</b> to plan a set.</p>'
        );
        this.$chainBody = chainCard.getBodyElement() as JQuery<HTMLDivElement>;

        // Pre-fetch the library so we can render full RouteTracks (with energyTimeline + drops)
        // into the now-playing deck on track change.
        await this.cacheLibrary();
    }

    private async cacheLibrary(): Promise<void> {
        try {
            const lib = await LibraryApi.list();
            this.libraryByPath.clear();
            for (const t of lib.tracks) {
                this.libraryByPath.set(DjSet.libraryKey(t.providerId, t.path), t);
            }
        } catch (err) {
            console.warn('DjSet page: failed to pre-fetch library:', err);
        }
    }

    /** Composite map key for `libraryByPath` — `path` alone is ambiguous across providers
     *  (e.g. two `local` providers can both contain `house/track.mp3`). */
    private static libraryKey(providerId: string, path: string): string {
        return `${providerId}|${path}`;
    }

    /**
     * Kick the async planner off, then poll `plan-status` every 500 ms until the
     * job is `done` or `error`. Surfaces progress events into the status element
     * so the user sees "evaluating start 1234 / 7518" instead of a frozen UI.
     * Resolves with the final `DjSet`; rejects on `error` state with the
     * worker's error message.
     */
    private async runPlanWithPolling(request: DjSetBody): Promise<DjSetData> {
        const initial = await DjSetApi.plan(request);
        if (initial.state === 'done' && initial.result !== undefined) {
            return initial.result;
        }
        if (initial.state === 'error') {
            throw new Error(initial.error ?? 'Unknown planner error');
        }
        // Poll. 500ms is fast enough that the user perceives progress as live;
        // beam search over 7k tracks completes in tens of seconds, so 500ms ×
        // ~60 polls = manageable network traffic.
        const POLL_INTERVAL_MS: number = 500;
        // Hard timeout — 10 minutes. Beam over a really large library can be
        // slow but anything past this is almost certainly stuck.
        const HARD_TIMEOUT_MS: number = 10 * 60 * 1000;
        const deadline: number = Date.now() + HARD_TIMEOUT_MS;
        while (Date.now() < deadline) {
            await new Promise<void>((resolve): void => {
                setTimeout(resolve, POLL_INTERVAL_MS);
            });
            const status = await DjSetApi.planStatus();
            if (status.progress !== undefined && this.$statusEl !== null) {
                this.$statusEl.text(
                    `${DjSet.langOrFallback('dj_set_status_generating')} `
                    + `(${status.progress.current.toString()} / ${status.progress.total.toString()})`,
                );
            }
            if (status.state === 'done' && status.result !== undefined) {
                return status.result;
            }
            if (status.state === 'error') {
                throw new Error(status.error ?? 'Unknown planner error');
            }
        }
        throw new Error('Planner timeout');
    }

    private async generate(): Promise<void> {
        if (this.$controlsCard === null || this.$chainBody === null || this.$statusEl === null) {
            return;
        }
        const strategy: DjSetStrategy =
            (this.$controlsCard.find<HTMLSelectElement>('.hbb-strategy').val() as DjSetStrategy) ?? 'beam';
        const direction: EnergyDirection =
            (this.$controlsCard.find<HTMLSelectElement>('.hbb-direction').val() as EnergyDirection) ?? 'up';
        const shapeRaw: string =
            this.$controlsCard.find<HTMLSelectElement>('.hbb-shape').val()?.toString() ?? '';
        const shape: EnergyShape | undefined =
            shapeRaw === 'rising' || shapeRaw === 'arc' || shapeRaw === 'descending'
                ? shapeRaw
                : undefined;
        const beamWidthRaw: string =
            this.$controlsCard.find<HTMLInputElement>('.hbb-beam-width').val()?.toString() ?? '8';
        const beamWidth: number = Number.parseInt(beamWidthRaw, 10);

        const request: DjSetBody = {
            strategy: strategy,
            energyDirection: direction,
            beamWidth: Number.isFinite(beamWidth) && beamWidth > 0 ? beamWidth : 8
        };
        if (shape !== undefined) {
            request.energyShape = shape;
        }

        const targetMinRaw: string =
            this.$controlsCard.find<HTMLInputElement>('.hbb-target-duration').val()?.toString() ?? '';
        const targetMin: number = Number.parseFloat(targetMinRaw);
        if (Number.isFinite(targetMin) && targetMin > 0) {
            request.targetDurationSec = targetMin * 60;
        }
        request.style = TransitionStyleStore.getInstance().get();
        const avoidSameArtist: boolean =
            this.$controlsCard.find<HTMLInputElement>('.hbb-avoid-same-artist').is(':checked');
        if (avoidSameArtist) {
            request.avoidSameArtist = true;
        }

        this.$statusEl.text(DjSet.langOrFallback('dj_set_status_generating'));
        let djSet: DjSetData;
        try {
            djSet = await this.runPlanWithPolling(request);
        } catch (err) {
            this.$statusEl.html(
                `<span class="text-danger">${DjSet.langOrFallback('dj_set_status_generate_failed')}: ${
                    err instanceof Error ? err.message : String(err)
                }</span>`
            );
            return;
        }
        this.currentSet = djSet;
        const shapeNote: string = djSet.energyShape !== undefined
            ? `, shape=${djSet.energyShape}`
            : '';
        this.$statusEl.text(
            `${DjSet.langOrFallback('dj_set_status_set_with')} ${djSet.tracks.length} ${DjSet.langOrFallback('dj_set_status_tracks')} (${djSet.transitions.length} ${DjSet.langOrFallback('dj_set_status_transitions')}, ${djSet.skipped.length} ${DjSet.langOrFallback('dj_set_status_skipped')}, direction=${djSet.energyDirection}${shapeNote}).`
        );
        this.$playBtn?.prop('disabled', djSet.tracks.length === 0);
        this.renderChain(djSet, false);
    }

    private loadManualSet(): void {
        if (this.$chainBody === null || this.$statusEl === null) {
            return;
        }
        const store: SetlistStore = SetlistStore.getInstance();
        const djSet: DjSetData | null = store.toDjSet();
        if (djSet === null) {
            this.currentSet = null;
            this.$playBtn?.prop('disabled', true);
            const reason: string = store.size() === 0
                ? DjSet.langOrFallback('dj_set_setlist_empty')
                : DjSet.langOrFallback('dj_set_setlist_discontinuous');
            this.$chainBody.empty();
            this.$chainBody.html(`<p class="text-muted m-3">${reason}</p>`);
            this.$statusEl.text(DjSet.langOrFallback('dj_set_manual_not_playable'));
            return;
        }
        this.currentSet = djSet;
        this.$statusEl.text(
            `${DjSet.langOrFallback('dj_set_manual_setlist')}: ${djSet.tracks.length} ${DjSet.langOrFallback('dj_set_status_tracks')}, ${djSet.transitions.length} ${DjSet.langOrFallback('dj_set_status_transitions')}.`
        );
        this.$playBtn?.prop('disabled', false);
        this.renderChain(djSet, true);
    }

    private renderChain(djSet: DjSetData, manual: boolean): void {
        if (this.$chainBody === null) {
            return;
        }
        this.$chainBody.empty();

        if (djSet.tracks.length === 0) {
            this.$chainBody.html(`<p class="text-muted m-3">${DjSet.langOrFallback('dj_set_status_empty')}</p>`);
            return;
        }

        // Stash for chunked rendering — `renderMoreChainRows` reads from these.
        this.chainTracks = djSet.tracks;
        this.chainTransitions = djSet.transitions;
        this.chainManual = manual;
        this.renderedChainCount = 0;

        const table = new Table(this.$chainBody);
        table.setStyleHover(true);
        table.setStyleStriped(true);

        const trhead = new Tr(table.getThead());
        // eslint-disable-next-line no-new
        new Th(trhead, new ColumnContent([new LangText('chain_index')]));
        // eslint-disable-next-line no-new
        new Th(trhead, new ColumnContent([new LangText('cover')]));
        // eslint-disable-next-line no-new
        new Th(trhead, new ColumnContent([new LangText('chain_track')]));
        // eslint-disable-next-line no-new
        new Th(trhead, new ColumnContent([new LangText('camelot')]));
        // eslint-disable-next-line no-new
        new Th(trhead, new ColumnContent([new LangText('bpm')]));
        // eslint-disable-next-line no-new
        new Th(trhead, new ColumnContent([new LangText('energy')]));
        // eslint-disable-next-line no-new
        new Th(trhead, new ColumnContent([new LangText('chain_pitch')]));
        // eslint-disable-next-line no-new
        new Th(trhead, new ColumnContent([new LangText('chain_keymatch')]));
        // eslint-disable-next-line no-new
        new Th(trhead, new ColumnContent([new LangText('chain_alignment')]));
        // eslint-disable-next-line no-new
        new Th(trhead, new ColumnContent([new LangText('chain_bars')]));
        // Action column — always present now (deactivate button); the manual
        // setlist path adds a remove-from-setlist button on top of that.
        // eslint-disable-next-line no-new
        new Th(trhead, '');

        // Render the first chunk, then install a scroll listener for the rest.
        // For typical 10-50 track chains this renders everything in the first
        // chunk; for big beam-search chains (200+) chunking saves the browser.
        // bambooo's `getTbody` returns a JQuery wrapper despite the
        // `HTMLTableSectionElement` annotation — unwrap to the raw DOM node.
        const tbodyJq = table.getTbody() as unknown as JQuery<HTMLTableSectionElement>;
        const tbody: HTMLTableSectionElement = tbodyJq[0] as HTMLTableSectionElement;
        this.renderMoreChainRows(tbody);
        this.installChainInfiniteScroll(tbody);

        if (djSet.tracks.length >= 2) {
            this.$chainBody.append(DjSet.renderEnergyChart(djSet));
        }
    }

    /** Append the next `CHAIN_CHUNK_SIZE` chain rows. Reads `chainTracks` /
     *  `chainTransitions` / `chainManual` set by `renderChain`. */
    private renderMoreChainRows(tbody: HTMLTableSectionElement): void {
        const end: number = Math.min(
            this.renderedChainCount + DjSet.CHAIN_CHUNK_SIZE,
            this.chainTracks.length,
        );
        for (let i = this.renderedChainCount; i < end; i++) {
            const track = this.chainTracks[i];
            if (track === undefined) {
                continue;
            }
            const transition = i < this.chainTransitions.length ? this.chainTransitions[i] : undefined;
            tbody.appendChild(this.buildChainRow(track, transition, i));
        }
        this.renderedChainCount = end;
    }

    private buildChainRow(
        track: DjSetData['tracks'][number],
        transition: DjSetData['transitions'][number] | undefined,
        index: number,
    ): HTMLTableRowElement {
        const tr: HTMLTableRowElement = document.createElement('tr');
        tr.setAttribute('data-row-index', index.toString());
        const fullTrack: RouteTrack | undefined = this.libraryByPath.get(
            DjSet.libraryKey(track.providerId, track.path),
        );
        const displayTrack: RouteTrack = fullTrack ?? DjSet.routeTrackStub(track);
        if (displayTrack.disabled) {
            tr.className = 'text-muted';
        }
        const filename: string = TrackDisplayUtil.filenameOf(track.path);
        const td = (html: string): HTMLTableCellElement => {
            const c: HTMLTableCellElement = document.createElement('td');
            c.innerHTML = html;
            return c;
        };
        tr.appendChild(td((index + 1).toString()));
        tr.appendChild(td(TrackDisplayUtil.coverThumbHtml(displayTrack)));
        tr.appendChild(td(TrackDisplayUtil.trackCellHtml(displayTrack, filename)));
        tr.appendChild(td(`<span class="badge badge-info">${track.camelot}</span>`));
        tr.appendChild(td(track.bpm.toFixed(1)));
        tr.appendChild(td(track.energy.toFixed(3)));
        if (transition !== undefined) {
            const sign: string = transition.to.pitchPercent >= 0 ? '+' : '';
            tr.appendChild(td(`${sign}${transition.to.pitchPercent.toFixed(2)}%`));
            tr.appendChild(td(transition.keyMatch));
            tr.appendChild(td(transition.alignment));
            tr.appendChild(td(transition.mixBars.toFixed(1)));
        } else {
            tr.appendChild(td('—'));
            tr.appendChild(td('—'));
            tr.appendChild(td('—'));
            tr.appendChild(td('—'));
        }
        // Action column: deactivate-track button always; remove-from-setlist
        // button only on manual mode + transition rows.
        const disabledIcon: string = displayTrack.disabled ? 'fa-toggle-off' : 'fa-toggle-on';
        const disabledTitle: string = displayTrack.disabled
            ? DjSet.langOrFallback('library_track_enable')
            : DjSet.langOrFallback('library_track_disable');
        const removeBtn: string = this.chainManual && index < this.chainTransitions.length
            ? `<button type="button" class="btn btn-xs btn-danger ml-1 hbb-remove-transition" title="${DjSet.langOrFallback('dj_set_remove_transition')}"><i class="fas fa-times"></i></button>`
            : '';
        const actionTd: HTMLTableCellElement = document.createElement('td');
        actionTd.innerHTML = `
            <button type="button" class="btn btn-xs btn-default hbb-toggle-disabled" title="${disabledTitle}">
                <i class="fas ${disabledIcon}"></i>
            </button>${removeBtn}
        `;
        const $actions = jQuery(actionTd);
        $actions.find<HTMLButtonElement>('.hbb-toggle-disabled').on('click', (): void => {
            void this.toggleChainTrackDisabled(track, displayTrack, tr);
        });
        if (this.chainManual && index < this.chainTransitions.length) {
            $actions.find<HTMLButtonElement>('.hbb-remove-transition').on('click', (): void => {
                SetlistStore.getInstance().removeAt(index);
            });
        }
        tr.appendChild(actionTd);
        return tr;
    }

    /** Same shape as `Library.toggleTrackDisabled` — POST to the disable
     *  endpoint, optimistic UI flip, revert on error. The cached `RouteTrack`
     *  in `libraryByPath` is mutated so subsequent re-renders show the new
     *  state without a fresh `LibraryApi.list()` call. */
    private async toggleChainTrackDisabled(
        track: DjSetData['tracks'][number],
        displayTrack: RouteTrack,
        row: HTMLTableRowElement,
    ): Promise<void> {
        const previous: boolean = displayTrack.disabled;
        const next: boolean = !previous;
        displayTrack.disabled = next;
        row.classList.toggle('text-muted', next);
        const $btn = jQuery(row).find<HTMLElement>('.hbb-toggle-disabled i');
        $btn.removeClass('fa-toggle-on fa-toggle-off')
            .addClass(next ? 'fa-toggle-off' : 'fa-toggle-on');
        try {
            await TracksApi.setDisabled({
                providerId: track.providerId,
                path: track.path,
                disabled: next,
            });
        } catch (err) {
            console.error('DjSet: setDisabled failed, reverting:', err);
            displayTrack.disabled = previous;
            row.classList.toggle('text-muted', previous);
            $btn.removeClass('fa-toggle-on fa-toggle-off')
                .addClass(previous ? 'fa-toggle-off' : 'fa-toggle-on');
        }
    }

    private installChainInfiniteScroll(tbody: HTMLTableSectionElement): void {
        if (this.chainScrollHandler !== null) {
            window.removeEventListener('scroll', this.chainScrollHandler);
        }
        this.chainScrollHandler = (): void => {
            if (this.renderedChainCount >= this.chainTracks.length) {
                return;
            }
            const rect: DOMRect = tbody.getBoundingClientRect();
            if (rect.bottom - window.innerHeight < 500) {
                this.renderMoreChainRows(tbody);
            }
        };
        window.addEventListener('scroll', this.chainScrollHandler, { passive: true });
    }

    /**
     * SVG line chart of the chain's per-track energy. When `djSet.energyShape` is set, the
     * matching ideal curve is drawn underneath (dashed, light grey) so the user can eyeball
     * how well the actual walk follows the requested trajectory. Pool-relative energy bounds
     * are pulled from the actual chain (min/max across the picked tracks); for a more
     * library-relative view we'd need the full library handed in, but that's overkill for a
     * sanity check.
     */
    private static renderEnergyChart(djSet: DjSetData): JQuery<HTMLDivElement> {
        const energies: number[] = djSet.tracks.map((t): number => t.energy);
        if (energies.length < 2) {
            return jQuery<HTMLDivElement>('<div></div>');
        }
        const eMin: number = Math.min(...energies);
        const eMax: number = Math.max(...energies);
        const span: number = eMax - eMin || 1;

        const width: number = 560;
        const height: number = 140;
        const marginX: number = 24;
        const marginY: number = 16;
        const innerW: number = width - marginX * 2;
        const innerH: number = height - marginY * 2;
        const xAt = (i: number): number => marginX + (i / (energies.length - 1)) * innerW;
        const yAt = (norm: number): number => marginY + (1 - norm) * innerH;

        const actualPoints: string = energies.map((e: number, i: number): string => {
            const norm: number = (e - eMin) / span;
            return `${xAt(i).toFixed(1)},${yAt(norm).toFixed(1)}`;
        }).join(' ');

        const dots: string = energies.map((e: number, i: number): string => {
            const norm: number = (e - eMin) / span;
            return `<circle cx="${xAt(i).toFixed(1)}" cy="${yAt(norm).toFixed(1)}" r="3.5" fill="#0d6efd"></circle>`;
        }).join('');

        const labels: string = energies.map((e: number, i: number): string => {
            const norm: number = (e - eMin) / span;
            const y: number = yAt(norm) - 8;
            return `<text x="${xAt(i).toFixed(1)}" y="${y.toFixed(1)}" font-size="9" fill="#6c757d" text-anchor="middle">${e.toFixed(2)}</text>`;
        }).join('');

        const trackTicks: string = energies.map((_e: number, i: number): string => {
            const x: number = xAt(i);
            return `<line x1="${x.toFixed(1)}" y1="${(height - marginY).toFixed(1)}" x2="${x.toFixed(1)}" y2="${(height - marginY + 4).toFixed(1)}" stroke="#adb5bd" stroke-width="1"></line>
                    <text x="${x.toFixed(1)}" y="${(height - marginY + 14).toFixed(1)}" font-size="9" fill="#6c757d" text-anchor="middle">${(i + 1).toString()}</text>`;
        }).join('');

        let idealPath: string = '';
        let idealLegend: string = '';
        const shape: string | undefined = djSet.energyShape;
        if (shape === 'rising' || shape === 'arc' || shape === 'descending') {
            const samples: number = 32;
            const points: string[] = [];
            for (let s = 0; s < samples; s++) {
                const t: number = s / (samples - 1);
                let norm: number;
                if (shape === 'rising') {
                    norm = t;
                } else if (shape === 'descending') {
                    norm = 1 - t;
                } else {
                    norm = t <= 0.5 ? t * 2 : (1 - t) * 2;
                }
                const x: number = marginX + t * innerW;
                points.push(`${x.toFixed(1)},${yAt(norm).toFixed(1)}`);
            }
            idealPath = `<polyline points="${points.join(' ')}" fill="none" stroke="#adb5bd" stroke-width="1.5" stroke-dasharray="4,3"></polyline>`;
            idealLegend = `
                <span class="ml-3 small text-muted d-inline-flex align-items-center">
                    <svg width="20" height="6" class="mr-1"><line x1="0" y1="3" x2="20" y2="3" stroke="#adb5bd" stroke-width="1.5" stroke-dasharray="4,3"></line></svg>
                    ${DjSet.langOrFallback('chart_ideal')} (${shape})
                </span>
            `;
        }

        const $wrap: JQuery<HTMLDivElement> = jQuery<HTMLDivElement>(`
            <div class="hbb-energy-chart mt-3 px-3 pb-3">
                <h5 class="mb-2 small text-uppercase text-muted">
                    <i class="fas fa-chart-line mr-1"></i>${DjSet.langOrFallback('chart_title')}
                </h5>
                <svg viewBox="0 0 ${width.toString()} ${height.toString()}" preserveAspectRatio="xMidYMid meet"
                     style="width:100%; max-width:${width.toString()}px; height:auto; border:1px solid #e9ecef; border-radius:4px; background:#fafafa;">
                    <line x1="${marginX.toString()}" y1="${(height - marginY).toString()}" x2="${(width - marginX).toString()}" y2="${(height - marginY).toString()}" stroke="#dee2e6" stroke-width="1"></line>
                    ${idealPath}
                    <polyline points="${actualPoints}" fill="none" stroke="#0d6efd" stroke-width="2"></polyline>
                    ${dots}
                    ${labels}
                    ${trackTicks}
                </svg>
                <div class="small mt-1">
                    <span class="text-muted d-inline-flex align-items-center">
                        <svg width="20" height="6" class="mr-1"><line x1="0" y1="3" x2="20" y2="3" stroke="#0d6efd" stroke-width="2"></line></svg>
                        ${DjSet.langOrFallback('chart_actual')}
                    </span>
                    ${idealLegend}
                </div>
            </div>
        `);
        return $wrap;
    }

    private async startPlayback(): Promise<void> {
        if (this.currentSet === null) {
            return;
        }
        if (this.player !== null) {
            await this.player.dispose();
        }
        this.player = new AutoPlayer(this.masterVolume, this.masterEq, this.sideEq, this.pitchLocked);
        if (this.recordingArmed) {
            try {
                this.player.startRecording();
                this.updateRecordStatus();
            } catch (err) {
                console.warn('DjSet: failed to arm recording:', err);
            }
        }
        this.clearLastRecording();
        this.$playBtn?.prop('disabled', true);
        this.$stopBtn?.prop('disabled', false);
        this.$statusEl?.text(DjSet.langOrFallback('dj_set_status_loading_audio'));

        try {
            const total: number = this.currentSet.tracks.length;
            await this.player.play(
                this.currentSet,
                (index: number, providerId: string, path: string): void => {
                    this.currentNowPlayingIndex = index;
                    this.highlightRow(index);
                    const fullTrack: RouteTrack | undefined = this.libraryByPath.get(DjSet.libraryKey(providerId, path));
                    const filename: string = TrackDisplayUtil.filenameOf(path);
                    const display: string = DjSet.formatNowPlayingDisplay(fullTrack, filename);
                    this.$statusEl?.html(
                        `<span class="text-success">${DjSet.langOrFallback('dj_set_status_now_playing')} #${(index + 1).toString()}: ${TrackDisplayUtil.escape(display)}</span>`
                    );
                    if (fullTrack !== undefined) {
                        this.nowPlayingDeck?.setTrack(fullTrack);
                    }
                    this.setNowPlaying(fullTrack ?? null, index, total, filename);
                    this.refreshActiveSide(index);
                },
                (): void => {
                    this.$statusEl?.html(
                        `<span class="text-success">${DjSet.langOrFallback('dj_set_status_finished')}</span>`
                    );
                    this.$playBtn?.prop('disabled', false);
                    this.$stopBtn?.prop('disabled', true);
                    this.clearHighlight();
                    this.currentNowPlayingIndex = -1;
                    this.setNowPlaying(null);
                    this.refreshActiveSide(null);
                    void this.finalizeRecording();
                },
                (index: number, trackTime: number): void => {
                    if (index === this.currentNowPlayingIndex) {
                        this.nowPlayingDeck?.syncToTime(trackTime);
                    }
                }
            );
        } catch (err) {
            this.$statusEl?.html(
                `<span class="text-danger">${DjSet.langOrFallback('dj_set_status_playback_failed')}: ${
                    err instanceof Error ? err.message : String(err)
                }</span>`
            );
            this.$playBtn?.prop('disabled', false);
            this.$stopBtn?.prop('disabled', true);
        }
    }

    private stopPlayback(): void {
        if (this.player !== null) {
            this.player.stop();
        }
        this.$playBtn?.prop('disabled', this.currentSet === null);
        this.$stopBtn?.prop('disabled', true);
        this.$statusEl?.text(DjSet.langOrFallback('dj_set_status_stopped'));
        this.clearHighlight();
        this.setNowPlaying(null);
        this.refreshActiveSide(null);
        void this.finalizeRecording();
    }

    /**
     * Repaint the now-playing card. Pass `null` for `track` to reset to the idle state — used
     * before playback starts, on stop, and after the set finishes. When a track *is* playing,
     * the card shows cover (or fa-music placeholder), index "n / total", title, artist, album.
     */
    private setNowPlaying(
        track: RouteTrack | null,
        index?: number | null,
        total?: number | null,
        filename?: string,
    ): void {
        if (this.$nowPlayingCard === null) {
            return;
        }
        const $cover = this.$nowPlayingCard.find<HTMLDivElement>('.hbb-np-cover-wrap');
        const $index = this.$nowPlayingCard.find<HTMLDivElement>('.hbb-np-index');
        const $title = this.$nowPlayingCard.find<HTMLDivElement>('.hbb-np-title');
        const $artist = this.$nowPlayingCard.find<HTMLDivElement>('.hbb-np-artist');
        const $album = this.$nowPlayingCard.find<HTMLDivElement>('.hbb-np-album');

        if (track === null) {
            $cover.html(DjSet.nowPlayingCoverHtml(null));
            $index.text(DjSet.langOrFallback('dj_set_now_playing_idle'));
            $title.text('—');
            $artist.text('');
            $album.text('');
            return;
        }

        const fname: string = filename ?? TrackDisplayUtil.filenameOf(track.path);
        const meta = track.metadata;
        const title: string = meta?.title ?? fname;
        const artist: string = meta?.artist ?? '';
        const album: string = meta?.album ?? '';

        $cover.html(DjSet.nowPlayingCoverHtml(track));
        if (index !== undefined && index !== null && total !== undefined && total !== null) {
            const label: string = DjSet.langOrFallback('dj_set_now_playing_index');
            $index.text(`${label} ${(index + 1).toString()} / ${total.toString()}`);
        } else {
            $index.text('');
        }
        $title.text(title);
        $artist.text(artist);
        $album.text(album);
    }

    /** Bigger cover (80×80) for the now-playing card; falls back to a fa-music placeholder. */
    private static nowPlayingCoverHtml(track: RouteTrack | null): string {
        const size: number = 80;
        const sz: string = size.toString();
        if (track !== null && track.hasCover) {
            return `<img src="${TrackDisplayUtil.coverUrl(track)}" alt="" style="width:${sz}px;height:${sz}px;object-fit:cover;border-radius:4px;">`;
        }
        return `<span class="d-inline-flex align-items-center justify-content-center text-muted" style="width:${sz}px;height:${sz}px;border-radius:4px;background:#e9ecef;font-size:1.5rem;"><i class="fas fa-music"></i></span>`;
    }

    /**
     * Synthetic minimal `RouteTrack` for chain entries we couldn't look up in the cached
     * library. Used purely to satisfy the `TrackDisplayUtil` shape — no metadata, no cover —
     * so the chain row still renders cleanly with the filename fallback.
     */
    private static routeTrackStub(t: DjSetData['tracks'][number]): RouteTrack {
        return {
            providerId: t.providerId,
            path: t.path,
            camelot: t.camelot,
            openKey: '',
            bpm: t.bpm,
            energy: t.energy,
            durationSec: t.durationSec,
            drops: [],
            energyTimeline: [],
            beats: [],
            hasCover: false,
            disabled: false,
        };
    }

    /** Single-line status text: "Artist — Title" if metadata, otherwise filename. */
    private static formatNowPlayingDisplay(track: RouteTrack | undefined, filename: string): string {
        const meta = track?.metadata;
        const title: string | undefined = meta?.title;
        const artist: string | undefined = meta?.artist;
        if (title !== undefined && artist !== undefined) {
            return `${artist} — ${title}`;
        }
        if (title !== undefined) {
            return title;
        }
        return filename;
    }

    /**
     * Toggles the "● active" badge on each side EQ row to indicate which side is currently
     * audible (`null` while idle). Side A = even track indices, Side B = odd indices.
     */
    private refreshActiveSide(trackIndex: number | null): void {
        if (this.$controlsCard === null) {
            return;
        }
        const activeSide: EqSide | null = trackIndex === null
            ? null
            : trackIndex % 2 === 0
                ? 'A'
                : 'B';
        for (const side of ['A', 'B'] as const) {
            const $badge = this.$controlsCard.find<HTMLSpanElement>(
                `.hbb-side-row[data-side="${side}"] .hbb-side-active`
            );
            const isActive: boolean = activeSide === side;
            $badge.toggleClass('badge-success', isActive);
            $badge.toggleClass('badge-secondary', !isActive);
            $badge.css('visibility', isActive ? 'visible' : 'hidden');
        }
    }

    private async finalizeRecording(): Promise<void> {
        if (this.player === null || !this.player.isRecording()) {
            this.updateRecordStatus();
            return;
        }
        let recorded: Blob | null;
        try {
            recorded = await this.player.stopRecording();
        } catch (err) {
            console.error('DjSet: stopRecording failed:', err);
            this.updateRecordStatus();
            return;
        }
        if (recorded === null) {
            this.updateRecordStatus();
            return;
        }
        this.clearLastRecording();
        this.isTranscoding = true;
        this.updateRecordStatus();
        let mp3: Blob;
        try {
            mp3 = await TranscodeApi.toMp3(recorded);
        } catch (err) {
            console.error('DjSet: transcode failed:', err);
            const message: string = err instanceof Error ? err.message : String(err);
            this.$controlsCard?.find<HTMLSpanElement>('.hbb-download-link').html(
                `<span class="text-danger">${DjSet.langOrFallback('dj_set_recording_transcode_failed')}: ${message}</span>`
            );
            this.isTranscoding = false;
            this.updateRecordStatus();
            return;
        }
        this.isTranscoding = false;
        const url: string = URL.createObjectURL(mp3);
        this.lastRecordingUrl = url;
        const filename: string = `headbangbear-set-${DjSet.timestamp()}.mp3`;
        const sizeMb: string = (mp3.size / (1024 * 1024)).toFixed(1);
        this.$controlsCard?.find<HTMLSpanElement>('.hbb-download-link').html(
            `<a href="${url}" download="${filename}" class="text-primary">
                <i class="fas fa-download mr-1"></i>${filename} (${sizeMb} MB)
            </a>`
        );
        this.updateRecordStatus();
    }

    private clearLastRecording(): void {
        if (this.lastRecordingUrl !== null) {
            URL.revokeObjectURL(this.lastRecordingUrl);
            this.lastRecordingUrl = null;
        }
        this.$controlsCard?.find<HTMLSpanElement>('.hbb-download-link').empty();
    }

    private updateRecordStatus(): void {
        const $status = this.$controlsCard?.find<HTMLSpanElement>('.hbb-record-status');
        if ($status === undefined) {
            return;
        }
        if (this.player !== null && this.player.isRecording()) {
            $status.html(`<span class="text-danger">${DjSet.langOrFallback('dj_set_recording_active')}</span>`);
            return;
        }
        if (this.isTranscoding) {
            $status.html(`<span class="text-warning">${DjSet.langOrFallback('dj_set_recording_transcoding')}</span>`);
            return;
        }
        if (this.recordingArmed) {
            $status.text(DjSet.langOrFallback('dj_set_recording_armed'));
            return;
        }
        $status.text('');
    }

    private static timestamp(): string {
        const now: Date = new Date();
        const pad = (n: number): string => n.toString().padStart(2, '0');
        return `${now.getFullYear().toString()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    }

    private highlightRow(index: number): void {
        if (this.$chainBody === null) {
            return;
        }
        this.$chainBody.find('tr[data-row-index]').removeClass('table-success');
        this.$chainBody.find(`tr[data-row-index="${index.toString()}"]`).addClass('table-success');
    }

    private clearHighlight(): void {
        if (this.$chainBody === null) {
            return;
        }
        this.$chainBody.find('tr[data-row-index]').removeClass('table-success');
    }

    /**
     * Bilingual fallback used inside HTML literals built during `loadContent`. Identical to
     * the per-page-load `Lang.lAll()` re-translation, except this resolves the string at
     * build-time so we can interpolate it into the template.
     */
    private static loadPitchLockPref(): boolean {
        try {
            return localStorage.getItem('hbb.autoplayer-pitch-lock.v1') === 'true';
        } catch {
            return false;
        }
    }

    private static savePitchLockPref(locked: boolean): void {
        try {
            localStorage.setItem('hbb.autoplayer-pitch-lock.v1', locked ? 'true' : 'false');
        } catch {
            // ignored
        }
    }

    private static langOrFallback(key: string): string {
        return Lang.i().l(key) ?? key;
    }

    /**
     * Draws the energy-curve preview into the inline SVG. `null` shape clears the curve and
     * shows a neutral baseline. The viewBox is 56×28 and the polyline is generated with 12
     * sample points spread across that width, mapped to the matching `idealEnergyAt`
     * trajectory (0→eMin at the top of the SVG, 1→eMax at the bottom).
     */
    private static drawShapePreview(
        $controlsCard: JQuery<HTMLDivElement> | null,
        shape: 'rising' | 'arc' | 'descending' | null,
    ): void {
        if ($controlsCard === null) {
            return;
        }
        const $poly: JQuery<SVGElement> = $controlsCard.find<SVGElement>('.hbb-shape-curve');
        if ($poly.length === 0) {
            return;
        }
        if (shape === null) {
            $poly.attr('points', '4,14 52,14');
            $poly.attr('stroke', '#adb5bd');
            return;
        }
        const samples: number = 24;
        const margin: number = 4;
        const width: number = 56 - margin * 2;
        const height: number = 28 - margin * 2;
        const yAt = (norm: number): number => margin + (1 - norm) * height;
        const points: string[] = [];
        for (let i = 0; i < samples; i++) {
            const t: number = i / (samples - 1);
            let norm: number;
            if (shape === 'rising') {
                norm = t;
            } else if (shape === 'descending') {
                norm = 1 - t;
            } else {
                norm = t <= 0.5 ? t * 2 : (1 - t) * 2;
            }
            const x: number = margin + t * width;
            points.push(`${x.toFixed(1)},${yAt(norm).toFixed(1)}`);
        }
        $poly.attr('points', points.join(' '));
        $poly.attr('stroke', '#0d6efd');
    }

}