import { Vts, type ExtractSchemaResultType } from 'vts';

/**
 * Active library source — `'local'` reads MP3s from `library.rootDir` (the existing
 * filesystem scan); `'jellyfin'` will fetch tracks from a configured Jellyfin server.
 * Defaults to `'local'`. The Jellyfin source ships in a follow-up iteration; this iter
 * only stores the setting and provides the connection-test endpoint.
 */
export const LibrarySourceSchema = Vts.or([
    Vts.equal('local' as const),
    Vts.equal('jellyfin' as const),
]);
export type LibrarySource = ExtractSchemaResultType<typeof LibrarySourceSchema>;

/**
 * Jellyfin connection details. `url` is the server's base URL (`http://host:port` or
 * `https://...`, no trailing slash required — the client normalises). `apiKey` is a
 * personal API key created via the Jellyfin admin UI. `userId` is the GUID of the
 * Jellyfin user whose library should be exposed (Jellyfin item-listing is per-user).
 *
 * All three fields are intentionally allowed to be empty strings — the Settings page
 * needs a way to render a fresh, unconfigured form. Backend treats `''` the same as
 * "not set" when running the connection probe.
 */
export const JellyfinSettingsSchema = Vts.object({
    url: Vts.string(),
    apiKey: Vts.string(),
    userId: Vts.string(),
});
export type JellyfinSettings = ExtractSchemaResultType<typeof JellyfinSettingsSchema>;

export const SettingsSchema = Vts.object({
    librarySource: LibrarySourceSchema,
    jellyfin: JellyfinSettingsSchema,
});
export type Settings = ExtractSchemaResultType<typeof SettingsSchema>;

/** POST `/api/v1/settings` body — same shape as the GET response. */
export const SettingsBodySchema = SettingsSchema;
export type SettingsBody = Settings;

/**
 * `POST /api/v1/settings/jellyfin/test` body. Lets the user probe an alternate set of
 * credentials without saving them — typical "Test Connection"-button flow. The shape
 * mirrors `JellyfinSettings`.
 */
export const JellyfinTestBodySchema = JellyfinSettingsSchema;
export type JellyfinTestBody = JellyfinSettings;

/**
 * Test-connection result. `ok` is the boolean verdict; `message` is a human-readable
 * explanation suitable for direct display ("Connected to Jellyfin 10.8.13 — user X",
 * "401 Unauthorized — check the API key", etc.). `serverName` / `serverVersion` are
 * filled when `ok: true` so the UI can show a confirmation badge.
 *
 * `resolvedUserId` / `resolvedUserName` are returned in two cases:
 *  - the user supplied a `userId` and the server confirmed it (echoed back),
 *  - the user left `userId` blank and the client auto-picked one from `/Users`.
 * The frontend uses these to populate the form so the discovered ID is saved.
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