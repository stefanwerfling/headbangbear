import {
    Card,
    ColumnContent,
    ContentCol,
    ContentColSize,
    ContentRow,
    Lang,
    LangText,
    Table,
    Td,
    Th,
    Tr
} from 'bambooo';
import { LibraryApi } from '../Api/LibraryApi.js';
import { MixApi } from '../Api/MixApi.js';
import {
    type DjSet,
    type LibraryResponse,
    type RouteTrack,
    type TransitionPlan,
} from '@headbangbear/schemas';
import { CamelotUtil } from '../Util/CamelotUtil.js';
import { TrackDisplayUtil } from '../Util/TrackDisplayUtil.js';
import { AutoPlayer } from '../Widget/AutoPlayer.js';
import { Deck } from '../Widget/Deck.js';
import { SetlistStore } from '../Widget/SetlistStore.js';
import { TransitionStyleStore } from '../Widget/TransitionStyleStore.js';
import { BasePage } from './BasePage.js';

/**
 * DJ-mixer-style Library page. Two `Deck`s side by side at the top (with waveforms,
 * drop markers, play/pause); a "Plan Mix" toolbar with Play-Transition + Add-to-Setlist
 * actions; a track-list table at the bottom that loads any track into Deck A or B with a
 * single click.
 */
export class Library extends BasePage {

    protected override _name: string = 'library';

    private deckA: Deck | null = null;

    private deckB: Deck | null = null;

    private tracksCard: Card | null = null;

    private $tracksTbody: JQuery<HTMLTableSectionElement> | null = null;

    private $searchInput: JQuery<HTMLInputElement> | null = null;

    private $compatibleToggle: JQuery<HTMLInputElement> | null = null;

    private $bpmMin: JQuery<HTMLInputElement> | null = null;

    private $bpmMax: JQuery<HTMLInputElement> | null = null;

    private $energyMin: JQuery<HTMLInputElement> | null = null;

    private $energyMax: JQuery<HTMLInputElement> | null = null;

    private $yearMin: JQuery<HTMLInputElement> | null = null;

    private $yearMax: JQuery<HTMLInputElement> | null = null;

    private $genreSelect: JQuery<HTMLSelectElement> | null = null;

    private $filterCount: JQuery<HTMLSpanElement> | null = null;

    private sortKey: string | null = null;

    private sortDir: 'asc' | 'desc' = 'asc';

    private activeDeck: 'A' | 'B' = 'A';

    private keydownHandler: ((e: KeyboardEvent) => void) | null = null;

    private $planMixBtn: JQuery<HTMLButtonElement> | null = null;

    private $playTransitionBtn: JQuery<HTMLButtonElement> | null = null;

    private $stopTransitionBtn: JQuery<HTMLButtonElement> | null = null;

    private $addSetlistBtn: JQuery<HTMLButtonElement> | null = null;

    private $setlistCount: JQuery<HTMLSpanElement> | null = null;

    private masterVolume: number = 0.85;

    private $planNotes: JQuery<HTMLDivElement> | null = null;

    private currentPlan: TransitionPlan | null = null;

    private currentFromTrack: RouteTrack | null = null;

    private currentToTrack: RouteTrack | null = null;

    private transitionPlayer: AutoPlayer | null = null;

    private unsubscribeSetlist: (() => void) | null = null;

    public constructor() {
        super();
        this.setTitle(new LangText('library'));
    }

    public override async unloadContent(): Promise<void> {
        if (this.transitionPlayer !== null) {
            await this.transitionPlayer.dispose();
            this.transitionPlayer = null;
        }
        if (this.unsubscribeSetlist !== null) {
            this.unsubscribeSetlist();
            this.unsubscribeSetlist = null;
        }
        if (this.keydownHandler !== null) {
            window.removeEventListener('keydown', this.keydownHandler);
            this.keydownHandler = null;
        }
    }

