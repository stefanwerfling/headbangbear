import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * ID3 / source-supplied track metadata + cover-art presence. Same composite key
 * as {@link AnalyzedTrackEntity} so a 1:1 join keeps the analysis row and its
 * metadata row in lockstep, but the rows are separate so the metadata pass can
 * run independently of the audio analysis.
 *
 * String columns are nullable because not every track has a tag for every field
 * (especially for Jellyfin items where the API may not surface the year). They
 * use `null` rather than empty string so route responses can omit the field
 * cleanly via the `nullToUndefined` mapper in the library code.
 */
@Entity({ name: 'track_metadata' })
@Index(['providerId'])
export class TrackMetadataEntity {

    @PrimaryColumn({ type: 'varchar', length: 64 })
    public providerId!: string;

    @PrimaryColumn({ type: 'varchar', length: 512 })
    public sourceId!: string;

    @Column({ type: 'varchar', length: 256, nullable: true })
    public artist!: string | null;

    @Column({ type: 'varchar', length: 512, nullable: true })
    public title!: string | null;

    @Column({ type: 'varchar', length: 256, nullable: true })
    public album!: string | null;

    @Column({ type: 'int', nullable: true })
    public year!: number | null;

    @Column({ type: 'varchar', length: 64, nullable: true })
    public genre!: string | null;

    @Column({ type: 'boolean' })
    public hasCover!: boolean;

}