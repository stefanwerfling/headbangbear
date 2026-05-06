import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { AnalyzedTrackEntity } from '../Database/Entity/AnalyzedTrackEntity.js';
import { TrackMetadataEntity } from '../Database/Entity/TrackMetadataEntity.js';

/** Build a fresh in-memory SQLite DataSource for a one-shot CLI invocation.
 *  CLIs are dev tools — they don't share the app's persistent DB, so each run
 *  re-analyses from scratch. The caller is responsible for `await ds.destroy()`
 *  in a `finally`. */
export async function createCliDataSource(): Promise<DataSource> {
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