    public override async loadContent(): Promise<void> {
        const content = this.getContent();
        content.empty();

        // Help card (collapsible, collapsed by default) -----------------------------------------
        const helpRow = new ContentRow(content);
        const helpCol = new ContentCol(helpRow, ContentColSize.col12);
        const helpTitle: string = Library.lang('library_help_title');
        const helpBody: string = Library.lang('library_help_body');
        const $helpCard: JQuery<HTMLDivElement> = jQuery<HTMLDivElement>(`
            <div class="card card-info card-outline collapsed-card">
                <div class="card-header">
                    <h3 class="card-title">
                        <i class="fas fa-info-circle mr-1"></i>${helpTitle}
                    </h3>
                    <div class="card-tools">
                        <button type="button" class="btn btn-tool" data-card-widget="collapse"><i class="fas fa-plus"></i></button>
                    </div>
                </div>
                <div class="card-body" style="display:none;">
                    <p class="mb-0">${helpBody}</p>
                </div>
            </div>
        `);
        helpCol.getElement().append($helpCard);

        // Decks row -----------------------------------------------------------------------------
        const decksRow = new ContentRow(content);

        const $deckACol = jQuery<HTMLDivElement>('<div class="col-md-6"></div>');
        const $deckBCol = jQuery<HTMLDivElement>('<div class="col-md-6"></div>');
        decksRow.getElement().append($deckACol).append($deckBCol);

        this.deckA = new Deck($deckACol, 'A');
        this.deckB = new Deck($deckBCol, 'B');
        this.setActiveDeck('A');
        this.deckA.getCardElement().on('mousedown', (): void => {
            this.setActiveDeck('A');
        });
        this.deckB.getCardElement().on('mousedown', (): void => {
            this.setActiveDeck('B');
        });
        this.installKeyboardShortcuts();

        // Plan-Mix toolbar between decks --------------------------------------------------------
        const toolbarRow = new ContentRow(content);
        const toolbarCol = new ContentCol(toolbarRow, ContentColSize.col12);
        const $toolbarCard = jQuery<HTMLDivElement>(`
            <div class="card">
                <div class="card-body py-2">
                    <button type="button" class="btn btn-primary btn-sm hbb-plan-mix-btn" disabled>
                        <i class="fas fa-magic mr-1"></i> ${Library.lang('library_plan_mix')}
                    </button>
                    <button type="button" class="btn btn-success btn-sm ml-2 hbb-play-transition-btn" disabled>
                        <i class="fas fa-play mr-1"></i> ${Library.lang('library_play_transition')}
                    </button>
                    <button type="button" class="btn btn-danger btn-sm ml-1 hbb-stop-transition-btn" disabled>
                        <i class="fas fa-stop"></i>
                    </button>
                    <button type="button" class="btn btn-info btn-sm ml-2 hbb-add-setlist-btn" disabled>
                        <i class="fas fa-plus mr-1"></i> ${Library.lang('library_add_setlist')}
                    </button>
                    <button type="button" class="btn btn-default btn-sm ml-2 hbb-clear-cues-btn">
                        ${Library.lang('library_clear_cues')}
                    </button>
                    <span class="ml-3 text-muted small">
                        ${Library.lang('library_setlist_label')}: <span class="hbb-setlist-count">0</span> ${Library.lang('library_setlist_entries')}
                    </span>
                    <span class="ml-3 d-inline-flex align-items-center small">
                        <i class="fas fa-volume-up text-muted mr-1"></i>
                        <input type="range" class="hbb-master-volume" min="0" max="1" step="0.01" value="0.85" style="width:120px;">
                    </span>
                    <span class="ml-3 d-inline-flex align-items-center small">
                        <label class="mb-0 mr-2 text-muted">${Library.lang('transition_style_label')}:</label>
                        <select class="form-control form-control-sm hbb-style" style="width:auto; display:inline-block;">
                            <option value="drop-on-drop">${Library.lang('transition_style_drop_on_drop')}</option>
                            <option value="tail-out">${Library.lang('transition_style_tail_out')}</option>
                            <option value="early-cut">${Library.lang('transition_style_early_cut')}</option>
                            <option value="bar-match">${Library.lang('transition_style_bar_match')}</option>
                        </select>
                    </span>
                    <span class="ml-3 text-muted hbb-plan-summary"></span>
                    <div class="hbb-plan-notes mt-2 small text-muted"></div>
                </div>
            </div>
        `);
        toolbarCol.getElement().append($toolbarCard);

        this.$planMixBtn = $toolbarCard.find<HTMLButtonElement>('.hbb-plan-mix-btn');
        this.$playTransitionBtn = $toolbarCard.find<HTMLButtonElement>('.hbb-play-transition-btn');
        this.$stopTransitionBtn = $toolbarCard.find<HTMLButtonElement>('.hbb-stop-transition-btn');
        this.$addSetlistBtn = $toolbarCard.find<HTMLButtonElement>('.hbb-add-setlist-btn');
        this.$setlistCount = $toolbarCard.find<HTMLSpanElement>('.hbb-setlist-count');
        this.$planNotes = $toolbarCard.find<HTMLDivElement>('.hbb-plan-notes');
        const $planSummary = $toolbarCard.find<HTMLDivElement>('.hbb-plan-summary');
        const $clearBtn = $toolbarCard.find<HTMLButtonElement>('.hbb-clear-cues-btn');
        const $masterVol = $toolbarCard.find<HTMLInputElement>('.hbb-master-volume');
        $masterVol.on('input', (e): void => {
            const v: number = Number.parseFloat(jQuery(e.currentTarget).val()?.toString() ?? '1');
            this.masterVolume = v;
            this.transitionPlayer?.setMasterVolume(v);
        });

        // Wire transition-style select: initialise from store + write back on change.
        const $styleSelect = $toolbarCard.find<HTMLSelectElement>('.hbb-style');
        $styleSelect.val(TransitionStyleStore.getInstance().get());
        $styleSelect.on('change', (): void => {
            const v: string = $styleSelect.val()?.toString() ?? 'drop-on-drop';
            if (v === 'drop-on-drop' || v === 'tail-out' || v === 'early-cut' || v === 'bar-match') {
                TransitionStyleStore.getInstance().set(v);
            }
        });

        // Wire setlist count to the singleton store.
        const store: SetlistStore = SetlistStore.getInstance();
        this.unsubscribeSetlist = store.onChange((): void => {
            this.$setlistCount?.text(store.size().toString());
        });
        this.$setlistCount.text(store.size().toString());

        this.$planMixBtn.on('click', (): void => {
            void this.planMix($planSummary);
        });
        this.$playTransitionBtn.on('click', (): void => {
            void this.playTransition($planSummary);
        });
        this.$stopTransitionBtn.on('click', (): void => {
            this.stopTransition($planSummary);
        });
        this.$addSetlistBtn.on('click', (): void => {
            this.addToSetlist($planSummary);
        });
        $clearBtn.on('click', (): void => {
            this.deckA?.clearCues();
            this.deckB?.clearCues();
            $planSummary.text('');
            this.$planNotes?.empty();
            this.currentPlan = null;
            this.refreshTransitionButtons();
        });

        // Track list ---------------------------------------------------------------------------
        const tracksRow = new ContentRow(content);
        const tracksCard = new Card(new ContentCol(tracksRow, ContentColSize.col12));
        tracksCard.setTitle(new LangText('tracks'));
        // Wire a rescan button into the card header tools area.
        const $rescanBtn = jQuery<HTMLButtonElement>(`
            <button type="button" class="btn btn-tool hbb-rescan-btn" title="${Library.lang('library_rescan')}">
                <i class="fas fa-sync-alt"></i>
            </button>
        `);
        $rescanBtn.on('click', (): void => {
            void this.rescanLibrary($rescanBtn);
        });
        tracksCard.getToolsElement().append($rescanBtn);
        this.tracksCard = tracksCard;
        tracksCard.showLoading();

        let library: LibraryResponse;
        try {
            library = await LibraryApi.list();
        } catch (err) {
            tracksCard.hideLoading();
            tracksCard.getBodyElement().html(
                `<p class="text-danger m-3">${Library.lang('library_load_failed')}: ${
                    err instanceof Error ? err.message : String(err)
                }</p>`
            );
            return;
        }

        tracksCard.hideLoading();
        this.renderTracksTable(tracksCard, library);
    }

