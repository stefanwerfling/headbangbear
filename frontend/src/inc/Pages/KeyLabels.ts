import { Card, ColumnContent, ContentCol, ContentColSize, ContentRow, Lang, LangText, Table, Th, Tr } from 'bambooo';
import type {
    KeyLabelEntry,
    KeyProfileSweepReport,
    KeyProfileSweepRow,
    LibraryProvider,
    LocalLibraryProvider,
    RouteTrack,
} from '@headbangbear/schemas';
import { KeyLabelsApi } from '../Api/KeyLabelsApi.js';
import { KeyProfileSweepApi } from '../Api/KeyProfileSweepApi.js';
import { LibraryApi } from '../Api/LibraryApi.js';
import { SettingsApi } from '../Api/SettingsApi.js';
import { TrackDisplayUtil } from '../Util/TrackDisplayUtil.js';
import { BasePage } from './BasePage.js';

const TONICS: readonly string[] = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Pre-built option list so the dropdown markup stays one expression per row. */
const KEY_OPTIONS: readonly string[] = [
    ...TONICS.map((t): string => `${t} major`),
    ...TONICS.map((t): string => `${t} minor`),
];

/** Mirrors `KeyProfileSweepRoute.DEFAULT_PROFILES`; checkboxes start all-selected. */
const SWEEP_PROFILES: readonly string[] = [
    'bgate', 'temperley', 'krumhansl', 'edmm', 'edma', 'shaath',
];

/**
 * Ground-truth labelling page. Lets the user assign a canonical key to each track in a
 * **single local provider**, persists them via `POST /api/v1/library/key-labels` (which
 * writes `<rootDir>/truth.json` for that provider), and surfaces a "labelled / total"
 * counter so it's obvious how much work is left.
 *
 * Iter 52 added multi-provider support — Jellyfin tracks aren't labelable (no on-disk
 * audio for offline re-extraction) so the page scopes itself to the first `local`-kind
 * provider in the user's settings. When no local provider exists the page renders an
 * explanatory empty state instead.
 */
export class KeyLabels extends BasePage {

    protected override _name: string = 'key-labels';

    private $tbody: JQuery<HTMLTableSectionElement> | null = null;

    private $counter: JQuery<HTMLSpanElement> | null = null;

    private $statusEl: JQuery<HTMLSpanElement> | null = null;

    private $saveBtn: JQuery<HTMLButtonElement> | null = null;

    private $sweepCard: JQuery<HTMLDivElement> | null = null;

    private $sweepRunBtn: JQuery<HTMLButtonElement> | null = null;

    private $sweepStatus: JQuery<HTMLSpanElement> | null = null;

    private $sweepResult: JQuery<HTMLDivElement> | null = null;

    private $emptyState: JQuery<HTMLDivElement> | null = null;

    private $providerLabel: JQuery<HTMLSpanElement> | null = null;

    private tracks: RouteTrack[] = [];

    /** key = per-provider relative path, value = chosen key string ("A minor" etc.). */
    private labels: Map<string, string> = new Map();

    private activeProviderId: string | null = null;

    public constructor() {
        super();
        this.setTitle(new LangText('key_labels'));
    }

