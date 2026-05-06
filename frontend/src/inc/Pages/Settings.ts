import { Card, ContentCol, ContentColSize, ContentRow, Lang, LangText } from 'bambooo';
import type {
    JellyfinConnection,
    JellyfinLibraryProvider,
    JellyfinTestResult,
    LibraryProvider,
    LocalLibraryProvider,
    Settings as SettingsData,
} from '@headbangbear/schemas';
import { SettingsApi } from '../Api/SettingsApi.js';
import { BasePage } from './BasePage.js';

/**
 * Settings page — manages the user's configured **library providers**. Each provider is
 * either a local directory (`kind: 'local'`) or a Jellyfin server (`kind: 'jellyfin'`).
 * Multiple of each kind are allowed; an empty list is also valid (the rest of the app
 * just shows empty Library / Setlist views).
 *
 * Saving persists the whole `providers[]` array to `<configDir>/.hbb-settings.json`. A
 * per-Jellyfin-entry "Test connection" button hits the backend probe route without
 * persisting — the UX is "test before save" so a typo can't overwrite working credentials.
 */
export class Settings extends BasePage {

    protected override _name: string = 'settings';

    private providers: LibraryProvider[] = [];

    private $card: JQuery<HTMLDivElement> | null = null;

    private $providersList: JQuery<HTMLDivElement> | null = null;

    private $saveBtn: JQuery<HTMLButtonElement> | null = null;

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

                <div class="d-flex align-items-center mb-3" style="gap:0.5rem;">
                    <button type="button" class="btn btn-sm btn-outline-primary hbb-add-local">
                        <i class="fas fa-folder-plus mr-1"></i>${Settings.lang('settings_add_local')}
                    </button>
                    <button type="button" class="btn btn-sm btn-outline-primary hbb-add-jellyfin">
                        <i class="fas fa-server mr-1"></i>${Settings.lang('settings_add_jellyfin')}
                    </button>
                </div>

                <div class="hbb-providers-list"></div>

                <hr>