    private async rescanLibrary($btn: JQuery<HTMLButtonElement>): Promise<void> {
        if (this.tracksCard === null) {
            return;
        }
        $btn.prop('disabled', true);
        $btn.find('i').addClass('fa-spin');
        try {
            const library: LibraryResponse = await LibraryApi.rescan();
            this.renderTracksTable(this.tracksCard, library);
        } catch (err) {
            this.tracksCard.getBodyElement().html(
                `<p class="text-danger m-3">${Library.lang('library_rescan_failed')}: ${
                    err instanceof Error ? err.message : String(err)
                }</p>`
            );
        } finally {
            $btn.prop('disabled', false);
            $btn.find('i').removeClass('fa-spin');
        }
    }

    private renderTracksTable(card: Card, library: LibraryResponse): void {
        card.getBodyElement().empty();
        const $body = card.getBodyElement();
        const $controlsWrap = jQuery<HTMLDivElement>(`
            <div class="px-3 pt-2 pb-1 d-flex align-items-center flex-wrap" style="gap: 0.5rem 1rem;">
                <input type="text" class="form-control form-control-sm hbb-search" style="max-width: 320px;"
                       placeholder="${Library.lang('library_filter_placeholder')}">
                <div class="custom-control custom-switch">
                    <input type="checkbox" class="custom-control-input hbb-compat-toggle" id="hbb-compat-toggle">
                    <label class="custom-control-label" for="hbb-compat-toggle">
                        ${Library.lang('library_compatible_with')} <span class="hbb-compat-deck-label">${Library.lang('library_deck_a')}</span>
                        <span class="hbb-compat-camelot text-muted ml-1"></span>
                    </label>
                </div>
                <div class="d-inline-flex align-items-center small">
                    <span class="text-muted mr-1">BPM</span>
                    <input type="number" class="form-control form-control-sm hbb-bpm-min" placeholder="min" style="width:70px;" min="0" step="0.5">
                    <span class="mx-1 text-muted">–</span>
                    <input type="number" class="form-control form-control-sm hbb-bpm-max" placeholder="max" style="width:70px;" min="0" step="0.5">
                </div>
                <div class="d-inline-flex align-items-center small">
                    <span class="text-muted mr-1">Energy</span>
                    <input type="number" class="form-control form-control-sm hbb-energy-min" placeholder="min" style="width:70px;" min="0" max="1" step="0.05">
                    <span class="mx-1 text-muted">–</span>
                    <input type="number" class="form-control form-control-sm hbb-energy-max" placeholder="max" style="width:70px;" min="0" max="1" step="0.05">
                </div>
                <div class="d-inline-flex align-items-center small">
                    <span class="text-muted mr-1">${Library.lang('year')}</span>
                    <input type="number" class="form-control form-control-sm hbb-year-min" placeholder="min" style="width:80px;" min="1900" max="2100" step="1">
                    <span class="mx-1 text-muted">–</span>
                    <input type="number" class="form-control form-control-sm hbb-year-max" placeholder="max" style="width:80px;" min="1900" max="2100" step="1">
                </div>
                <div class="d-inline-flex align-items-center small">
                    <span class="text-muted mr-1">${Library.lang('genre')}</span>
                    <select class="form-control form-control-sm hbb-genre-select" style="min-width:140px;">
                        <option value="">${Library.lang('library_genre_any')}</option>
                    </select>
                </div>
                <button type="button" class="btn btn-default btn-sm hbb-clear-filters">${Library.lang('library_clear_filters')}</button>
                <span class="text-muted small hbb-filter-count"></span>
            </div>
        `);
        $body.append($controlsWrap);
        this.$searchInput = $controlsWrap.find<HTMLInputElement>('.hbb-search');
        this.$compatibleToggle = $controlsWrap.find<HTMLInputElement>('.hbb-compat-toggle');
        this.$bpmMin = $controlsWrap.find<HTMLInputElement>('.hbb-bpm-min');
        this.$bpmMax = $controlsWrap.find<HTMLInputElement>('.hbb-bpm-max');
        this.$energyMin = $controlsWrap.find<HTMLInputElement>('.hbb-energy-min');
        this.$energyMax = $controlsWrap.find<HTMLInputElement>('.hbb-energy-max');
        this.$yearMin = $controlsWrap.find<HTMLInputElement>('.hbb-year-min');
        this.$yearMax = $controlsWrap.find<HTMLInputElement>('.hbb-year-max');
        this.$genreSelect = $controlsWrap.find<HTMLSelectElement>('.hbb-genre-select');
        this.populateGenreOptions(library);
        this.$filterCount = $controlsWrap.find<HTMLSpanElement>('.hbb-filter-count');
        this.loadFilterPrefs();

        const table = new Table($body);
        table.setStyleHover(true);
        table.setStyleStriped(true);
        this.$tracksTbody = jQuery(table.getTbody()) as JQuery<HTMLTableSectionElement>;

        const trhead = new Tr(table.getThead());
        // eslint-disable-next-line no-new
        new Th(trhead, new ColumnContent([new LangText('cover')]));
        const trackTh = new Th(trhead, new ColumnContent([new LangText('track')]));
        trackTh.getElement().attr('data-sort-key', 'sort-track').addClass('hbb-sortable');
        const camelotTh = new Th(trhead, new ColumnContent([new LangText('camelot')]));
        camelotTh.getElement().attr('data-sort-key', 'camelot').addClass('hbb-sortable');
        // eslint-disable-next-line no-new
        new Th(trhead, new ColumnContent([new LangText('open_key')]));
        const bpmTh = new Th(trhead, new ColumnContent([new LangText('bpm')]));
        bpmTh.getElement().attr('data-sort-key', 'bpm').addClass('hbb-sortable');
        const energyTh = new Th(trhead, new ColumnContent([new LangText('energy')]));
        energyTh.getElement().attr('data-sort-key', 'energy').addClass('hbb-sortable');
        const dropsTh = new Th(trhead, new ColumnContent([new LangText('drops')]));
        dropsTh.getElement().attr('data-sort-key', 'drops').addClass('hbb-sortable');
        // eslint-disable-next-line no-new
        new Th(trhead, '');
        const $thead = jQuery(table.getThead());
        $thead.find<HTMLTableCellElement>('th.hbb-sortable')
            .css({ cursor: 'pointer', 'user-select': 'none' })
            .each((_idx, th): void => {
                const $th = jQuery(th);
                if ($th.find('.hbb-sort-arrow').length === 0) {
                    $th.append('<i class="hbb-sort-arrow ml-1 text-muted"></i>');
                }
            })
            .on('click', (e): void => {
                const key: string | undefined = jQuery(e.currentTarget).attr('data-sort-key');
                if (key !== undefined) {
                    this.cycleSort(key);
                }
            });

        let rowIndex: number = 0;
        for (const track of library.tracks) {
            const trbody = new Tr(table.getTbody());
            const filename: string = TrackDisplayUtil.filenameOf(track.path);
            const searchHaystack: string = TrackDisplayUtil.buildSearchHaystack(track, filename);
            const meta = track.metadata;
            const sortTrack: string = (meta?.title ?? filename).toLowerCase();
            trbody.getElement()
                .attr('data-filename', searchHaystack)
                .attr('data-camelot', track.camelot)
                .attr('data-bpm', track.bpm.toString())
                .attr('data-energy', track.energy.toString())
                .attr('data-year', meta?.year !== undefined ? meta.year.toString() : '')
                .attr('data-genre', meta?.genre ?? '')
                .attr('data-drops', track.drops.length.toString())
                .attr('data-sort-track', sortTrack)
                .attr('data-original-index', rowIndex.toString());
            rowIndex += 1;
            // eslint-disable-next-line no-new
            new Td(trbody, TrackDisplayUtil.coverThumbHtml(track));
            // eslint-disable-next-line no-new
            new Td(trbody, TrackDisplayUtil.trackCellHtml(track, filename));
            // eslint-disable-next-line no-new
            new Td(trbody, `<span class="badge badge-info">${track.camelot}</span>`);
            // eslint-disable-next-line no-new
            new Td(trbody, track.openKey);
            // eslint-disable-next-line no-new
            new Td(trbody, track.bpm.toFixed(1));
            // eslint-disable-next-line no-new
            new Td(trbody, track.energy.toFixed(3));
            // eslint-disable-next-line no-new
            new Td(trbody, track.drops.length === 0 ? '—' : track.drops.length.toString());

            const actionTd = new Td(trbody, '');
            const $actions = jQuery<HTMLSpanElement>(`
                <span>
                    <button type="button" class="btn btn-xs btn-info mr-1" data-deck="A">→ A</button>
                    <button type="button" class="btn btn-xs btn-success" data-deck="B">→ B</button>
                </span>
            `);
            $actions.find('button').on('click', (e: JQuery.ClickEvent): void => {
                const deck: string = jQuery(e.currentTarget).attr('data-deck') ?? 'A';
                if (deck === 'A') {
                    this.deckA?.setTrack(track);
                    this.currentFromTrack = track;
                    this.updateCompatibleDeckLabel();
                    this.applyTableFilters();
                } else {
                    this.deckB?.setTrack(track);
                    this.currentToTrack = track;
                }
                this.currentPlan = null;
                this.refreshPlanMixState();
                this.refreshTransitionButtons();
            });
            actionTd.getElement().append($actions);
        }

        // Wire search + compatible-only filters; all run through `applyTableFilters`.
        this.$searchInput.on('input', (): void => {
            this.applyTableFilters();
        });
        this.$compatibleToggle.on('change', (): void => {
            this.applyTableFilters();
        });
        const onRangeInput = (): void => {
            this.saveFilterPrefs();
            this.applyTableFilters();
        };
        this.$bpmMin?.on('input', onRangeInput);
        this.$bpmMax?.on('input', onRangeInput);
        this.$energyMin?.on('input', onRangeInput);
        this.$energyMax?.on('input', onRangeInput);
        this.$yearMin?.on('input', onRangeInput);
        this.$yearMax?.on('input', onRangeInput);
        this.$genreSelect?.on('change', onRangeInput);
        $controlsWrap.find<HTMLButtonElement>('.hbb-clear-filters').on('click', (): void => {
            this.$searchInput?.val('');
            this.$compatibleToggle?.prop('checked', false);
            this.$bpmMin?.val('');
            this.$bpmMax?.val('');
            this.$energyMin?.val('');
            this.$energyMax?.val('');
            this.$yearMin?.val('');
            this.$yearMax?.val('');
            this.$genreSelect?.val('');
            this.saveFilterPrefs();
            this.applyTableFilters();
        });

        Lang.i().lAll();
        this.applyTableFilters();
    }

