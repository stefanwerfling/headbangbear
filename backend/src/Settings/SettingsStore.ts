import { promises as fs } from 'node:fs';
import { SettingsSchema, type Settings } from '@headbangbear/schemas';
import { type SchemaErrors } from 'vts';

/** Empty defaults — no providers configured. The Settings UI starts on a blank
 *  list and the user adds entries explicitly. */
export const DEFAULT_SETTINGS: Settings = {
    providers: [],
};

/**
 * JSON-on-disk persistence for the dynamic settings the user edits via the Settings
 * page (the multi-provider library list). Lives next to `backend/config.json` but
 * separately so the static figtree config doesn't get rewritten on every save.
 *
 * Forgiving on read: missing file, bad JSON, or schema mismatch all return the defaults.
 * That way the Settings page boots cleanly on a fresh install and a corrupt save
 * doesn't lock the app. Single-instance pattern; `install()` once at app boot,
 * `getInstance()` everywhere else.
 */
export class SettingsStore {

    private static singleton: SettingsStore | null = null;

    private readonly filePath: string;

    private cached: Settings | null = null;

    public constructor(filePath: string) {
        this.filePath = filePath;
    }

    public static install(filePath: string): SettingsStore {
        SettingsStore.singleton = new SettingsStore(filePath);
        return SettingsStore.singleton;
    }

    public static getInstance(): SettingsStore {
        if (SettingsStore.singleton === null) {
            throw new Error('SettingsStore has not been installed yet');
        }
        return SettingsStore.singleton;
    }

    public async load(): Promise<Settings> {
        if (this.cached !== null) {
            return this.cached;
        }
        let raw: string;
        try {
            raw = await fs.readFile(this.filePath, 'utf8');
        } catch {
            this.cached = SettingsStore.cloneDefaults();
            return this.cached;
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch {
            this.cached = SettingsStore.cloneDefaults();
            return this.cached;
        }
        const errors: SchemaErrors = [];
        if (!SettingsSchema.validate(parsed, errors)) {
            this.cached = SettingsStore.cloneDefaults();
            return this.cached;
        }
        this.cached = parsed;
        return this.cached;
    }

    public async save(settings: Settings): Promise<void> {
        await fs.writeFile(this.filePath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
        this.cached = settings;
    }

    public getFilePath(): string {
        return this.filePath;
    }

    private static cloneDefaults(): Settings {
        return { providers: [] };
    }

}