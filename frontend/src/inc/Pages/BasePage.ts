import { Content, LangText, LeftNavbarPushmenu, Wrapper } from 'bambooo';
import { IBasePage } from '../Base/IBasePage.js';
import { IPageLoader } from '../Base/IPageLoader.js';

/**
 * Common base for every Headbangbear page. Owns the bambooo `Wrapper` (sidebar/navbar/preloader
 * skeleton) and exposes `setTitle`, `getContent`, plus lifecycle hooks for the page loader.
 */
export class BasePage implements IBasePage {

    private readonly TITLE: string = 'Headbangbear';

    protected _wrapper: Wrapper = new Wrapper();

    protected _name: string = 'base';

    protected _pageLoader: IPageLoader | null = null;

    public constructor() {
        // eslint-disable-next-line no-new
        new LeftNavbarPushmenu(this._wrapper.getNavbar().getLeftNavbar());

        const preloader = this._wrapper.getPreloader();
        preloader.setTitle(this.TITLE);

        const mainSidebar = this._wrapper.getMainSidebar();
        const logo = mainSidebar.getLogo();
        logo.setTitle(this.TITLE);
        // bambooo's v1 `SidebarLogo.render()` clears + rebuilds img + span on every
        // `setTitle` / `setImage`, so prepending an `<img>` after `setTitle` would just be
        // wiped on the next render. The clean way is `setImage`, which sets the internal
        // src field and triggers a render that picks up both title and image.
        logo.setImage('assets/img/logo.png');
    }

    public getWrapper(): Wrapper {
        return this._wrapper;
    }

    public getName(): string {
        return this._name;
    }

    protected setTitle(title: string | LangText): void {
        this._wrapper.getContentWrapper().getContentHeader().setTitle(title);
    }

    public getContent(): Content {
        return this._wrapper.getContentWrapper().getContent();
    }

    public async loadContent(): Promise<void> {
        // overridden by subclasses
    }

    public async unloadContent(): Promise<void> {
        // overridden by subclasses
    }

    public setPageLoader(loader: IPageLoader): void {
        this._pageLoader = loader;
    }

}