    public override async loadContent(): Promise<void> {
        const content = this.getContent();
        content.empty();

        const helpRow = new ContentRow(content);
        const helpCol = new ContentCol(helpRow, ContentColSize.col12);
        helpCol.getElement().append(jQuery<HTMLDivElement>(`
            <div class="card card-info card-outline collapsed-card">
                <div class="card-header">
                    <h3 class="card-title">
                        <i class="fas fa-info-circle mr-1"></i>${KeyLabels.lang('key_labels_help_title')}
                    </h3>
                    <div class="card-tools">
                        <button type="button" class="btn btn-tool" data-card-widget="collapse"><i class="fas fa-plus"></i></button>
                    </div>
                </div>
                <div class="card-body" style="display:none;">
                    <p class="mb-0">${KeyLabels.lang('key_labels_help_body')}</p>
                </div>
            </div>
        `));

        const cardRow = new ContentRow(content);
        const card = new Card(new ContentCol(cardRow, ContentColSize.col12));
        card.setTitle(new LangText('key_labels'));

        const $body = card.getBodyElement();

        // Empty state — shown only when no local provider exists in settings. Mutually
        // exclusive with the labels controls + table.
        this.$emptyState = jQuery<HTMLDivElement>(`
            <div class="alert alert-warning m-3" style="display:none;">
                <i class="fas fa-exclamation-triangle mr-2"></i>${KeyLabels.lang('key_labels_no_local_provider')}
            </div>
        `);
        $body.append(this.$emptyState);

        const $controls = jQuery<HTMLDivElement>(`
            <div class="px-3 pt-2 pb-1 d-flex align-items-center" style="gap:1rem;">
                <button type="button" class="btn btn-sm btn-primary hbb-save-labels">
                    <i class="fas fa-save mr-1"></i>${KeyLabels.lang('key_labels_save')}
                </button>
                <span class="hbb-labels-counter text-muted small"></span>
                <span class="hbb-provider-label badge badge-secondary"></span>
                <span class="hbb-labels-status text-muted small ml-auto"></span>
            </div>
        `);
        $body.append($controls);
        this.$counter = $controls.find<HTMLSpanElement>('.hbb-labels-counter');
        this.$providerLabel = $controls.find<HTMLSpanElement>('.hbb-provider-label');
        this.$statusEl = $controls.find<HTMLSpanElement>('.hbb-labels-status');
        this.$saveBtn = $controls.find<HTMLButtonElement>('.hbb-save-labels');
        this.$saveBtn.on('click', (): void => {
            void this.save();
        });

        const table = new Table($body);
        table.setStyleHover(true);
        table.setStyleStriped(true);
        const trhead = new Tr(table.getThead());
        // eslint-disable-next-line no-new
        new Th(trhead, new ColumnContent([new LangText('cover')]));
        // eslint-disable-next-line no-new
        new Th(trhead, new ColumnContent([new LangText('track')]));
        // eslint-disable-next-line no-new
        new Th(trhead, new ColumnContent([new LangText('key_labels_predicted')]));
        // eslint-disable-next-line no-new
        new Th(trhead, new ColumnContent([new LangText('key_labels_truth')]));
        this.$tbody = jQuery(table.getTbody()) as JQuery<HTMLTableSectionElement>;

        // Sweep card — reads the saved truth.json and runs the configured profiles
        // server-side. Heavy on first call (essentia analyses each track per profile);
        // cached after.
        const sweepRow = new ContentRow(content);
        const sweepCol = new ContentCol(sweepRow, ContentColSize.col12);
        const profileCheckboxes: string = SWEEP_PROFILES.map((p: string): string => `
            <label class="mr-3 mb-0">
                <input type="checkbox" class="hbb-sweep-profile" data-profile="${p}" checked>
                ${p}
            </label>
        `).join('');
        this.$sweepCard = jQuery<HTMLDivElement>(`
            <div class="card">
                <div class="card-header">
                    <h3 class="card-title"><i class="fas fa-flask mr-1"></i>${KeyLabels.lang('key_labels_sweep_title')}</h3>
                </div>
                <div class="card-body">
                    <p class="text-muted small mb-2">${KeyLabels.lang('key_labels_sweep_help')}</p>
                    <div class="d-flex align-items-center flex-wrap mb-2" style="gap:0.5rem 1rem;">
                        ${profileCheckboxes}
                    </div>
                    <div class="d-flex align-items-center" style="gap:1rem;">
                        <button type="button" class="btn btn-sm btn-primary hbb-sweep-run">
                            <i class="fas fa-play mr-1"></i>${KeyLabels.lang('key_labels_sweep_run')}
                        </button>
                        <span class="hbb-sweep-status text-muted small"></span>
                    </div>
                    <div class="hbb-sweep-result mt-3"></div>
                </div>
            </div>
        `);
        sweepCol.getElement().append(this.$sweepCard);
        this.$sweepRunBtn = this.$sweepCard.find<HTMLButtonElement>('.hbb-sweep-run');
        this.$sweepStatus = this.$sweepCard.find<HTMLSpanElement>('.hbb-sweep-status');
        this.$sweepResult = this.$sweepCard.find<HTMLDivElement>('.hbb-sweep-result');
        this.$sweepRunBtn.on('click', (): void => {
            void this.runSweep();
        });

        await this.refresh();
    }