    private applyTableFilters(): void {
        if (this.$tracksTbody === null) {
            return;
        }
        const q: string =
            this.$searchInput?.val()?.toString().toLowerCase().trim() ?? '';
        const compatOn: boolean = this.$compatibleToggle?.is(':checked') ?? false;
        const deckACamelot: string | null = this.currentFromTrack?.camelot ?? null;
        const bpmMin: number = Library.parseBound(this.$bpmMin?.val()?.toString(), 0);
        const bpmMax: number = Library.parseBound(this.$bpmMax?.val()?.toString(), Number.POSITIVE_INFINITY);
        const energyMin: number = Library.parseBound(this.$energyMin?.val()?.toString(), 0);
        const energyMax: number = Library.parseBound(this.$energyMax?.val()?.toString(), 1);
        const yearMin: number = Library.parseBound(this.$yearMin?.val()?.toString(), 0);
        const yearMax: number = Library.parseBound(this.$yearMax?.val()?.toString(), Number.POSITIVE_INFINITY);
        const genreFilter: string = this.$genreSelect?.val()?.toString() ?? '';
        let visible: number = 0;
        let total: number = 0;
        this.$tracksTbody.find<HTMLTableRowElement>('tr[data-filename]').each(
            (_idx, row): void => {
                total += 1;
                const $row = jQuery(row);
                const filename: string = $row.attr('data-filename') ?? '';
                const camelot: string = $row.attr('data-camelot') ?? '';
                const bpm: number = Number.parseFloat($row.attr('data-bpm') ?? '0');
                const energy: number = Number.parseFloat($row.attr('data-energy') ?? '0');
                const yearRaw: string = $row.attr('data-year') ?? '';
                const year: number = yearRaw === '' ? Number.NaN : Number.parseFloat(yearRaw);
                const genre: string = $row.attr('data-genre') ?? '';
                const matchesSearch: boolean = q === '' || filename.includes(q);
                const matchesCompat: boolean =
                    !compatOn || deckACamelot === null
                        ? true
                        : CamelotUtil.isCompatible(deckACamelot, camelot);
                const matchesBpm: boolean = bpm >= bpmMin && bpm <= bpmMax;
                const matchesEnergy: boolean = energy >= energyMin && energy <= energyMax;
                // Tracks without a year are only filtered out when the user actively constrained
                // the range (otherwise an empty range silently drops untagged tracks).
                const yearActive: boolean = yearMin > 0 || yearMax !== Number.POSITIVE_INFINITY;
                const matchesYear: boolean = !yearActive
                    || (Number.isFinite(year) && year >= yearMin && year <= yearMax);
                const matchesGenre: boolean = genreFilter === '' || genre === genreFilter;
                const show: boolean = matchesSearch && matchesCompat && matchesBpm
                    && matchesEnergy && matchesYear && matchesGenre;
                $row.toggle(show);
                if (show) {
                    visible += 1;
                }
            }
        );
        if (this.$filterCount !== null) {
            this.$filterCount.text(visible === total ? '' : `${visible.toString()} / ${total.toString()}`);
        }
    }

