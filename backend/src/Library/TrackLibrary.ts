import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { TrackMetadata } from '@headbangbear/schemas';
import { Vts, type ExtractSchemaResultType, type SchemaErrors } from 'vts';
import { AudioAnalyzer } from '../Analysis/AudioAnalyzer.js';
import { Camelot } from '../Analysis/Camelot.js';
import { OpenKey } from '../Analysis/OpenKey.js';
import {
    SerializedAnalysisResultSchema,
    type AnalysisResult,
    type SerializedAnalysisResult,
} from '../Analysis/schemas.js';

const CACHE_VERSION: number = 3;
const AUDIO_PATTERN: RegExp = /\.mp3$/i;

const CachedTrackSchema = Vts.object({
    path: Vts.string(),
    mtime: Vts.number(),
    size: Vts.number(),
    result: SerializedAnalysisResultSchema,
});
type CachedTrack = ExtractSchemaResultType<typeof CachedTrackSchema>;

const CacheFileSchema = Vts.object({
    version: Vts.number(),
    entries: Vts.array(CachedTrackSchema),
});
type CacheFile = ExtractSchemaResultType<typeof CacheFileSchema>;

export interface AnalyzedTrack {
    readonly path: string;
    readonly result: AnalysisResult;
    /** Embedded-tag metadata. Filled in by the metadata-enrichment pass after `scan()`. */
    metadata?: TrackMetadata;
    /** True iff a cover image was extracted (and persisted by `CoverArtCache`) for this track. */
    hasCover: boolean;
}

export type ProgressFn = (filePath: string) => void;

export class TrackLibrary {
    private readonly analyzer: AudioAnalyzer;

    private readonly cachePath: string;

    private readonly onProgress: ProgressFn | undefined;

    private readonly tracksByPath: Map<string, AnalyzedTrack> = new Map();

    public constructor(analyzer: AudioAnalyzer, cachePath: string, onProgress?: ProgressFn) {
        this.analyzer = analyzer;
        this.cachePath = cachePath;
        this.onProgress = onProgress;
    }

    public async scan(dir: string): Promise<AnalyzedTrack[]> {
        const cachedByPath: Map<string, CachedTrack> = await this.loadCache();
        const files: string[] = await TrackLibrary.findAudioFiles(dir);
        const fresh: CachedTrack[] = [];
        const tracks: AnalyzedTrack[] = [];

        for (const file of files) {
            const stat = await fs.stat(file);
            const mtime: number = stat.mtimeMs;
            const size: number = stat.size;
            const cached: CachedTrack | undefined = cachedByPath.get(file);

            let cacheEntry: CachedTrack;
            let result: AnalysisResult;
            if (cached !== undefined && cached.mtime === mtime && cached.size === size) {
                cacheEntry = cached;
                result = TrackLibrary.deserialize(cached.result);
            } else {
                if (this.onProgress !== undefined) {
                    this.onProgress(file);
                }
                result = await this.analyzer.analyze(file);
                cacheEntry = {
                    path: file,
                    mtime: mtime,
                    size: size,
                    result: TrackLibrary.serialize(result),
                };
            }
            fresh.push(cacheEntry);
            tracks.push({ path: file, result: result, hasCover: false });
        }

        await this.saveCache(fresh);
        this.tracksByPath.clear();
        for (const t of tracks) {
            this.tracksByPath.set(t.path, t);
        }
        return tracks;
    }

    public tracks(): AnalyzedTrack[] {
        return Array.from(this.tracksByPath.values());
    }

    public findByPath(path: string): AnalyzedTrack | null {
        return this.tracksByPath.get(path) ?? null;
    }

    /**
     * Camelot-compatible tracks for a given entry, sorted by BPM proximity to the input.
     * Excludes the input track itself.
     */
    public compatible(track: AnalyzedTrack): AnalyzedTrack[] {
        const targetCodes: Set<string> = new Set(
            track.result.camelot.compatibleKeys().map((c: Camelot): string => c.toString()),
        );
        const targetBpm: number = track.result.bpm;
        return this.tracks()
            .filter(
                (t: AnalyzedTrack): boolean =>
                    t.path !== track.path && targetCodes.has(t.result.camelot.toString()),
            )
            .sort(
                (a: AnalyzedTrack, b: AnalyzedTrack): number =>
                    Math.abs(a.result.bpm - targetBpm) - Math.abs(b.result.bpm - targetBpm),
            );
    }

    private async loadCache(): Promise<Map<string, CachedTrack>> {
        let raw: string;
        try {
            raw = await fs.readFile(this.cachePath, 'utf8');
        } catch {
            return new Map();
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch {
            return new Map();
        }
        const errors: SchemaErrors = [];
        if (!CacheFileSchema.validate(parsed, errors)) {
            return new Map();
        }
        const validated: CacheFile = parsed;
        if (validated.version !== CACHE_VERSION) {
            return new Map();
        }
        const map: Map<string, CachedTrack> = new Map();
        for (const entry of validated.entries) {
            map.set(entry.path, entry);
        }
        return map;
    }

    private async saveCache(entries: CachedTrack[]): Promise<void> {
        const data: CacheFile = { version: CACHE_VERSION, entries: entries };
        await fs.writeFile(this.cachePath, JSON.stringify(data, null, 2), 'utf8');
    }

    private static serialize(r: AnalysisResult): SerializedAnalysisResult {
        return {
            key: r.key,
            camelot: r.camelot.toString(),
            openKey: r.openKey.toString(),
            bpm: r.bpm,
            energy: r.energy,
            durationSec: r.durationSec,
            beats: r.beats,
            energyTimeline: r.energyTimeline,
            drops: r.drops,
        };
    }

    private static deserialize(s: SerializedAnalysisResult): AnalysisResult {
        const camelot: Camelot | null = Camelot.fromString(s.camelot);
        const openKey: OpenKey | null = OpenKey.fromString(s.openKey);
        if (camelot === null || openKey === null) {
            throw new Error(`Corrupt cache entry: camelot="${s.camelot}" openKey="${s.openKey}"`);
        }
        return {
            key: s.key,
            camelot: camelot,
            openKey: openKey,
            bpm: s.bpm,
            energy: s.energy,
            durationSec: s.durationSec,
            beats: s.beats,
            energyTimeline: s.energyTimeline,
            drops: s.drops,
        };
    }

    private static async findAudioFiles(dir: string): Promise<string[]> {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        const files: string[] = [];
        for (const entry of entries) {
            if (entry.isFile() && AUDIO_PATTERN.test(entry.name)) {
                files.push(join(dir, entry.name));
            }
        }
        return files.sort();
    }
}
