import {
    RouteTrackSchema,
    TransitionPlanSchema,
    type DjSet,
    type DjSetTrack,
    type RouteTrack,
    type TransitionPlan,
} from '@headbangbear/schemas';
import { Vts } from 'vts';

export interface SetlistEntry {
    readonly from: RouteTrack;
    readonly to: RouteTrack;
    readonly transition: TransitionPlan;
}

export type SetlistChangeFn = () => void;

const STORAGE_KEY: string = 'hbb.setlist.v1';

const PersistedEntrySchema = Vts.object({
    from: RouteTrackSchema,
    to: RouteTrackSchema,
    transition: TransitionPlanSchema
});
const PersistedSetlistSchema = Vts.array(PersistedEntrySchema);

/**
 * Singleton frontend store for the user's manually-built DJ setlist. Each entry is one
 * planned A→B transition; the chain is `entries[0].from → entries[0].to == entries[1].from
 * → entries[1].to → …`. The store survives navigation between pages because the `Library`
 * page builds the setlist and the `DjSet` page consumes it. Entries are also persisted to
 * `localStorage` under the `hbb.setlist.v1` key so they survive browser refresh.
 */
export class SetlistStore {

    private static instance: SetlistStore | null = null;

    public static getInstance(): SetlistStore {
        if (SetlistStore.instance === null) {
            SetlistStore.instance = new SetlistStore();
            SetlistStore.instance.loadFromStorage();
        }
        return SetlistStore.instance;
    }

    private entries: SetlistEntry[] = [];

    private listeners: Set<SetlistChangeFn> = new Set();

    public getEntries(): readonly SetlistEntry[] {
        return this.entries;
    }

    public size(): number {
        return this.entries.length;
    }

    public add(entry: SetlistEntry): void {
        this.entries.push(entry);
        this.notify();
    }

    public removeAt(index: number): void {
        if (index < 0 || index >= this.entries.length) {
            return;
        }
        this.entries.splice(index, 1);
        this.notify();
    }

    public clear(): void {
        this.entries = [];
        this.notify();
    }

    public onChange(fn: SetlistChangeFn): () => void {
        this.listeners.add(fn);
        return (): void => {
            this.listeners.delete(fn);
        };
    }

    /**
     * Returns true when each entry's `to` matches the next entry's `from` (i.e. the chain
     * plays as one continuous track sequence). Setlists with discontinuities still play —
     * they just have hard cuts between non-adjacent pairs.
     */
    public isContinuous(): boolean {
        for (let i = 0; i < this.entries.length - 1; i++) {
            const cur = this.entries[i];
            const next = this.entries[i + 1];
            if (cur === undefined || next === undefined) {
                return false;
            }
            if (cur.to.providerId !== next.from.providerId || cur.to.path !== next.from.path) {
                return false;
            }
        }
        return true;
    }

    /**
     * Builds a `DjSet` so the setlist can be played by `AutoPlayer.play()`. Returns null
     * when the setlist is empty or its chain is discontinuous.
     */
    public toDjSet(): DjSet | null {
        if (this.entries.length === 0 || !this.isContinuous()) {
            return null;
        }
        const first: SetlistEntry = this.entries[0] as SetlistEntry;
        const tracks: DjSetTrack[] = [
            SetlistStore.toDjSetTrack(first.from),
            ...this.entries.map((e: SetlistEntry): DjSetTrack => SetlistStore.toDjSetTrack(e.to))
        ];
        return {
            tracks: tracks,
            transitions: this.entries.map((e: SetlistEntry): TransitionPlan => e.transition),
            skipped: [],
            energyDirection: 'either'
        };
    }

    private static toDjSetTrack(t: RouteTrack): DjSetTrack {
        return {
            providerId: t.providerId,
            path: t.path,
            camelot: t.camelot,
            bpm: t.bpm,
            energy: t.energy,
            durationSec: t.durationSec
        };
    }

    private notify(): void {
        this.saveToStorage();
        for (const fn of this.listeners) {
            fn();
        }
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
        // Per-entry migration + filter. `hasCover` is backfillable (false is a safe default —
        // Iter 38 added it). `providerId` is NOT backfillable — there's no sane default in a
        // multi-provider world, so any pre-Iter-52 entry without it is dropped. Filtering
        // per-entry rather than wholesale lets a partly-valid list survive the upgrade.
        const survivors: unknown[] = SetlistStore.migrateLegacyPayload(parsed);
        if (!PersistedSetlistSchema.validate(survivors, [])) {
            window.localStorage.removeItem(STORAGE_KEY);
            return;
        }
        this.entries = survivors.map((e): SetlistEntry => ({
            from: e.from,
            to: e.to,
            transition: e.transition
        }));
    }

    private static migrateLegacyPayload(parsed: unknown): unknown[] {
        if (!Array.isArray(parsed)) {
            return [];
        }
        const out: unknown[] = [];
        for (const entry of parsed) {
            if (entry === null || typeof entry !== 'object') {
                continue;
            }
            const e = entry as Record<string, unknown>;
            SetlistStore.backfillRouteTrackFields(e.from);
            SetlistStore.backfillRouteTrackFields(e.to);
            if (!SetlistStore.hasProviderId(e.from) || !SetlistStore.hasProviderId(e.to)) {
                continue;
            }
            out.push(entry);
        }
        return out;
    }

    private static backfillRouteTrackFields(track: unknown): void {
        if (track === null || typeof track !== 'object') {
            return;
        }
        const t = track as Record<string, unknown>;
        if (typeof t.hasCover !== 'boolean') {
            t.hasCover = false;
        }
    }

    private static hasProviderId(track: unknown): boolean {
        if (track === null || typeof track !== 'object') {
            return false;
        }
        const t = track as Record<string, unknown>;
        return typeof t.providerId === 'string' && t.providerId !== '';
    }

    private saveToStorage(): void {
        if (typeof window === 'undefined' || window.localStorage === undefined) {
            return;
        }
        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.entries));
        } catch {
            // Quota exceeded or storage disabled — drop silently; the in-memory copy is
            // still correct.
        }
    }

}