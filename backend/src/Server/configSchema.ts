import { Config, ConfigBackend } from 'figtree';
import { SchemaConfigBackendOptions } from 'figtree-schemas';
import { Vts, type ExtractSchemaResultType } from 'vts';

/**
 * Headbangbear backend config: figtree's `ConfigBackendOptions` (httpserver, db, logging,
 * cluster — most optional) extended with our `library` block.
 */
export const SchemaHbbConfig = SchemaConfigBackendOptions.extend({
    library: Vts.object({
        /** Absolute path to the directory of `*.mp3` files to index on startup. */
        rootDir: Vts.string(),
    }),
});
export type HbbConfig = ExtractSchemaResultType<typeof SchemaHbbConfig>;

/**
 * `ConfigBackend` subclass bound to {@link SchemaHbbConfig}. `install()` registers itself as
 * the global `Config` singleton so any code calling `Config.getInstance()` /
 * `ConfigBackend.getInstance()` (e.g. `HttpService`) sees the same loaded config.
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