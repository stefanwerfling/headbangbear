import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { AnalyzedTrackEntity } from '../../src/Database/Entity/AnalyzedTrackEntity.js';
import { TrackMetadataEntity } from '../../src/Database/Entity/TrackMetadataEntity.js';

/** Build a fresh in-memory SQLite DataSource with the production entities registered.
 *  Use one per test so tables start empty. The caller is responsible for
 *  `await ds.destroy()` in `afterEach`. */
export async function createInMemoryDataSource(): Promise<DataSource> {
    const ds: DataSource = new DataSource({
        type: 'better-sqlite3',
        database: ':memory:',
        synchronize: true,
        entities: [AnalyzedTrackEntity, TrackMetadataEntity],
        logging: false,
    });
    await ds.initialize();
    return ds;
}