    private async runSweep(): Promise<void> {
        if (this.$sweepRunBtn === null || this.$sweepStatus === null || this.$sweepResult === null) {
            return;
        }
        if (this.activeProviderId === null) {
            this.$sweepStatus.html(`<span class="text-warning">${KeyLabels.lang('key_labels_no_local_provider')}</span>`);
            return;
        }
        const $checks = this.$sweepCard?.find<HTMLInputElement>('.hbb-sweep-profile') ?? jQuery<HTMLInputElement>();
        const profiles: string[] = [];
        $checks.each((_i, el): void => {
            const $el = jQuery(el);
            if ($el.is(':checked')) {
                const p: string | undefined = $el.attr('data-profile');
                if (p !== undefined) {
                    profiles.push(p);
                }
            }
        });
        if (profiles.length === 0) {
            this.$sweepStatus.html(`<span class="text-warning">${KeyLabels.lang('key_labels_sweep_no_profiles')}</span>`);
            return;
        }
        this.$sweepRunBtn.prop('disabled', true);
        this.$sweepStatus.html(
            `<span class="text-warning">${KeyLabels.lang('key_labels_sweep_running')}</span>`,
        );
        this.$sweepResult.empty();
        let report: KeyProfileSweepReport;
        try {
            report = await KeyProfileSweepApi.run({
                providerId: this.activeProviderId,
                profiles: profiles,
            });
        } catch (err) {
            this.$sweepStatus.html(
                `<span class="text-danger">${KeyLabels.lang('key_labels_sweep_failed')}: ${
                    err instanceof Error ? err.message : String(err)
                }</span>`,
            );
            this.$sweepRunBtn.prop('disabled', false);
            return;
        }
        this.$sweepRunBtn.prop('disabled', false);
        this.$sweepStatus.html(
            `<span class="text-success">${KeyLabels.lang('key_labels_sweep_done')} — ${KeyLabels.lang('key_labels_sweep_best')}: <strong>${TrackDisplayUtil.escape(report.bestProfile)}</strong></span>`,
        );
        this.$sweepResult.html(KeyLabels.renderSweepResult(report));
    }

    /**
     * Sweep result table: profile / matched / category counts / MIREX score, sorted server-
     * side already (best first). Highlight the winning row in green so the answer to "which
     * profile fits my library" is unmissable.
     */
    private static renderSweepResult(report: KeyProfileSweepReport): string {
        if (report.rows.length === 0) {
            return `<p class="text-muted m-0">${KeyLabels.lang('key_labels_sweep_no_rows')}</p>`;
        }
        const head: string = `
            <thead><tr>
                <th>${KeyLabels.lang('key_labels_sweep_profile')}</th>
                <th class="text-right">${KeyLabels.lang('key_labels_sweep_mirex')}</th>
                <th class="text-right">${KeyLabels.lang('key_labels_sweep_matched')}</th>
                <th class="text-right text-success">exact</th>
                <th class="text-right">fifth</th>
                <th class="text-right">relative</th>
                <th class="text-right">parallel</th>
                <th class="text-right text-danger">wrong</th>
            </tr></thead>
        `;
        const body: string = report.rows.map((row: KeyProfileSweepRow): string => {
            const winner: boolean = row.profile === report.bestProfile;
            const cls: string = winner ? 'class="table-success"' : '';
            return `<tr ${cls}>
                <td><strong>${TrackDisplayUtil.escape(row.profile)}</strong></td>
                <td class="text-right">${row.mirexScore.toFixed(4)}</td>
                <td class="text-right">${row.matched.toString()}</td>
                <td class="text-right">${row.counts.exact.toString()}</td>
                <td class="text-right">${row.counts.fifth.toString()}</td>
                <td class="text-right">${row.counts.relative.toString()}</td>
                <td class="text-right">${row.counts.parallel.toString()}</td>
                <td class="text-right">${row.counts.wrong.toString()}</td>
            </tr>`;
        }).join('');
        return `<table class="table table-sm table-hover table-striped">${head}<tbody>${body}</tbody></table>
            <p class="small text-muted mt-2 mb-0">${KeyLabels.lang('key_labels_sweep_truth_size')}: ${report.truthSize.toString()}</p>`;
    }

    private async refresh(): Promise<void> {
        if (this.$tbody === null) {
            return;
        }
        let providerId: string | null;
        try {
            providerId = await KeyLabels.resolveLocalProviderId();
        } catch (err) {
            this.$statusEl?.html(
                `<span class="text-danger">${KeyLabels.lang('key_labels_load_failed')}: ${
                    err instanceof Error ? err.message : String(err)
                }</span>`,
            );
            return;
        }
        this.activeProviderId = providerId;
        if (providerId === null) {
            this.$emptyState?.show();
            this.$tbody.empty();
            this.$counter?.text('');
            this.$providerLabel?.text('').hide();
            this.$saveBtn?.prop('disabled', true);
            this.$sweepRunBtn?.prop('disabled', true);
            return;
        }
        this.$emptyState?.hide();
        this.$saveBtn?.prop('disabled', false);
        this.$sweepRunBtn?.prop('disabled', false);
        this.$providerLabel?.text(providerId).show();

        try {
            const [lib, labels] = await Promise.all([
                LibraryApi.list(),
                KeyLabelsApi.list(providerId),
            ]);
            this.tracks = lib.tracks.filter((t): boolean => t.providerId === providerId);
            this.labels.clear();
            for (const entry of labels.labels) {
                this.labels.set(entry.path, entry.key);
            }
        } catch (err) {
            this.$statusEl?.html(
                `<span class="text-danger">${KeyLabels.lang('key_labels_load_failed')}: ${
                    err instanceof Error ? err.message : String(err)
                }</span>`,
            );
            return;
        }
        this.renderRows();
        this.refreshCounter();
    }

