import { isAbsolute, resolve } from 'node:path';
import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { ServiceAbstract } from 'figtree';
import { ServiceStatus } from 'figtree-schemas';
import 'reflect-metadata';
import { DataSource, type EntityTarget, type ObjectLiteral, type Repository } from 'typeorm';
import { AnalyzedTrackEntity } from './Entity/AnalyzedTrackEntity.js';
import { TrackMetadataEntity } from './Entity/TrackMetadataEntity.js';
import type { HbbDatabaseConfig } from '../Server/configSchema.js';

/** All entities the app needs registered with the DataSource. New entities go here.
 *  Returned freshly from a function so the typeorm `entities` option (which expects
 *  a mutable array of class refs) doesn't fight a `readonly` constant.
 *  Type is `Function[]` because that's what `DataSourceOptions.entities` accepts for
 *  decorator-based entity classes (a class constructor IS a Function). */
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
function entityList(): Function[] {
    return [AnalyzedTrackEntity, TrackMetadataEntity];
}

/**
 * figtree service that owns the TypeORM `DataSource` for the entire process. Started
 * before {@link LibraryService} so the libraries can hand out repositories to the
 * scan/analysis code.
 *
 * - `synchronize: true` for now: schema is auto-derived from the entities at boot.
 *   That's fine in dev because we declared "no migration on this iter" — a schema
 *   change wipes user data. Once the shape stabilises, switch to TypeORM migrations.
 * - SQLite paths in `database.file` resolve against `process.cwd()` if relative.
 *   Parent directory is created on demand so `dataDir` doesn't have to exist before
 *   first boot.
 * - MariaDB branch is wired but not yet exercised; intentionally kept identical
 *   shape so the only switching cost later is a config edit.
 */
export class DatabaseService extends ServiceAbstract {

    public static readonly NAME: string = 'database';

    private static singleton: DatabaseService | null = null;

    private readonly config: HbbDatabaseConfig;

    private dataSource: DataSource | null = null;

    public constructor(config: HbbDatabaseConfig) {
        super(DatabaseService.NAME);
        this.config = config;
        DatabaseService.singleton = this;
    }

    public static getInstance(): DatabaseService {
        if (DatabaseService.singleton === null) {
            throw new Error('DatabaseService has not been instantiated yet');
        }
        return DatabaseService.singleton;
    }

    public override async start(): Promise<void> {
        this._inProcess = true;
        this._status = ServiceStatus.Progress;
        try {
            const ds: DataSource = await this.buildDataSource();
            await ds.initialize();
            this.dataSource = ds;
            this._status = ServiceStatus.Success;
        } catch (err) {
            this._status = ServiceStatus.Error;
            this._statusMsg = `DatabaseService::start: ${String(err)}`;
            throw err;
        } finally {
            this._inProcess = false;
        }
    }

    public override async stop(_forced?: boolean): Promise<void> {
        if (this.dataSource !== null && this.dataSource.isInitialized) {
            await this.dataSource.destroy();
        }
        this.dataSource = null;
        this._status = ServiceStatus.None;
    }

    public getDataSource(): DataSource {
        if (this.dataSource === null) {
            throw new Error('DatabaseService.start() has not completed yet');
        }
        return this.dataSource;
    }

    public getRepository<T extends ObjectLiteral>(entity: EntityTarget<T>): Repository<T> {
        return this.getDataSource().getRepository(entity);
    }

    private async buildDataSource(): Promise<DataSource> {
        if (this.config.kind === 'sqlite') {
            const file: string = isAbsolute(this.config.file)
                ? this.config.file
                : resolve(process.cwd(), this.config.file);
            // Create parent dir on first boot so a config like `dataDir: "./.hbb-data"` +
            // `database.file: "./.hbb-data/hbb.db"` works without a manual mkdir step.
            if (file !== ':memory:') {
                await fs.mkdir(dirname(file), { recursive: true });
            }
            return new DataSource({
                type: 'better-sqlite3',
                database: file,
                synchronize: true,
                entities: entityList(),
                // Statement-level cache disabled — better-sqlite3 is already in-process.
                cache: false,
                logging: false,
            });
        }
        return new DataSource({
            type: 'mariadb',
            host: this.config.host,
            port: this.config.port,
            database: this.config.database,
            username: this.config.username,
            password: this.config.password,
            synchronize: true,
            entities: entityList(),
            logging: false,
        });
    }

    /** Test seam: bind a pre-initialised DataSource (typically `:memory:` SQLite for
     *  unit tests) so library/scan code can reach it via `getInstance()`. */
    public static override(dataSource: DataSource): DatabaseService {
        const svc: DatabaseService = Object.create(DatabaseService.prototype) as DatabaseService;
        Object.defineProperty(svc, 'config', {
            value: { kind: 'sqlite', file: ':memory:' } satisfies HbbDatabaseConfig,
        });
        Object.defineProperty(svc, 'dataSource', { value: dataSource, writable: true });
        DatabaseService.singleton = svc;
        return svc;
    }
}