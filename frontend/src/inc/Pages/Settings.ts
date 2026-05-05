import { Card, ContentCol, ContentColSize, ContentRow, Lang, LangText } from 'bambooo';
import type {
    JellyfinSettings,
    JellyfinTestResult,
    LibrarySource,
    Settings as SettingsData,
} from '@headbangbear/schemas';
import { SettingsApi } from '../Api/SettingsApi.js';
import { BasePage } from './BasePage.js';

/**
 * Settings page — currently exposes the **library source** (Local vs Jellyfin) and a
 * Jellyfin credentials block (URL / API key / User ID) with a test-connection button.
 * Saving the form persists to `<configDir>/.hbb-settings.json` server-side.
 *
 * The Jellyfin source is wired in a follow-up iteration; this page lets you store +
 * verify credentials so they're ready to go when the provider lands.
 */
export class Settings extends BasePage {

    protected override _name: string = 'settings';

    private $card: JQuery<HTMLDivElement> | null = null;

    private $sourceLocal: JQuery<HTMLInputElement> | null = null;

    private $sourceJellyfin: JQuery<HTMLInputElement> | null = null;

    private $jellyfinUrl: JQuery<HTMLInputElement> | null = null;

    private $jellyfinApiKey: JQuery<HTMLInputElement> | null = null;

    private $jellyfinUserId: JQuery<HTMLInputElement> | null = null;

    private $testBtn: JQuery<HTMLButtonElement> | null = null;

    private $saveBtn: JQuery<HTMLButtonElement> | null = null;

    private $testStatus: JQuery<HTMLDivElement> | null = null;

    private $saveStatus: JQuery<HTMLSpanElement> | null = null;

    public constructor() {
        super();
        this.setTitle(new LangText('settings'));
    }

    public override async loadContent(): Promise<void> {
        const content = this.getContent();
        content.empty();

        const cardRow = new ContentRow(content);
        const card = new Card(new ContentCol(cardRow, ContentColSize.col12));
        card.setTitle(new LangText('settings'));

        const $body = card.getBodyElement();
        this.$card = jQuery<HTMLDivElement>(`
            <div>
                <p class="text-muted small">${Settings.lang('settings_help')}</p>

                <div class="form-group">
                    <label class="font-weight-bold mb-2">${Settings.lang('settings_library_source')}</label>
                    <div>
                        <div class="custom-control custom-radio custom-control-inline">
                            <input type="radio" name="hbb-source" value="local" id="hbb-source-local" class="custom-control-input">
                            <label class="custom-control-label" for="hbb-source-local">${Settings.lang('settings_source_local')}</label>
                        </div>
                        <div class="custom-control custom-radio custom-control-inline">
                            <input type="radio" name="hbb-source" value="jellyfin" id="hbb-source-jellyfin" class="custom-control-input">
                            <label class="custom-control-label" for="hbb-source-jellyfin">${Settings.lang('settings_source_jellyfin')}</label>
                        </div>
                    </div>
                    <small class="text-muted">${Settings.lang('settings_source_help')}</small>
                </div>

                <hr>

                <h5 class="mt-3"><i class="fas fa-server mr-1"></i>Jellyfin</h5>
                <p class="text-muted small">${Settings.lang('settings_jellyfin_help')}</p>

                <div class="form-row">
                    <div class="form-group col-md-6">
                        <label>${Settings.lang('settings_jellyfin_url')}</label>
                        <input type="text" class="form-control form-control-sm hbb-jellyfin-url" placeholder="http://localhost:8096" autocomplete="off">
                    </div>
                    <div class="form-group col-md-6">
                        <label>${Settings.lang('settings_jellyfin_user_id')} <small class="text-muted">(${Settings.lang('settings_jellyfin_user_id_optional')})</small></label>
                        <input type="text" class="form-control form-control-sm hbb-jellyfin-user-id" placeholder="${Settings.lang('settings_jellyfin_user_id_placeholder')}" autocomplete="off">
                        <small class="text-muted">${Settings.lang('settings_jellyfin_user_id_help')}</small>
                    </div>
                </div>
                <div class="form-group">
                    <label>${Settings.lang('settings_jellyfin_api_key')}</label>
                    <input type="password" class="form-control form-control-sm hbb-jellyfin-api-key" autocomplete="new-password">
                </div>

                <div class="d-flex align-items-center flex-wrap" style="gap:0.75rem;">
                    <button type="button" class="btn btn-sm btn-secondary hbb-jellyfin-test">
                        <i class="fas fa-plug mr-1"></i>${Settings.lang('settings_jellyfin_test')}
                    </button>
                    <button type="button" class="btn btn-sm btn-primary hbb-settings-save">
                        <i class="fas fa-save mr-1"></i>${Settings.lang('settings_save')}
                    </button>
                    <span class="hbb-save-status text-muted small ml-2"></span>
                </div>
                <div class="hbb-test-status mt-3"></div>
            </div>
        `);
        $body.append(this.$card);

        this.$sourceLocal = this.$card.find<HTMLInputElement>('#hbb-source-local');
        this.$sourceJellyfin = this.$card.find<HTMLInputElement>('#hbb-source-jellyfin');
        this.$jellyfinUrl = this.$card.find<HTMLInputElement>('.hbb-jellyfin-url');
        this.$jellyfinApiKey = this.$card.find<HTMLInputElement>('.hbb-jellyfin-api-key');
        this.$jellyfinUserId = this.$card.find<HTMLInputElement>('.hbb-jellyfin-user-id');
        this.$testBtn = this.$card.find<HTMLButtonElement>('.hbb-jellyfin-test');
        this.$saveBtn = this.$card.find<HTMLButtonElement>('.hbb-settings-save');
        this.$testStatus = this.$card.find<HTMLDivElement>('.hbb-test-status');
        this.$saveStatus = this.$card.find<HTMLSpanElement>('.hbb-save-status');

        this.$testBtn.on('click', (): void => {
            void this.runTest();
        });
        this.$saveBtn.on('click', (): void => {
            void this.runSave();
        });

        await this.populate();
    }

