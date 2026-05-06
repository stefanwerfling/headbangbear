import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import type { MusicalKey } from '../../Analysis/schemas.js';

/**
 * Persistent counterpart of `AnalysisResult`. Composite primary key is
 * `(providerId, sourceId)` — `providerId` is the user-defined ID from the
 * Settings provider list (e.g. `"main-music"`, `"jellyfin-home"`); `sourceId`
 * is the per-provider identifier (relative path for `local`, item-UUID for
 * `jellyfin`).
 *
 * `mtime` and `size` are stored as `double` (`REAL` on SQLite, `DOUBLE` on
 * MariaDB) so they fit any millisecond timestamp / file size without losing
 * precision and without the `bigint`-as-string TypeORM gotcha.
 *
 * Array columns (`beats`, `energyTimeline`, `drops`) use TypeORM's
 * `simple-json` which serialises through `JSON.stringify` and stores as TEXT
 * on either driver — fine for our payload sizes (a long energy timeline at
 * 1-Hz sampling is still well under 100 KB / track).
 */
@Entity({ name: 'analyzed_tracks' })
@Index(['providerId'])
export class AnalyzedTrackEntity {

    @PrimaryColumn({ type: 'varchar', length: 64 })
    public providerId!: string;

    @PrimaryColumn({ type: 'varchar', length: 512 })
    public sourceId!: string;

    @Column({ type: 'double' })
    public mtime!: number;

    @Column({ type: 'double' })
    public size!: number;

    /** `MusicalKey` object as `{tonic, mode}` — stored via `simple-json` so the same
     *  shape the analyser returns round-trips without lossy string encoding. */
    @Column({ type: 'simple-json' })
    public musicalKey!: MusicalKey;

    @Column({ type: 'varchar', length: 8 })
    public camelot!: string;

    @Column({ type: 'varchar', length: 8 })
    public openKey!: string;

    @Column({ type: 'double' })
    public bpm!: number;

    @Column({ type: 'double' })
    public energy!: number;

    @Column({ type: 'double' })
    public durationSec!: number;

    @Column({ type: 'simple-json' })
    public beats!: number[];

    @Column({ type: 'simple-json' })
    public energyTimeline!: number[];

    @Column({ type: 'simple-json' })
    public drops!: number[];

    /** Soft-disable: track stays in the DB and the Library list (greyed out)
     *  but is excluded from `DjSetPlanner` and `compatibleAcross` so it never
     *  appears in mixes. User toggles via the per-row button in the Library /
     *  DJ-Set views. Default `false` for back-compat with rows analysed before
     *  this column landed. */
    @Column({ type: 'boolean', default: false })
    public disabled!: boolean;

}