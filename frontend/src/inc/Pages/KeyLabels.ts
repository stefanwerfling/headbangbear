import { Card, ColumnContent, ContentCol, ContentColSize, ContentRow, Lang, LangText, Table, Td, Th, Tr } from 'bambooo';
import type {
    KeyLabelEntry,
    KeyProfileSweepReport,
    KeyProfileSweepRow,
    RouteTrack,
} from '@headbangbear/schemas';
import { KeyLabelsApi } from '../Api/KeyLabelsApi.js';
import { KeyProfileSweepApi } from '../Api/KeyProfileSweepApi.js';
import { LibraryApi } from '../Api/LibraryApi.js';
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
 * Ground-truth labelling page. Lets the user assign a canonical key to each track in the
 * library, persists them to `<library>/truth.json` via `POST /api/v1/library/key-labels`,
 * and surfaces a "labelled / total" counter so it's obvious how much work is left.
 *
 * The labelled file is the input the existing `KeyEval` / `KeyProfileSweep` CLIs already
 * consume — this page is the missing UI piece that turns that infra from "edit a JSON
 * file by hand" into something usable.
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

    private tracks: RouteTrack[] = [];

    private labels: Map<string, string> = new Map();

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
        const $controls = jQuery<HTMLDivElement>(`
            <div class="px-3 pt-2 pb-1 d-flex align-items-center" style="gap:1rem;">
                <button type="button" class="btn btn-sm btn-primary hbb-save-labels">
                    <i class="fas fa-save mr-1"></i>${KeyLabels.lang('key_labels_save')}
                </button>
                <span class="hbb-labels-counter text-muted small"></span>
                <span class="hbb-labels-status text-muted small ml-auto"></span>
            </div>
        `);
        $body.append($controls);
        this.$counter = $controls.find<HTMLSpanElement>('.hbb-labels-counter');
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
            report = await KeyProfileSweepApi.run({ profiles: profiles });
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
        try {
            const [lib, labels] = await Promise.all([
                LibraryApi.list(),
                KeyLabelsApi.list(),
            ]);
            this.tracks = lib.tracks;
            this.labels.clear();
            for (const entry of labels.labels) {
                this.labels.set(entry.filename, entry.key);
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
            const current: string = this.labels.get(filename) ?? '';
            const optionsHtml: string = KeyLabels.buildOptionsHtml(current);
            const $row = jQuery<HTMLTableRowElement>(`
                <tr data-filename="${TrackDisplayUtil.escape(filename)}">
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
                    this.labels.delete(filename);
                } else {
                    this.labels.set(filename, value);
                }
                this.refreshCounter();
            });
            this.$tbody.append($row);
        }
    }

    private async save(): Promise<void> {
        if (this.$saveBtn === null) {
            return;
        }
        const labels: KeyLabelEntry[] = [];
        for (const [filename, key] of this.labels.entries()) {
            labels.push({ filename: filename, key: key });
        }
        this.$saveBtn.prop('disabled', true);
        this.$statusEl?.text(KeyLabels.lang('key_labels_saving'));
        try {
            await KeyLabelsApi.save({ labels: labels });
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