    private async populate(): Promise<void> {
        let settings: SettingsData;
        try {
            settings = await SettingsApi.get();
        } catch (err) {
            this.$saveStatus?.html(
                `<span class="text-danger">${Settings.lang('settings_load_failed')}: ${
                    err instanceof Error ? err.message : String(err)
                }</span>`,
            );
            return;
        }
        if (settings.librarySource === 'jellyfin') {
            this.$sourceJellyfin?.prop('checked', true);
        } else {
            this.$sourceLocal?.prop('checked', true);
        }
        this.$jellyfinUrl?.val(settings.jellyfin.url);
        this.$jellyfinApiKey?.val(settings.jellyfin.apiKey);
        this.$jellyfinUserId?.val(settings.jellyfin.userId);
    }

    private currentJellyfin(): JellyfinSettings {
        return {
            url: this.$jellyfinUrl?.val()?.toString().trim() ?? '',
            apiKey: this.$jellyfinApiKey?.val()?.toString().trim() ?? '',
            userId: this.$jellyfinUserId?.val()?.toString().trim() ?? '',
        };
    }

    private currentSource(): LibrarySource {
        return this.$sourceJellyfin?.is(':checked') === true ? 'jellyfin' : 'local';
    }

    private async runTest(): Promise<void> {
        if (this.$testBtn === null || this.$testStatus === null) {
            return;
        }
        this.$testBtn.prop('disabled', true);
        this.$testStatus.html(
            `<span class="text-muted small"><i class="fas fa-spinner fa-spin mr-1"></i>${Settings.lang('settings_jellyfin_testing')}</span>`,
        );
        let result: JellyfinTestResult;
        try {
            result = await SettingsApi.testJellyfin(this.currentJellyfin());
        } catch (err) {
            this.$testStatus.html(
                `<div class="alert alert-danger py-2 px-3 mb-0 small">${
                    err instanceof Error ? Settings.escape(err.message) : Settings.escape(String(err))
                }</div>`,
            );
            this.$testBtn.prop('disabled', false);
            return;
        }
        this.$testBtn.prop('disabled', false);
        const cls: string = result.ok ? 'alert-success' : 'alert-danger';
        const icon: string = result.ok ? 'fa-check-circle' : 'fa-exclamation-triangle';
        this.$testStatus.html(
            `<div class="alert ${cls} py-2 px-3 mb-0 small d-flex align-items-center">
                <i class="fas ${icon} mr-2"></i>
                <span>${Settings.escape(result.message)}</span>
            </div>`,
        );
        // If the server resolved/discovered a user ID, populate the form so the next
        // Save persists exactly what was tested. Avoids the "tested fine but saved
        // empty" footgun when the user left the field blank for auto-discovery.
        if (result.ok && result.resolvedUserId !== undefined && result.resolvedUserId !== '') {
            this.$jellyfinUserId?.val(result.resolvedUserId);
        }
    }

    private async runSave(): Promise<void> {
        if (this.$saveBtn === null || this.$saveStatus === null) {
            return;
        }
        this.$saveBtn.prop('disabled', true);
        this.$saveStatus.html(
            `<span class="text-muted"><i class="fas fa-spinner fa-spin mr-1"></i>${Settings.lang('settings_saving')}</span>`,
        );
        const body: SettingsData = {
            librarySource: this.currentSource(),
            jellyfin: this.currentJellyfin(),
        };
        try {
            await SettingsApi.save(body);
        } catch (err) {
            this.$saveStatus.html(
                `<span class="text-danger">${Settings.lang('settings_save_failed')}: ${
                    err instanceof Error ? Settings.escape(err.message) : Settings.escape(String(err))
                }</span>`,
            );
            this.$saveBtn.prop('disabled', false);
            return;
        }
        this.$saveBtn.prop('disabled', false);
        this.$saveStatus.html(
            `<span class="text-success"><i class="fas fa-check-circle mr-1"></i>${Settings.lang('settings_saved')}</span>`,
        );
    }

    private static lang(key: string): string {
        return Lang.i().l(key) ?? key;
    }

    private static escape(s: string): string {
        return s
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

}