import { Lang, LangText, RightNavbar, SidebarMenuItem } from 'bambooo';
import { Vts } from 'vts';
import { Lang_DE } from '../langs/Lang_DE.js';
import { Lang_EN } from '../langs/Lang_EN.js';
import { IPageLoader } from './Base/IPageLoader.js';
import { PageSideMenuEntry } from './Base/PageSideMenuEntry.js';
import { BasePage } from './Pages/BasePage.js';
import { DjSet as DjSetPage } from './Pages/DjSet.js';
import { Home as HomePage } from './Pages/Home.js';
import { KeyLabels as KeyLabelsPage } from './Pages/KeyLabels.js';
import { Library as LibraryPage } from './Pages/Library.js';

const LANG_STORAGE_KEY: string = 'hbb.lang.v1';

/**
 * Singleton that owns the navbar/sidemenu, hands them to whichever `BasePage` is being shown,
 * and switches between pages on menu click. No auth/ACL — every entry in `_sideMenuList` is
 * always reachable. Also wires the top-right language switcher (EN/DE), persisting the user's
 * choice in localStorage and re-rendering the current page on switch so newly-set DOM strings
 * pick up the new language.
 */
export class PageLoader implements IPageLoader {

    private static _instance: IPageLoader | null = null;

    public static getInstance(): IPageLoader {
        if (PageLoader._instance === null) {
            PageLoader._instance = new PageLoader();
        }
        return PageLoader._instance;
    }

    protected _currentPage: BasePage | null = null;

    protected _sideMenuList: PageSideMenuEntry[] = [
        {
            title: new LangText('home'),
            icon: 'nav-icon fas fa-home',
            name: 'home',
            page: HomePage
        },
        {
            title: new LangText('library'),
            icon: 'nav-icon fas fa-music',
            name: 'library',
            page: LibraryPage
        },
        {
            title: new LangText('dj_set'),
            icon: 'nav-icon fas fa-record-vinyl',
            name: 'dj-set',
            page: DjSetPage
        },
        {
            title: new LangText('key_labels'),
            icon: 'nav-icon fas fa-tag',
            name: 'key-labels',
            page: KeyLabelsPage
        }
    ];

    public constructor() {
        Lang.init([new Lang_EN(), new Lang_DE()]);
        const stored: string | null = PageLoader.readStoredLang();
        Lang.i(stored ?? 'Lang_EN');
        jQuery('#hbb_page_title').html(Lang.i().l('title') ?? 'Headbangbear');
    }

    private static readStoredLang(): string | null {
        try {
            const v: string | null = window.localStorage.getItem(LANG_STORAGE_KEY);
            if (v === 'Lang_EN' || v === 'Lang_DE') {
                return v;
            }
            return null;
        } catch {
            return null;
        }
    }

    private static writeStoredLang(lang: string): void {
        try {
            window.localStorage.setItem(LANG_STORAGE_KEY, lang);
        } catch {
            // localStorage unavailable (private mode, etc.) — soft-fail
        }
    }

    /**
     * Builds the EN/DE flag buttons in the top-right navbar. Click swaps the active language,
     * persists it, then re-runs `loadContent` on the current page so freshly-rendered strings
     * pick up the new language (`Lang.lAll` alone only updates `LangText`-bound elements; raw
     * HTML literals built in `loadContent` need a re-render).
     */
    private _wireLanguageSwitcher(page: BasePage): void {
        const rightNav: RightNavbar = page.getWrapper().getNavbar().getRightNavbar();
        const $ul: JQuery<HTMLElement> = rightNav.getElement();

        const stored: string = PageLoader.readStoredLang() ?? 'Lang_EN';
        const enActive: string = stored === 'Lang_EN' ? 'btn-primary' : 'btn-default';
        const deActive: string = stored === 'Lang_DE' ? 'btn-primary' : 'btn-default';

        const $li: JQuery<HTMLLIElement> = jQuery<HTMLLIElement>(`
            <li class="nav-item d-flex align-items-center hbb-lang-switch ml-2">
                <button type="button" class="btn btn-xs ${enActive} hbb-lang-btn" data-lang="Lang_EN" title="English">
                    🇺🇸 EN
                </button>
                <button type="button" class="btn btn-xs ${deActive} hbb-lang-btn ml-1" data-lang="Lang_DE" title="Deutsch">
                    🇩🇪 DE
                </button>
            </li>
        `);
        $ul.append($li);

        $li.find<HTMLButtonElement>('.hbb-lang-btn').on('click', (e): void => {
            const target: string | undefined = jQuery(e.currentTarget).attr('data-lang');
            if (target !== 'Lang_EN' && target !== 'Lang_DE') {
                return;
            }
            if ((PageLoader.readStoredLang() ?? 'Lang_EN') === target) {
                return;
            }
            PageLoader.writeStoredLang(target);
            const next: Lang_EN | Lang_DE = target === 'Lang_DE' ? new Lang_DE() : new Lang_EN();
            Lang.i().setCurrentLang(next);
            jQuery('#hbb_page_title').html(Lang.i().l('title') ?? 'Headbangbear');
            if (this._currentPage !== null) {
                const Ctor: new () => BasePage = this._currentPage.constructor as new () => BasePage;
                void this.load(new Ctor());
            }
        });
    }

    protected async _loadSidemenu(page: BasePage): Promise<void> {
        const menu = page.getWrapper().getMainSidebar().getSidebar().getMenu();
        // eslint-disable-next-line @typescript-eslint/no-this-alias,consistent-this
        const pageLoader = this;

        for (const item of this._sideMenuList) {
            const menuItem = new SidebarMenuItem(menu);
            menuItem.setName(item.name);
            menuItem.setTitle(item.title);
            menuItem.setIconClass(item.icon);

            if (item.page) {
                menuItem.setClick((): void => {
                    if (!Vts.isUndefined(item.page)) {
                        void pageLoader.load(new item.page());
                    }
                });
            }

            if (page.getName() === item.name) {
                menuItem.setActiv(true);
            }
        }

        menu.initTreeview();
    }

    public async load(page: BasePage): Promise<boolean> {
        const preloader = page.getWrapper().getPreloader();

        try {
            if (this._currentPage) {
                await this._currentPage.unloadContent();
            }

            page.setPageLoader(this);
            await this._loadSidemenu(page);
            this._wireLanguageSwitcher(page);
            await page.loadContent();

            preloader.readyLoad();
            this._currentPage = page;

            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-expect-error AdminLTE jQuery plugin
            $('[data-widget="pushmenu"]').PushMenu();
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-expect-error AdminLTE jQuery plugin
            $('[data-widget="treeview"]').Treeview('init');

            window.dispatchEvent(new Event('resize'));

            Lang.i().lAll();
        } catch (e) {
            console.error('PageLoader::load:', e);
        }

        return true;
    }

}