import type { TransitionStyle } from '@headbangbear/schemas';

const STORAGE_KEY: string = 'hbb.transition-style.v1';
const DEFAULT_STYLE: TransitionStyle = 'drop-on-drop';
const VALID_STYLES: ReadonlySet<TransitionStyle> = new Set([
    'drop-on-drop',
    'tail-out',
    'early-cut',
    'bar-match'
]);

export type TransitionStyleListener = (style: TransitionStyle) => void;

/**
 * Singleton store for the user's preferred transition style. Persists to `localStorage`
 * so the choice survives page reloads — both the Library mix-plan and the DJ-Set page
 * read from here, and both stay in sync via `subscribe()`.
 */
export class TransitionStyleStore {

    private static instance: TransitionStyleStore | null = null;

    private current: TransitionStyle = DEFAULT_STYLE;

    private readonly listeners: Set<TransitionStyleListener> = new Set();

    private constructor() {
        this.current = TransitionStyleStore.load();
    }

    public static getInstance(): TransitionStyleStore {
        if (TransitionStyleStore.instance === null) {
            TransitionStyleStore.instance = new TransitionStyleStore();
        }
        return TransitionStyleStore.instance;
    }

    public get(): TransitionStyle {
        return this.current;
    }

    public set(style: TransitionStyle): void {
        if (this.current === style) {
            return;
        }
        this.current = style;
        try {
            localStorage.setItem(STORAGE_KEY, style);
        } catch {
            // localStorage unavailable (private mode, quota) — keep in-memory only.
        }
        for (const listener of this.listeners) {
            listener(style);
        }
    }

    public subscribe(listener: TransitionStyleListener): () => void {
        this.listeners.add(listener);
        return (): void => {
            this.listeners.delete(listener);
        };
    }

    private static load(): TransitionStyle {
        try {
            const raw: string | null = localStorage.getItem(STORAGE_KEY);
            if (raw !== null && VALID_STYLES.has(raw as TransitionStyle)) {
                return raw as TransitionStyle;
            }
        } catch {
            // ignored
        }
        return DEFAULT_STYLE;
    }

}