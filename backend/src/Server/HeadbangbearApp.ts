import { join } from 'node:path';
import { BackendApp, ConfigBackend, HttpService } from 'figtree';
import type { DefaultArgs } from 'figtree-schemas';
import { SettingsStore } from '../Settings/SettingsStore.js';
import { applyCspOverride } from './applyCspOverride.js';
import { LibraryService } from './LibraryService.js';
import { HbbRouteLoader } from './HbbRouteLoader.js';
import { HbbConfigBackend, type HbbConfig } from './configSchema.js';

/**
 * Headbangbear backend application. Boots the figtree `HttpService` plus our custom
 * `LibraryService` (which scans + caches the configured library on startup). HTTP only —
 * no MariaDB, Redis, sessions, or auth in this iteration.
 */
export class HeadbangbearApp extends BackendApp<DefaultArgs, HbbConfig> {
    private readonly configInstance: HbbConfigBackend;

    public constructor() {
        super('headbangbear');
        this.configInstance = HbbConfigBackend.install();
        // Settings store path is process-cwd relative — typically the backend workspace
        // dir on `npm run dev`, alongside `config.json`. Keeps the user-edited settings
        // out of the static figtree config so saving from the UI doesn't rewrite that.
        SettingsStore.install(join(process.cwd(), '.hbb-settings.json'));
        applyCspOverride();
    }

    protected override _getConfigInstance(): ConfigBackend {
        return this.configInstance;
    }

    protected override async _initServices(): Promise<void> {
        const config: HbbConfig | null = this.configInstance.get();
        if (config === null) {
            throw new Error('HeadbangbearApp: configuration not loaded');
        }
        // LibraryService must start before HttpService so HbbRouteLoader can reach the library.
        this._serviceManager.add(new LibraryService(config.library.rootDir));
        this._serviceManager.add(new HttpService(HbbRouteLoader, 'http', [LibraryService.NAME]));
    }
}