                <div class="d-flex align-items-center" style="gap:0.75rem;">
                    <button type="button" class="btn btn-sm btn-primary hbb-settings-save">
                        <i class="fas fa-save mr-1"></i>${Settings.lang('settings_save')}
                    </button>
                    <span class="hbb-save-status text-muted small ml-2"></span>
                </div>
            </div>
        `);
        $body.append(this.$card);

        this.$providersList = this.$card.find<HTMLDivElement>('.hbb-providers-list');
        this.$saveBtn = this.$card.find<HTMLButtonElement>('.hbb-settings-save');
        this.$saveStatus = this.$card.find<HTMLSpanElement>('.hbb-save-status');

        this.$card.find<HTMLButtonElement>('.hbb-add-local').on('click', (): void => {
            this.providers.push(Settings.newLocalProvider());
            this.renderProviders();
        });
        this.$card.find<HTMLButtonElement>('.hbb-add-jellyfin').on('click', (): void => {
            this.providers.push(Settings.newJellyfinProvider());
            this.renderProviders();
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
        // Clone so the in-memory state is detached from the SettingsApi response object
        // (avoids surprising aliasing if the response is cached upstream).
        this.providers = settings.providers.map((p): LibraryProvider => ({ ...p }));
        this.renderProviders();
    }

    private renderProviders(): void {
        if (this.$providersList === null) {
            return;
        }
        this.$providersList.empty();
        if (this.providers.length === 0) {
            this.$providersList.append(jQuery<HTMLDivElement>(`
                <div class="alert alert-info small mb-0">
                    <i class="fas fa-info-circle mr-1"></i>${Settings.lang('settings_no_providers')}
                </div>
            `));
            return;
        }
        for (let i = 0; i < this.providers.length; i++) {
            const provider: LibraryProvider | undefined = this.providers[i];
            if (provider === undefined) {
                continue;
            }
            this.$providersList.append(this.renderProviderCard(provider, i));
        }
    }

    private renderProviderCard(provider: LibraryProvider, index: number): JQuery<HTMLDivElement> {
        if (provider.kind === 'local') {
            return this.renderLocalCard(provider, index);
        }
        return this.renderJellyfinCard(provider, index);
    }

    private renderLocalCard(provider: LocalLibraryProvider, index: number): JQuery<HTMLDivElement> {
        const $card: JQuery<HTMLDivElement> = jQuery<HTMLDivElement>(`
            <div class="card mb-3">
                <div class="card-header py-2 d-flex align-items-center" style="gap:0.5rem;">
                    <span class="badge badge-info">${Settings.lang('settings_provider_local')}</span>
                    <strong class="hbb-provider-id-display flex-grow-1">${Settings.escape(provider.id)}</strong>
                    <button type="button" class="btn btn-sm btn-outline-danger hbb-remove-provider">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
                <div class="card-body py-2">
                    <div class="form-row">
                        <div class="form-group col-md-4">
                            <label class="small mb-1">${Settings.lang('settings_provider_id')}</label>
                            <input type="text" class="form-control form-control-sm hbb-input-id" value="${Settings.escape(provider.id)}" autocomplete="off">
                        </div>
                        <div class="form-group col-md-8">
                            <label class="small mb-1">${Settings.lang('settings_local_root_dir')}</label>
                            <input type="text" class="form-control form-control-sm hbb-input-rootdir" value="${Settings.escape(provider.rootDir)}" placeholder="/path/to/library" autocomplete="off">
                        </div>
                    </div>
                </div>
            </div>
        `);
        const $idInput = $card.find<HTMLInputElement>('.hbb-input-id');
        const $rootDirInput = $card.find<HTMLInputElement>('.hbb-input-rootdir');
        const $idDisplay = $card.find<HTMLSpanElement>('.hbb-provider-id-display');
        $idInput.on('input', (): void => {
            const next: string = $idInput.val()?.toString() ?? '';
            this.providers[index] = { ...provider, id: next };
            $idDisplay.text(next === '' ? '—' : next);
        });
        $rootDirInput.on('input', (): void => {
            this.providers[index] = { ...provider, rootDir: $rootDirInput.val()?.toString() ?? '' };
        });
        $card.find<HTMLButtonElement>('.hbb-remove-provider').on('click', (): void => {
            this.providers.splice(index, 1);
            this.renderProviders();
        });
        return $card;
    }

    private renderJellyfinCard(provider: JellyfinLibraryProvider, index: number): JQuery<HTMLDivElement> {
        const $card: JQuery<HTMLDivElement> = jQuery<HTMLDivElement>(`
            <div class="card mb-3">
                <div class="card-header py-2 d-flex align-items-center" style="gap:0.5rem;">
                    <span class="badge badge-purple">${Settings.lang('settings_provider_jellyfin')}</span>
                    <strong class="hbb-provider-id-display flex-grow-1">${Settings.escape(provider.id)}</strong>
                    <button type="button" class="btn btn-sm btn-outline-danger hbb-remove-provider">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
                <div class="card-body py-2">
                    <div class="form-row">
                        <div class="form-group col-md-4">
                            <label class="small mb-1">${Settings.lang('settings_provider_id')}</label>
                            <input type="text" class="form-control form-control-sm hbb-input-id" value="${Settings.escape(provider.id)}" autocomplete="off">
                        </div>
                        <div class="form-group col-md-8">
                            <label class="small mb-1">${Settings.lang('settings_jellyfin_url')}</label>
                            <input type="text" class="form-control form-control-sm hbb-input-url" value="${Settings.escape(provider.url)}" placeholder="http://localhost:8096" autocomplete="off">
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group col-md-6">
                            <label class="small mb-1">${Settings.lang('settings_jellyfin_user_id')}</label>
                            <input type="text" class="form-control form-control-sm hbb-input-user-id" value="${Settings.escape(provider.userId)}" placeholder="${Settings.lang('settings_jellyfin_user_id_placeholder')}" autocomplete="off">
                        </div>
                        <div class="form-group col-md-6">
                            <label class="small mb-1">${Settings.lang('settings_jellyfin_api_key')}</label>
                            <input type="password" class="form-control form-control-sm hbb-input-api-key" value="${Settings.escape(provider.apiKey)}" autocomplete="new-password">
                        </div>
                    </div>
                    <div class="form-group">
                        <label class="small mb-1">${Settings.lang('settings_jellyfin_exclude_patterns')}</label>
                        <textarea class="form-control form-control-sm hbb-input-exclude" rows="3" placeholder="${Settings.lang('settings_jellyfin_exclude_placeholder')}">${Settings.escape((provider.excludePatterns ?? []).join('\n'))}</textarea>
                        <small class="form-text text-muted">${Settings.lang('settings_jellyfin_exclude_help')}</small>
                    </div>
                    <div class="d-flex align-items-center" style="gap:0.5rem;">
                        <button type="button" class="btn btn-sm btn-secondary hbb-test-jellyfin">
                            <i class="fas fa-plug mr-1"></i>${Settings.lang('settings_jellyfin_test')}
                        </button>
                        <span class="hbb-test-status small"></span>
                    </div>
                </div>
            </div>
        `);
        const $idInput = $card.find<HTMLInputElement>('.hbb-input-id');
        const $urlInput = $card.find<HTMLInputElement>('.hbb-input-url');
        const $userIdInput = $card.find<HTMLInputElement>('.hbb-input-user-id');
        const $apiKeyInput = $card.find<HTMLInputElement>('.hbb-input-api-key');
        const $excludeInput = $card.find<HTMLTextAreaElement>('.hbb-input-exclude');
        const $idDisplay = $card.find<HTMLSpanElement>('.hbb-provider-id-display');
        const $testStatus = $card.find<HTMLSpanElement>('.hbb-test-status');
        const $testBtn = $card.find<HTMLButtonElement>('.hbb-test-jellyfin');
        const writeBack = (): void => {
            const excludeRaw: string = $excludeInput.val()?.toString() ?? '';
            const excludePatterns: string[] = excludeRaw
                .split('\n')
                .map((s: string): string => s.trim())
                .filter((s: string): boolean => s.length > 0);
            const next: JellyfinLibraryProvider = {
                id: $idInput.val()?.toString() ?? '',
                type: 'library',
                kind: 'jellyfin',
                url: $urlInput.val()?.toString() ?? '',
                userId: $userIdInput.val()?.toString() ?? '',
                apiKey: $apiKeyInput.val()?.toString() ?? '',
            };
            // Only include excludePatterns when non-empty so the persisted JSON
            // stays clean (omit-when-default convention used elsewhere).
            if (excludePatterns.length > 0) {
                (next as { excludePatterns?: string[] }).excludePatterns = excludePatterns;
            }
            this.providers[index] = next;
        };
        $idInput.on('input', (): void => {
            writeBack();
            const next: string = $idInput.val()?.toString() ?? '';
            $idDisplay.text(next === '' ? '—' : next);
        });
        $urlInput.on('input', writeBack);
        $userIdInput.on('input', writeBack);
        $excludeInput.on('input', writeBack);
        $apiKeyInput.on('input', writeBack);
        $testBtn.on('click', (): void => {
            void this.runJellyfinTest(index, $testBtn, $testStatus, $userIdInput);
        });
        $card.find<HTMLButtonElement>('.hbb-remove-provider').on('click', (): void => {
            this.providers.splice(index, 1);
            this.renderProviders();
        });
        return $card;
    }

    private async runJellyfinTest(
        index: number,
        $btn: JQuery<HTMLButtonElement>,
        $status: JQuery<HTMLSpanElement>,
        $userIdInput: JQuery<HTMLInputElement>,
    ): Promise<void> {
        const provider: LibraryProvider | undefined = this.providers[index];
        if (provider === undefined || provider.kind !== 'jellyfin') {
            return;
        }
        const body: JellyfinConnection = {
            url: provider.url.trim(),
            apiKey: provider.apiKey.trim(),
            userId: provider.userId.trim(),
        };
        $btn.prop('disabled', true);
        $status.html(
            `<span class="text-muted"><i class="fas fa-spinner fa-spin mr-1"></i>${Settings.lang('settings_jellyfin_testing')}</span>`,
        );
        let result: JellyfinTestResult;
        try {
            result = await SettingsApi.testJellyfin(body);
        } catch (err) {
            $status.html(
                `<span class="text-danger">${
                    err instanceof Error ? Settings.escape(err.message) : Settings.escape(String(err))
                }</span>`,
            );
            $btn.prop('disabled', false);
            return;
        }
        $btn.prop('disabled', false);
        const cls: string = result.ok ? 'text-success' : 'text-danger';
        const icon: string = result.ok ? 'fa-check-circle' : 'fa-exclamation-triangle';
        $status.html(
            `<span class="${cls}"><i class="fas ${icon} mr-1"></i>${Settings.escape(result.message)}</span>`,
        );
        // If the server resolved/discovered a user ID, populate the field so the next
        // Save persists exactly what was tested. Avoids the "tested fine but saved
        // empty" footgun when the user left the field blank for auto-discovery.
        if (result.ok && result.resolvedUserId !== undefined && result.resolvedUserId !== '') {
            $userIdInput.val(result.resolvedUserId);
            const current: LibraryProvider | undefined = this.providers[index];
            if (current !== undefined && current.kind === 'jellyfin') {
                this.providers[index] = { ...current, userId: result.resolvedUserId };
            }
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
        const body: SettingsData = { providers: this.providers };
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

    private static newLocalProvider(): LocalLibraryProvider {
        return {
            id: `local-${Settings.shortRandomId()}`,
            type: 'library',
            kind: 'local',
            rootDir: '',
        };
    }

    private static newJellyfinProvider(): JellyfinLibraryProvider {
        return {
            id: `jellyfin-${Settings.shortRandomId()}`,
            type: 'library',
            kind: 'jellyfin',
            url: '',
            apiKey: '',
            userId: '',
        };
    }

    private static shortRandomId(): string {
        return Math.random().toString(36).slice(2, 8);
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