    private renderRows(): void {
        if (this.$tbody === null) {
            return;
        }
        this.$tbody.empty();
        for (const track of this.tracks) {
            const filename: string = TrackDisplayUtil.filenameOf(track.path);
            const predicted: string = KeyLabels.formatPredicted(track);
            const current: string = this.labels.get(track.path) ?? '';
            const optionsHtml: string = KeyLabels.buildOptionsHtml(current);
            const trackPath: string = track.path;
            const $row = jQuery<HTMLTableRowElement>(`
                <tr data-path="${TrackDisplayUtil.escape(trackPath)}">
                    <td>${TrackDisplayUtil.coverThumbHtml(track)}</td>
                    <td>${TrackDisplayUtil.trackCellHtml(track, filename)}</td>
                    <td><span class="badge badge-info">${track.camelot}</span> <small class="text-muted ml-1">${TrackDisplayUtil.escape(predicted)}</small></td>
                    <td>
                        <select class="form-control form-control-sm hbb-truth-select" style="max-width:160px;">
                            ${optionsHtml}
                        </select>
                    </td>
                </tr>
            `);
            $row.find<HTMLSelectElement>('.hbb-truth-select').on('change', (e): void => {
                const value: string = jQuery(e.currentTarget).val()?.toString() ?? '';
                if (value === '') {
                    this.labels.delete(trackPath);
                } else {
                    this.labels.set(trackPath, value);
                }
                this.refreshCounter();
            });
            this.$tbody.append($row);
        }
    }

    private async save(): Promise<void> {
        if (this.$saveBtn === null || this.activeProviderId === null) {
            return;
        }
        const providerId: string = this.activeProviderId;
        const labels: KeyLabelEntry[] = [];
        for (const [path, key] of this.labels.entries()) {
            labels.push({ providerId: providerId, path: path, key: key });
        }
        this.$saveBtn.prop('disabled', true);
        this.$statusEl?.text(KeyLabels.lang('key_labels_saving'));
        try {
            await KeyLabelsApi.save({ providerId: providerId, labels: labels });
            this.$statusEl?.html(
                `<span class="text-success">${KeyLabels.lang('key_labels_saved')}</span>`,
            );
        } catch (err) {
            this.$statusEl?.html(
                `<span class="text-danger">${KeyLabels.lang('key_labels_save_failed')}: ${
                    err instanceof Error ? err.message : String(err)
                }</span>`,
            );
        } finally {
            this.$saveBtn.prop('disabled', false);
        }
    }

    private refreshCounter(): void {
        if (this.$counter === null) {
            return;
        }
        const labelled: number = this.labels.size;
        const total: number = this.tracks.length;
        this.$counter.text(`${labelled.toString()} / ${total.toString()} ${KeyLabels.lang('key_labels_labelled')}`);
    }

    /** First `local`-kind provider id in the configured settings list, or `null` if none.
     *  Per memo: Jellyfin tracks aren't labelable, and there's no "default" provider — we
     *  simply pick the first match the way the legacy single-provider model did. */
    private static async resolveLocalProviderId(): Promise<string | null> {
        const settings = await SettingsApi.get();
        const local: LocalLibraryProvider | undefined = settings.providers.find(
            (p: LibraryProvider): p is LocalLibraryProvider => p.kind === 'local',
        );
        return local?.id ?? null;
    }

    private static formatPredicted(track: RouteTrack): string {
        // We carry only Camelot + Open Key in `RouteTrack`; the human-readable "A minor"
        // form would need a full MusicalKey, which we don't push down. Camelot in the badge
        // + Open Key here is enough context for the user to pick.
        return track.openKey === '' ? '' : track.openKey;
    }

    private static buildOptionsHtml(selected: string): string {
        const blank: string = selected === '' ? ' selected' : '';
        const opts: string[] = [`<option value=""${blank}>—</option>`];
        for (const k of KEY_OPTIONS) {
            const sel: string = k === selected ? ' selected' : '';
            opts.push(`<option value="${k}"${sel}>${k}</option>`);
        }
        return opts.join('');
    }

    private static lang(key: string): string {
        return Lang.i().l(key) ?? key;
    }

}