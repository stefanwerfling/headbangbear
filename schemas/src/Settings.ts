import { Vts, type ExtractSchemaResultType } from 'vts';

/**
 * Provider kind — the storage backend implementation that supplies tracks.
 *  - `'local'` — directory of MP3s on disk; `rootDir` is the folder root.
 *  - `'jellyfin'` — remote Jellyfin server; tracks are item-UUIDs, audio is proxied.
 *
 * Future kinds (Subsonic, Spotify-export, etc.) plug in here.
 */
export const LibraryProviderKindSchema = Vts.or([
    Vts.equal('local' as const),
    Vts.equal('jellyfin' as const),
]);
export type LibraryProviderKind = ExtractSchemaResultType<typeof LibraryProviderKindSchema>;

/** Fixed discriminator on the `Provider` union — currently every provider is a
 *  library. Held as a separate field (rather than baked into the union) so future
 *  provider classes (e.g. metadata fingerprinters) can sit alongside without
 *  forking the whole config schema. */
export const ProviderTypeSchema = Vts.equal('library' as const);
export type ProviderType = ExtractSchemaResultType<typeof ProviderTypeSchema>;

/**
 * Local-folder library provider. `id` is user-chosen (must be unique within the
 * settings file) and is what's persisted on every analysis row in the DB; rename
 * = recreate (cache loss). `rootDir` is the absolute on-disk path to scan.
 */
export const LocalLibraryProviderSchema = Vts.object({
    id: Vts.string(),
    type: ProviderTypeSchema,
    kind: Vts.equal('local' as const),
    rootDir: Vts.string(),
});
export type LocalLibraryProvider = ExtractSchemaResultType<typeof LocalLibraryProviderSchema>;

/**
 * Jellyfin library provider — same `url` / `apiKey` / `userId` as before, plus
 * the shared `id` / `type` / `kind` discriminators. Empty strings for unbound
 * values are allowed so a fresh provider card can be rendered before save.
 */
export const JellyfinLibraryProviderSchema = Vts.object({
    id: Vts.string(),
    type: ProviderTypeSchema,
    kind: Vts.equal('jellyfin' as const),
    url: Vts.string(),
    apiKey: Vts.string(),
    userId: Vts.string(),
    /** Optional list of substrings — Jellyfin items whose `artist`, `title`,
     *  `album`, or `genre` contains any of these (case-insensitive) are dropped
     *  before the scanner ever sees them. Common use: filter audiobook entries
     *  that ended up in a Music library by mistake (e.g. `["Hörbuch", "Holly Black"]`). */
    excludePatterns: Vts.optional(Vts.array(Vts.string())),
});
export type JellyfinLibraryProvider = ExtractSchemaResultType<typeof JellyfinLibraryProviderSchema>;

export const LibraryProviderSchema = Vts.or([
    LocalLibraryProviderSchema,
    JellyfinLibraryProviderSchema,
]);
export type LibraryProvider = ExtractSchemaResultType<typeof LibraryProviderSchema>;

/**
 * Top-level user-editable settings. `providers` is the full list of configured
 * library providers — every track in the API is namespaced by the `id` of one of
 * these. An empty list is valid (degenerate "no library" state — UI just shows
 * an empty Library page).
 */
export const SettingsSchema = Vts.object({
    providers: Vts.array(LibraryProviderSchema),
});
export type Settings = ExtractSchemaResultType<typeof SettingsSchema>;

/** POST `/api/v1/settings/state` body — same shape as the GET response. */
export const SettingsBodySchema = SettingsSchema;
export type SettingsBody = Settings;

/**
 * Bare-minimum credentials needed to talk to a Jellyfin server. Used both as the
 * `POST /api/v1/settings/jellyfin-test` body (probe credentials before save) and as
 * the constructor argument for the backend `JellyfinClient`. It's the
 * Jellyfin-credential subset of {@link JellyfinLibraryProvider} — `id` / `type` /
 * `kind` aren't relevant to the connection itself.
 */
export const JellyfinConnectionSchema = Vts.object({
    url: Vts.string(),
    apiKey: Vts.string(),
    userId: Vts.string(),
});
export type JellyfinConnection = ExtractSchemaResultType<typeof JellyfinConnectionSchema>;

/** Alias kept for the test-route body so existing callers don't have to rename — the
 *  shape is identical to {@link JellyfinConnection}. */
export const JellyfinTestBodySchema = JellyfinConnectionSchema;
export type JellyfinTestBody = JellyfinConnection;

/**
 * Test-connection result. Shape unchanged from the pre-multi-provider revision —
 * `ok` is the verdict, `message` is human-readable, `serverName` / `serverVersion`
 * are filled when `ok: true`. `resolvedUserId` / `resolvedUserName` are returned
 * when the user supplied (or omitted) `userId` and the server confirmed / picked.
 */
export const JellyfinTestResultSchema = Vts.object({
    ok: Vts.boolean(),
    message: Vts.string(),
    serverName: Vts.optional(Vts.string()),
    serverVersion: Vts.optional(Vts.string()),
    resolvedUserId: Vts.optional(Vts.string()),
    resolvedUserName: Vts.optional(Vts.string()),
});
export type JellyfinTestResult = ExtractSchemaResultType<typeof JellyfinTestResultSchema>;

/**
 * Reference to a single track across the API. Every endpoint that previously
 * took a bare `path` string now takes both `providerId` (which provider the
 * track lives in) and `path` (the per-provider source-id — relative path for
 * `local`, item-UUID for `jellyfin`).
 */
export const TrackRefSchema = Vts.object({
    providerId: Vts.string(),
    path: Vts.string(),
});
export type TrackRef = ExtractSchemaResultType<typeof TrackRefSchema>;