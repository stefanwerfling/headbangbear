import { Vts } from 'vts';

export const HOTCUE_SLOT_COUNT: number = 8;

const STORAGE_KEY: string = 'hbb.hotcues.v1';

const SchemaCueSlot = Vts.or([Vts.number(), Vts.null()]);
const SchemaPersistedHotCues = Vts.object2(Vts.string(), Vts.array(SchemaCueSlot));

/**
 * Persistent per-track hot-cue store. 8 slots per track, indexed by absolute path; values are
 * either positions in seconds or `null` for empty. Backed by `localStorage` (key
 * `hbb.hotcues.v1`) so cues survive browser refresh.
 *
 *   - `get(path)` always returns a length-8 array (filling undefined entries with `null`).
 *   - `set(path, slot, sec)` persists immediately; `null` clears the slot.
 *   - `clear(path)` removes all 8 entries for a track.
 *   - `onChange(path, fn)` lets a deck listen for cue changes (currently unused — the deck
 *     re-reads when it sets a cue locally).
 */
export class HotCueStore {

    private static instance: HotCueStore | null = null;

    public static getInstance(): HotCueStore {
        if (HotCueStore.instance === null) {
            HotCueStore.instance = new HotCueStore();
            HotCueStore.instance.loadFromStorage();
        }
        return HotCueStore.instance;
    }

    private cues: Record<string, (number | null)[]> = {};

    public get(trackPath: string): readonly (number | null)[] {
        const stored: (number | null)[] | undefined = this.cues[trackPath];
        if (stored === undefined) {
            return new Array<number | null>(HOTCUE_SLOT_COUNT).fill(null);
        }
        // Guard against shorter persisted arrays (older payloads).
        if (stored.length < HOTCUE_SLOT_COUNT) {
            const padded: (number | null)[] = stored.slice();
            while (padded.length < HOTCUE_SLOT_COUNT) {
                padded.push(null);
            }
            return padded;
        }
        return stored;
    }

    public set(trackPath: string, slot: number, sec: number | null): void {
        if (slot < 0 || slot >= HOTCUE_SLOT_COUNT) {
            return;
        }
        const existing: (number | null)[] | undefined = this.cues[trackPath];
        const next: (number | null)[] = existing !== undefined
            ? existing.slice()
            : new Array<number | null>(HOTCUE_SLOT_COUNT).fill(null);
        while (next.length < HOTCUE_SLOT_COUNT) {
            next.push(null);
        }
        next[slot] = sec;
        const allEmpty: boolean = next.every((v: number | null): boolean => v === null);
        if (allEmpty) {
            delete this.cues[trackPath];
        } else {
            this.cues[trackPath] = next;
        }
        this.saveToStorage();
    }

    public clear(trackPath: string): void {
        if (this.cues[trackPath] === undefined) {
            return;
        }
        delete this.cues[trackPath];
        this.saveToStorage();
    }

    private loadFromStorage(): void {
        if (typeof window === 'undefined' || window.localStorage === undefined) {
            return;
        }
        const raw: string | null = window.localStorage.getItem(STORAGE_KEY);
        if (raw === null) {
            return;
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch {
            return;
        }
        if (!SchemaPersistedHotCues.validate(parsed, [])) {
            window.localStorage.removeItem(STORAGE_KEY);
            return;
        }
        // After validation `parsed` is a Record<string, (number | null)[]>.
        const out: Record<string, (number | null)[]> = {};
        for (const [path, slots] of Object.entries(parsed as Record<string, unknown>)) {
            if (Array.isArray(slots)) {
                out[path] = slots as (number | null)[];
            }
        }
        this.cues = out;
    }

    private saveToStorage(): void {
        if (typeof window === 'undefined' || window.localStorage === undefined) {
            return;
        }
        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.cues));
        } catch {
            // Quota exceeded — drop silently; in-memory copy stays correct.
        }
    }

}