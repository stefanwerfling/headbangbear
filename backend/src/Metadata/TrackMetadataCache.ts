import { promises as fs } from 'node:fs';
import { type SchemaErrors } from 'vts';
import {
    METADATA_CACHE_VERSION,
    MetadataCacheFileSchema,
    type MetadataCacheEntry,
    type MetadataCacheFile,
} from './schemas.js';

/**
 * JSON-on-disk persistence layer for {@link MetadataCacheEntry}. Lives in a separate file
 * (`<library>/.metadata-cache.json`) from the audio-analysis cache so metadata changes
 * (re-tagging a file, replacing a cover) don't invalidate the slow-to-rebuild key/BPM data.
 *
 * Invalid or version-mismatched files are silently treated as empty — same forgiving
 * behaviour as `TrackLibrary`'s analysis cache, since this is a derived data store the
 * scan loop will re-populate.
 */
export class TrackMetadataCache {

    private readonly cachePath: string;

    public constructor(cachePath: string) {
        this.cachePath = cachePath;
    }

    public async loadEntries(): Promise<Map<string, MetadataCacheEntry>> {
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
        if (!MetadataCacheFileSchema.validate(parsed, errors)) {
            return new Map();
        }
        const validated: MetadataCacheFile = parsed;
        if (validated.version !== METADATA_CACHE_VERSION) {
            return new Map();
        }
        const map: Map<string, MetadataCacheEntry> = new Map();
        for (const entry of validated.entries) {
            map.set(entry.path, entry);
        }
        return map;
    }

    public async saveEntries(entries: readonly MetadataCacheEntry[]): Promise<void> {
        const data: MetadataCacheFile = {
            version: METADATA_CACHE_VERSION,
            entries: [...entries],
        };
        await fs.writeFile(this.cachePath, JSON.stringify(data, null, 2), 'utf8');
    }

}