    /**
     * Re-populate the genre `<select>` from the loaded library — distinct genres only,
     * alphabetised. The leading "any" option is preserved. Persisted genre selection is
     * restored after `loadFilterPrefs` runs.
     */
    private populateGenreOptions(library: LibraryResponse): void {
        if (this.$genreSelect === null) {
            return;
        }
        const seen: Set<string> = new Set<string>();
        for (const t of library.tracks) {
            const g: string | undefined = t.metadata?.genre;
            if (g !== undefined && g !== '') {
                seen.add(g);
            }
        }
        const sorted: string[] = [...seen].sort((a, b): number => a.localeCompare(b));
        for (const g of sorted) {
            const opt: HTMLOptionElement = document.createElement('option');
            opt.value = g;
            opt.textContent = g;
            this.$genreSelect[0]?.appendChild(opt);
        }
    }

    /**
     * Sort cycle: clicking a header advances `none → asc → desc → none` for that column. The
     * sort applies to the current DOM order so it composes with the row-level filter (filtered
     * rows just stay hidden but maintain their position in the new order). Numeric keys are
     * compared numerically; everything else falls back to a locale-aware string compare.
     */
    private cycleSort(key: string): void {
        if (this.sortKey !== key) {
            this.sortKey = key;
            this.sortDir = 'asc';
        } else if (this.sortDir === 'asc') {
            this.sortDir = 'desc';
        } else {
            this.sortKey = null;
        }
        this.applySort();
        this.refreshSortIndicators();
    }

