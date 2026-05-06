import { Config, ConfigBackend } from 'figtree';
import { SchemaConfigBackendOptions } from 'figtree-schemas';
import { Vts, type ExtractSchemaResultType } from 'vts';

/**
 * SQLite database connection. `file` is an absolute or process-cwd-relative path
 * to the on-disk DB file. `:memory:` is accepted but only useful for tests.
 */
export const SchemaSqliteDatabase = Vts.object({
    kind: Vts.equal('sqlite' as const),
    file: Vts.string(),
});

/**
 * MariaDB / MySQL database connection. Used in the future when a multi-instance
 * setup is needed — for the SQLite-only first cut, this branch is selectable but
 * the actual TypeORM driver wiring is still verified with the same `mysql2`
 * package figtree pulls in.
 */
export const SchemaMariaDbDatabase = Vts.object({
    kind: Vts.equal('mariadb' as const),
    host: Vts.string(),
    port: Vts.number(),
    database: Vts.string(),
    username: Vts.string(),
    password: Vts.string(),
});

export const SchemaHbbDatabase = Vts.or([SchemaSqliteDatabase, SchemaMariaDbDatabase]);
export type HbbDatabaseConfig = ExtractSchemaResultType<typeof SchemaHbbDatabase>;

/**
 * Headbangbear backend config: figtree's `ConfigBackendOptions` (httpserver, db,
 * logging, cluster) extended with our app-specific blocks:
 *
 *  - `dataDir` — root for app-managed working data (cover-art cache + the SQLite
 *    file when `database.kind === 'sqlite'`). Per-library music folders live in
 *    the dynamic `.hbb-settings.json` providers list, not here.
 *  - `database` — TypeORM connection, SQLite for now, MariaDB selectable.
 *
 * Fields can also be overridden via env vars at load time — see
 * {@link applyEnvOverrides}.
 */
export const SchemaHbbConfig = SchemaConfigBackendOptions.extend({
    dataDir: Vts.string(),
    database: SchemaHbbDatabase,
    /** Cap (in bytes) for the local audio cache that mirrors Jellyfin downloads.
     *  Optional — when omitted, defaults to 5 GiB at runtime. Override via the
     *  `HBB_AUDIO_CACHE_MAX_BYTES` env var. Local providers don't use the cache
     *  (the audio is already on disk), so this knob only affects Jellyfin libs. */
    audioCacheMaxBytes: Vts.optional(Vts.number()),
});
export type HbbConfig = ExtractSchemaResultType<typeof SchemaHbbConfig>;

/**
 * Layer environment variables on top of a config object loaded from `config.json`.
 * Mutates and returns the same object so callers can chain. Recognised vars:
 *
 *  - `HBB_DATA_DIR` — overrides `dataDir`
 *  - `HBB_DATABASE_KIND` — `'sqlite'` or `'mariadb'`. Switches the database branch
 *    and reads the matching connection vars from the env (the JSON-loaded values
 *    for that branch are discarded if all required env vars are present).
 *  - SQLite branch: `HBB_DATABASE_FILE`
 *  - MariaDB branch: `HBB_DATABASE_HOST`, `_PORT`, `_NAME`, `_USER`, `_PASSWORD`
 *
 * Missing or empty env vars leave the JSON-loaded value in place. Per-provider
 * (library) settings are intentionally NOT env-overridable — those live in
 * `.hbb-settings.json` and are user-edited via the Settings UI.
 */
export function applyEnvOverrides(config: HbbConfig): HbbConfig {
    const env: NodeJS.ProcessEnv = process.env;
    const dataDirOverride: string | undefined = env['HBB_DATA_DIR'];
    if (dataDirOverride !== undefined && dataDirOverride.length > 0) {
        config.dataDir = dataDirOverride;
    }
    const audioCacheOverride: string | undefined = env['HBB_AUDIO_CACHE_MAX_BYTES'];
    if (audioCacheOverride !== undefined && audioCacheOverride.length > 0) {
        const parsed: number = Number.parseInt(audioCacheOverride, 10);
        if (Number.isFinite(parsed) && parsed > 0) {
            config.audioCacheMaxBytes = parsed;
        }
    }
    const dbKindOverride: string | undefined = env['HBB_DATABASE_KIND'];
    if (dbKindOverride === 'sqlite') {
        const file: string | undefined = env['HBB_DATABASE_FILE'];
        if (file !== undefined && file.length > 0) {
            config.database = { kind: 'sqlite', file: file };
        }
    } else if (dbKindOverride === 'mariadb') {
        const host: string | undefined = env['HBB_DATABASE_HOST'];
        const portRaw: string | undefined = env['HBB_DATABASE_PORT'];
        const database: string | undefined = env['HBB_DATABASE_NAME'];
        const username: string | undefined = env['HBB_DATABASE_USER'];
        const password: string | undefined = env['HBB_DATABASE_PASSWORD'];
        if (
            host !== undefined && host.length > 0
            && portRaw !== undefined && portRaw.length > 0
            && database !== undefined && database.length > 0
            && username !== undefined
        ) {
            config.database = {
                kind: 'mariadb',
                host: host,
                port: Number(portRaw),
                database: database,
                username: username,
                password: password ?? '',
            };
        }
    } else if (config.database.kind === 'sqlite') {
        // Per-field overrides without changing `kind`.
        const file: string | undefined = env['HBB_DATABASE_FILE'];
        if (file !== undefined && file.length > 0) {
            config.database.file = file;
        }
    } else {
        // MariaDB per-field overrides without flipping `kind`.
        const host: string | undefined = env['HBB_DATABASE_HOST'];
        const portRaw: string | undefined = env['HBB_DATABASE_PORT'];
        const database: string | undefined = env['HBB_DATABASE_NAME'];
        const username: string | undefined = env['HBB_DATABASE_USER'];
        const password: string | undefined = env['HBB_DATABASE_PASSWORD'];
        if (host !== undefined && host.length > 0) {
            config.database.host = host;
        }
        if (portRaw !== undefined && portRaw.length > 0) {
            config.database.port = Number(portRaw);
        }
        if (database !== undefined && database.length > 0) {
            config.database.database = database;
        }
        if (username !== undefined) {
            config.database.username = username;
        }
        if (password !== undefined) {
            config.database.password = password;
        }
    }
    return config;
}

/**
 * `ConfigBackend` subclass bound to {@link SchemaHbbConfig}. `install()` registers
 * itself as the global `Config` singleton so any code calling `Config.getInstance()`
 * / `ConfigBackend.getInstance()` (e.g. `HttpService`) sees the same loaded config.
 */
export class HbbConfigBackend extends ConfigBackend<HbbConfig> {
    public constructor() {
        super(SchemaHbbConfig);
    }

    public static install(): HbbConfigBackend {
        const inst: HbbConfigBackend = new HbbConfigBackend();
        // Config._instance is `protected static`; we need to override it to plant our extended
        // schema as the process-wide singleton. There is no public seam in figtree for this.
        const configClass: { _instance: Config | null } = Config as unknown as {
            _instance: Config | null;
        };
        configClass._instance = inst;
        return inst;
    }
}