    private applySort(): void {
        if (this.$tracksTbody === null) {
            return;
        }
        const $rows = this.$tracksTbody.find<HTMLTableRowElement>('tr[data-filename]');
        if (this.sortKey === null) {
            // Restore original DOM order via the row indices we baked in at render time.
            const reordered: HTMLTableRowElement[] = [...$rows.toArray()].sort(
                (a, b): number => Library.attrAsNumber(a, 'data-original-index')
                    - Library.attrAsNumber(b, 'data-original-index'),
            );
            for (const row of reordered) {
                this.$tracksTbody[0]?.appendChild(row);
            }
            return;
        }
        const numericKey: boolean = this.sortKey === 'bpm'
            || this.sortKey === 'energy'
            || this.sortKey === 'drops';
        const attr: string = `data-${this.sortKey}`;
        const dir: number = this.sortDir === 'asc' ? 1 : -1;
        const sorted: HTMLTableRowElement[] = [...$rows.toArray()].sort((a, b): number => {
            const av: string = a.getAttribute(attr) ?? '';
            const bv: string = b.getAttribute(attr) ?? '';
            if (numericKey) {
                return (Number.parseFloat(av) - Number.parseFloat(bv)) * dir;
            }
            return av.localeCompare(bv) * dir;
        });
        for (const row of sorted) {
            this.$tracksTbody[0]?.appendChild(row);
        }
    }

    private refreshSortIndicators(): void {
        if (this.$tracksTbody === null) {
            return;
        }
        const $thead = this.$tracksTbody.parent().find<HTMLTableSectionElement>('thead');
        $thead.find<HTMLElement>('.hbb-sort-arrow').each((_i, el): void => {
            const $th = jQuery(el).closest<HTMLTableCellElement>('th');
            const key: string | undefined = $th.attr('data-sort-key');
            const $arrow = jQuery(el);
            $arrow.removeClass('fas fa-caret-up fa-caret-down').addClass('text-muted');
            if (key === this.sortKey) {
                $arrow
                    .removeClass('text-muted')
                    .addClass(`fas fa-caret-${this.sortDir === 'asc' ? 'up' : 'down'}`);
            }
        });
    }

    private static attrAsNumber(row: HTMLTableRowElement, attr: string): number {
        const raw: string | null = row.getAttribute(attr);
        if (raw === null) {
            return Number.MAX_SAFE_INTEGER;
        }
        const parsed: number = Number.parseFloat(raw);
        return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
    }

    private setActiveDeck(letter: 'A' | 'B'): void {
        this.activeDeck = letter;
        this.deckA?.setActive(letter === 'A');
        this.deckB?.setActive(letter === 'B');
    }

    private installKeyboardShortcuts(): void {
        if (this.keydownHandler !== null) {
            return;
        }
        const handler = (e: KeyboardEvent): void => {
            // Don't hijack typing in inputs/textareas/selects.
            const target: HTMLElement | null = e.target as HTMLElement | null;
            if (target !== null) {
                const tag: string = target.tagName;
                if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) {
                    return;
                }
            }
            const deck: Deck | null = this.activeDeck === 'A' ? this.deckA : this.deckB;
            if (deck === null) {
                return;
            }
            if (e.key === 'Tab') {
                e.preventDefault();
                this.setActiveDeck(this.activeDeck === 'A' ? 'B' : 'A');
                return;
            }
            if (e.key === ' ') {
                e.preventDefault();
                deck.togglePlayPause();
                return;
            }
            if (e.key >= '1' && e.key <= '8') {
                e.preventDefault();
                const slot: number = Number.parseInt(e.key, 10) - 1;
                deck.triggerHotCue(slot, e.shiftKey);
                return;
            }
            const lowered: string = e.key.toLowerCase();
            if (lowered === 'q') {
                e.preventDefault();
                deck.triggerLoopIn();
                return;
            }
            if (lowered === 'w') {
                e.preventDefault();
                deck.triggerLoopOut();
                return;
            }
            if (lowered === 'e') {
                e.preventDefault();
                deck.triggerLoopClear();
                return;
            }
        };
        window.addEventListener('keydown', handler);
        this.keydownHandler = handler;
    }

    private static parseBound(raw: string | undefined, fallback: number): number {
        if (raw === undefined || raw.trim() === '') {
            return fallback;
        }
        const parsed: number = Number.parseFloat(raw);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    private loadFilterPrefs(): void {
        try {
            const raw: string | null = localStorage.getItem('hbb.library-filters.v1');
            if (raw === null) {
                return;
            }
            const parsed: unknown = JSON.parse(raw);
            if (parsed === null || typeof parsed !== 'object') {
                return;
            }
            const obj = parsed as Record<string, unknown>;
            if (typeof obj.bpmMin === 'string') {
                this.$bpmMin?.val(obj.bpmMin);
            }
            if (typeof obj.bpmMax === 'string') {
                this.$bpmMax?.val(obj.bpmMax);
            }
            if (typeof obj.energyMin === 'string') {
                this.$energyMin?.val(obj.energyMin);
            }
            if (typeof obj.energyMax === 'string') {
                this.$energyMax?.val(obj.energyMax);
            }
            if (typeof obj.yearMin === 'string') {
                this.$yearMin?.val(obj.yearMin);
            }
            if (typeof obj.yearMax === 'string') {
                this.$yearMax?.val(obj.yearMax);
            }
            if (typeof obj.genre === 'string') {
                this.$genreSelect?.val(obj.genre);
            }
        } catch {
            // localStorage unavailable or stored payload broken — use defaults.
        }
    }

    private saveFilterPrefs(): void {
        const payload = {
            bpmMin: this.$bpmMin?.val()?.toString() ?? '',
            bpmMax: this.$bpmMax?.val()?.toString() ?? '',
            energyMin: this.$energyMin?.val()?.toString() ?? '',
            energyMax: this.$energyMax?.val()?.toString() ?? '',
            yearMin: this.$yearMin?.val()?.toString() ?? '',
            yearMax: this.$yearMax?.val()?.toString() ?? '',
            genre: this.$genreSelect?.val()?.toString() ?? ''
        };
        try {
            localStorage.setItem('hbb.library-filters.v1', JSON.stringify(payload));
        } catch {
            // localStorage unavailable — keep in-memory only.
        }
    }

    private updateCompatibleDeckLabel(): void {
        const camelot: string | undefined = this.currentFromTrack?.camelot;
        this.tracksCard
            ?.getBodyElement()
            .find<HTMLSpanElement>('.hbb-compat-camelot')
            .text(camelot !== undefined ? `(${camelot})` : '');
    }

    private refreshPlanMixState(): void {
        if (this.$planMixBtn === null) {
            return;
        }
        this.$planMixBtn.prop(
            'disabled',
            this.currentFromTrack === null || this.currentToTrack === null
        );
    }

    private refreshTransitionButtons(): void {
        const hasPlan: boolean = this.currentPlan !== null;
        this.$playTransitionBtn?.prop('disabled', !hasPlan);
        this.$addSetlistBtn?.prop('disabled', !hasPlan);
    }

    private async planMix($summary: JQuery<HTMLDivElement>): Promise<void> {
        const a: RouteTrack | null = this.currentFromTrack;
        const b: RouteTrack | null = this.currentToTrack;
        if (a === null || b === null) {
            return;
        }
        $summary.text(`${Lang.i().l('loading') ?? 'Loading…'}`);
        let plan: TransitionPlan;
        try {
            plan = await MixApi.plan(a.path, b.path, TransitionStyleStore.getInstance().get());
        } catch (err) {
            $summary.text(`Plan failed: ${err instanceof Error ? err.message : String(err)}`);
            return;
        }
        this.currentPlan = plan;
        this.deckA?.setCue(plan.cueOutSec, 'out');
        this.deckB?.setCue(plan.cueInSec, 'in');
        const summaryParts: string[] = [
            `${plan.from.camelot} → ${plan.to.camelot}`,
            plan.keyMatch,
            `style: ${plan.style}`,
            `aligned: ${plan.alignment}`,
            `pitch ${plan.to.pitchPercent >= 0 ? '+' : ''}${plan.to.pitchPercent.toFixed(2)}%`,
            `${plan.mixBars.toFixed(1)} bars`
        ];
        $summary.html(summaryParts
            .map((s: string): string => `<span class="badge badge-light mr-1">${s}</span>`)
            .join(''));
        if (this.$planNotes !== null) {
            this.$planNotes.empty();
            for (const note of plan.notes) {
                this.$planNotes.append(jQuery('<div></div>').text(note));
            }
        }
        this.refreshTransitionButtons();
    }

    private async playTransition($summary: JQuery<HTMLDivElement>): Promise<void> {
        if (this.currentPlan === null || this.currentFromTrack === null || this.currentToTrack === null) {
            return;
        }
        // Stop any wavesurfer playback so we don't get double audio.
        this.deckA?.pause();
        this.deckB?.pause();
        if (this.transitionPlayer !== null) {
            await this.transitionPlayer.dispose();
            this.transitionPlayer = null;
        }
        const player: AutoPlayer = new AutoPlayer(this.masterVolume);
        this.transitionPlayer = player;
        const djSet: DjSet = {
            tracks: [
                {
                    path: this.currentFromTrack.path,
                    camelot: this.currentFromTrack.camelot,
                    bpm: this.currentFromTrack.bpm,
                    energy: this.currentFromTrack.energy,
                    durationSec: this.currentFromTrack.durationSec
                },
                {
                    path: this.currentToTrack.path,
                    camelot: this.currentToTrack.camelot,
                    bpm: this.currentToTrack.bpm,
                    energy: this.currentToTrack.energy,
                    durationSec: this.currentToTrack.durationSec
                }
            ],
            transitions: [this.currentPlan],
            skipped: [],
            energyDirection: 'either'
        };
        this.$playTransitionBtn?.prop('disabled', true);
        this.$stopTransitionBtn?.prop('disabled', false);
        try {
            await player.play(
                djSet,
                undefined,
                (): void => {
                    $summary.append(' <span class="text-success ml-2">▶ done</span>');
                    this.$playTransitionBtn?.prop('disabled', this.currentPlan === null);
                    this.$stopTransitionBtn?.prop('disabled', true);
                },
                (index: number, trackTime: number): void => {
                    if (index === 0) {
                        this.deckA?.syncToTime(trackTime);
                    } else if (index === 1) {
                        this.deckB?.syncToTime(trackTime);
                    }
                }
            );
        } catch (err) {
            $summary.html(
                `<span class="text-danger">Play failed: ${
                    err instanceof Error ? err.message : String(err)
                }</span>`
            );
            this.$playTransitionBtn?.prop('disabled', false);
            this.$stopTransitionBtn?.prop('disabled', true);
        }
    }

    private stopTransition($summary: JQuery<HTMLDivElement>): void {
        if (this.transitionPlayer !== null) {
            this.transitionPlayer.stop();
        }
        this.$playTransitionBtn?.prop('disabled', this.currentPlan === null);
        this.$stopTransitionBtn?.prop('disabled', true);
        $summary.append(' <span class="text-muted ml-2">stopped</span>');
    }

    private addToSetlist($summary: JQuery<HTMLDivElement>): void {
        if (this.currentPlan === null || this.currentFromTrack === null || this.currentToTrack === null) {
            return;
        }
        SetlistStore.getInstance().add({
            from: this.currentFromTrack,
            to: this.currentToTrack,
            transition: this.currentPlan
        });
        $summary.append(` <span class="text-info ml-2">${Library.lang('library_add_setlist')}</span>`);
    }

    private static lang(key: string): string {
        return Lang.i().l(key) ?? key;
    }

}