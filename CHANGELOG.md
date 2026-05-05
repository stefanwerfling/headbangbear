# Changelog

All notable changes to Headbangbear are documented in this file.

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Until the first tagged release the project tracks an `Unreleased` section only.

---

## [Unreleased]

### Added — Background scan + live browser progress (Iteration 50)

- **Non-blocking startup.** `LibraryService.start()` builds the active library + caches synchronously, marks itself ready, and kicks the scan into a fire-and-forget promise. `HttpService` (which depends on `LibraryService.NAME`) starts as soon as `start()` resolves, so the figtree-managed boot is no longer gated on minutes-long first scans.
- **Live in-memory updates.** `TrackLibrary.scan()` and `JellyfinLibrary.scan()` now populate `tracksByPath` *per iteration* (clear at the top, set per loop body) instead of writing the whole map at the end. `tracks()` is therefore a live view of the in-progress scan — anything the routes return reflects what's been analysed so far.
- **`TrackLibrary.ProgressFn`** widened to the same `ScanProgress` shape `JellyfinLibrary` already used (`{current, total, name, phase, detail?}`). Phases: `analyse` (slow essentia run), `cache` (cache-hit fast path), `error` (one bad track; the scan keeps going). CLI callers (`Compatible`, `DjSet`, `MixPlan`) updated to consume the new shape.
- **`LibraryService` scan state**: `scanState / current / total / currentName / currentPhase / error / startedAtMs / finishedAtMs`. Updated on every progress event from the active library; surfaced via `getScanStatus()` and the new endpoint. Errors in the background scan are caught (no unhandled rejection) and turned into `state: 'error'` with the message in `error`.
- **Schema**: `ScanStatusSchema` (+ `ScanStateSchema`) in `@headbangbear/schemas/Library.ts`. Wire shape mirrors the service state exactly.
- **Route**: `GET /api/v1/library/scan-status` — added to `LibraryRoute`. Cheap; meant for polling.
- **Frontend** (`Pages/Library.ts`): `$scanBanner` Bootstrap-alert above the tracks card, hidden by default. After the initial library list render, the page calls `LibraryApi.scanStatus()`; if `state === 'scanning'`, it polls every 2 s. On each poll the banner detail line updates (`Progress: 5/120 (jellyfin) — Track Name [analyse]`) and the progress bar fills proportionally. When `current` advances past `lastRenderedCount`, the page refetches `LibraryApi.list()` and re-renders the table — newly analysed tracks appear without a manual refresh. On `done` the banner turns green and fades out after 4 s; on `error` it turns red and shows the error message.
- **Lang strings** DE + EN: `library_scan_banner_title / _progress / _done / _failed`.
- **Pagination + cheaper Jellyfin listing**: a 504 from the Jellyfin reverse proxy (Jellyfin took longer than the proxy idle timeout to assemble the response) revealed two issues with the v1 single-shot listing — `Limit=10000` was too greedy and `Fields=...,MediaSources` forced Jellyfin to enumerate every item's underlying files. Fixed by paginating in `Limit=500`/`StartIndex` batches and dropping `MediaSources` (`DateModified` alone is enough for cache invalidation; if a file is replaced the timestamp moves). Plus a 60-second `AbortSignal.timeout()` per page so a hanging Jellyfin produces a clean `error` state instead of an infinite "scanning…".

### Added — Jellyfin as library source (Iteration 49)

- **Audio bytes never permanently mirrored locally.** Analysis streams `Jellyfin GET /Items/{id}/Download` → `fetch.body` → Node `Readable` (`Readable.fromWeb`) → ffmpeg stdin (`-i pipe:0`) → essentia. Playback proxies live with the browser's `Range` header forwarded so seeking works through the proxy. Only the analysis result (key/BPM/energy/drops) is persisted, in `<rootDir>/.jellyfin-data/.analysis-cache.json`. No on-disk audio cache, no on-disk cover cache (covers are proxied straight through too).
- **`AudioAnalyzer.analyze`** signature widened from `(filePath: string)` to `(input: AnalyzerInput)` where `AnalyzerInput = string | Readable`. `FfmpegDecoder.decode` dispatches on the type — when it's a stream, ffmpeg gets `-i pipe:0` and the stream is piped into stdin. EPIPE on stdin is swallowed (ffmpeg may close stdin before the upload finishes when it has enough audio to decide). `EssentiaAudioAnalyzer`, `StubAudioAnalyzer`, `LazyEssentiaAnalyzer` all adopted.
- **`JellyfinClient` extensions**: a backend-internal `JellyfinAudioItem` shape (id/name/artist/album/year/genre/durationSec/sizeBytes/dateModifiedMs/hasCover); `listAudioItems()` (paginated, see Iter 50); `openAudioStream(itemId, range?)` for both the analysis pipeline and the playback proxy; `openCoverStream(itemId)` for the cover proxy. All return the raw web `Response` so the caller picks how to consume the body.
- **`backend/src/Library/JellyfinLibrary.ts`** (~330 LOC) — parallel class to `TrackLibrary`. `scan()` lists items, joins against `<rootDir>/.jellyfin-data/.analysis-cache.json` (cache-keyed by `(itemId, dateModifiedMs)`), runs the streaming analysis pipeline for misses, populates the in-memory map per iteration. `serveAudio(itemId, req, res)` and `serveCover(itemId, res)` mirror status + Content-Type / Content-Length / Content-Range / Accept-Ranges from upstream and pipe the body through. `findByPath / compatible / tracks` have the same signatures as `TrackLibrary`.
- **`LibraryService` refactor**: introduces `LibraryFacade` (interface with `tracks / findByPath / compatible`). On `start()`, reads `SettingsStore.getInstance().load()` and instantiates either `TrackLibrary` + `LibraryMetadataEnricher` (local) or `JellyfinLibrary` (remote). New `serveAudio(path, req, res)` / `serveCover(path, res)` dispatch to the active library. `getLibrary()` returns the facade.
- **Routes**: `AudioRoute` and `LibraryCoverRoute` rewritten to take `LibraryService` and delegate via `service.serveAudio` / `service.serveCover` — single source of truth for path validation + dispatch. `LibraryRoute / TracksCompatibleRoute / MixPlanRoute / DjSetRoute` retyped to `LibraryFacade` so they work against either source.

### Added — Settings page + Jellyfin connection test (Iteration 48)

- **Schemas**: `Settings.ts` in `@headbangbear/schemas` — `LibrarySource` (`'local' | 'jellyfin'`), `JellyfinSettings`, `Settings`, `SettingsBody`, `JellyfinTestBody`, `JellyfinTestResult` (carries `resolvedUserId / resolvedUserName` for the auto-discovery flow).
- **Backend `SettingsStore`** — JSON persistence at `<cwd>/.hbb-settings.json` (gitignored). Singleton via `install()` / `getInstance()` so routes can read it without threading the path through the route loader. Forgiving load: missing file / bad JSON / schema mismatch all return defaults so the Settings page boots cleanly on a fresh install.
- **`backend/src/Provider/JellyfinClient.ts`** — REST wrapper. `testConnection()` two-stage probe: `GET /System/Info` (verifies URL + API key) then resolves the user via `/Users/{id}` (when `userId` is supplied) or auto-discovers via `/Users` → `/Users/Public` (when blank). Result includes `resolvedUserId / resolvedUserName` so the frontend can populate the form. All requests go through the `X-Emby-Token` header.
- **Route**: `SettingsRoute` — `GET / POST /api/v1/settings/state` and `POST /api/v1/settings/jellyfin-test`. Wired in `HbbRouteLoader`. `HeadbangbearApp` constructor calls `SettingsStore.install()` so the singleton is available before routes are instantiated.
- **Frontend** `Pages/Settings.ts` (sidemenu entry "Settings" / "Einstellungen", `fa-cog`): library-source radio (Local / Jellyfin), Jellyfin form (URL / API key / User ID — the latter labelled `optional` with auto-discover hint), Test-Connection + Save buttons with live spinners + colour-coded alerts. On a successful test that resolved the user ID, the form is populated so the next Save persists exactly what was tested.
- **Lang** DE / EN.

### Added — Welcome-page audio intro + comprehensive guide (Iteration 47)

- **Audio intro** on the Home page. New gulp `copy-audio` task copies `doc/audio/logo.mp3` into `assets/audio/`. The Home card renders an `<audio controls>` element next to the logo and tries `audio.play()` on first load. Modern browsers block unmuted autoplay without a prior user gesture; on rejection a one-shot global `pointerdown` / `keydown` listener is installed so the very next interaction triggers playback.
- **Per-tab + per-visit gating**: `sessionStorage('hbb.intro-played.v1')` prevents a second autoplay attempt when the user navigates back to Home in the same tab. **Disable on next visit** checkbox writes `localStorage('hbb.intro-disabled.v1')` and pauses immediately if the audio is currently playing.
- **Sidebar logo**: bambooo's v1 `SidebarLogo.setTitle()` re-renders both image + title from internal fields, so the prepended `<img>` was wiped on every render. Switched to `setImage('assets/img/logo.png')` in `BasePage` — the proper API.
- **Welcome-page logo** doubled in size (120 px → 240 px).
- **Guide tab** completely overhauled. New section-tree structure (`Home.GUIDE` constant) with two render styles — workflow (numbered badges) for the quickstart, glossary (info-icon) for everything else. Six sections covering:
    - **Quickstart** — config.json, run backend + frontend, plan a mix, generate a set.
    - **Library page** — Decks A/B, Plan-Mix toolbar, track table, filters, sortable columns, hot cues, loop, EQ, tempo + pitch-lock, keyboard shortcuts, setlist (11 items).
    - **DJ Set page** — Auto/Manual source, strategy, direction, energy shape, transition style, target duration, avoid-same-artist, play + now-playing, master + per-side EQ, AutoPlayer pitch-lock, recording → MP3 (11 items).
    - **Key Labels page** — labelling, profile sweep, MIREX score reading (3 items).
    - **Glossary** — Camelot, BPM, energy, drops, energy shape, pitch shift, pitch lock, transition styles, beam search, MIREX, metadata + cover art (11 items).
    - **Tips** — search-haystack, persistence, recording, active deck, language switch (5 items).
- ~50 new lang strings DE + EN. Old `guide_workflow_*` keys removed (replaced by `guide_quickstart_*`).

### Added — Profile sweep in the browser (Iteration 46)

- **Wire schemas migrated** to `@headbangbear/schemas`: `KeyEvalCounts`, `KeyProfileSweepRow`, `KeyProfileSweepReport`, `KeyProfileSweepBody`. Backend's `Eval/schemas.ts` re-exports them so internal callers (CLI, evaluator) don't break. The `KeyEvalReport` shape with full `MusicalKey` entries stays backend-internal — it's only consumed by the CLI.
- **`POST /api/v1/library/profile-sweep`** — `KeyProfileSweepRoute` reads `<library>/truth.json`, resolves filenames to absolute paths (mirrors the CLI), invokes `KeyProfileSweep.run()` with an `EssentiaAudioAnalyzer` factory, returns the MIREX-ranked report. Returns 400 when truth is missing/empty/unmatched. **First call is slow** (~3 s × tracks × profiles); cached afterwards via `<library>/.keyeval-cache.<profile>.json`.
- **Frontend**: new `KeyProfileSweepApi` wrapper. The KeyLabels page gains a sweep card below the labels table — six profile checkboxes (`bgate / temperley / krumhansl / edmm / edma / shaath`, all selected by default), `Run sweep` button, status span ("Running… first run may take several minutes"), and a result table with profile / MIREX / matched / 5 category counts. Winning row is highlighted via Bootstrap's `table-success`. The status text echoes the best profile after completion.
- New lang strings DE + EN (`key_labels_sweep_*`, `key_labels_sweep_run`, etc.).

### Added — Beam-search artist-diversity penalty (Iteration 44)

- **`BeamSearchOptions.avoidSameArtist?: boolean`** — soft penalty against placing two tracks by the same artist back-to-back. `BeamState` gains an `artistRepeats` counter that increments in `extend()` when both consecutive tracks have a non-empty `metadata.artist` string and the strings match exactly. Untagged tracks never trigger the penalty — keeps the behaviour predictable on legacy libraries.
- **Lex comparator** gains an `(a.artistRepeats - b.artistRepeats)` term placed *between* the primary length / shape / target keys and the existing `sumPitchAbs` / `dropAligned` keys. So a longer / better-shaped chain still wins even with a same-artist pair; among equally-good chains, the diverse one wins.
- Plumbed through `DjSetPlannerOptions` (greedy ignores the flag deliberately — it has no scoring loop), `DjSetBodySchema.avoidSameArtist`, `DjSetRoute`, and a frontend checkbox `.hbb-avoid-same-artist` next to the existing planner controls. Lang strings `dj_set_avoid_same_artist` + `dj_set_avoid_same_artist_help` DE + EN.
- **Tests**: 2 new in `tests/DjSet/BeamSearchDjSetPlanner.test.ts` — a tiebreaker test (`start 8A X` + `altX 8B X` + `altY 9A Y`, with altX↔altY mutually incompatible so only 2-track chains exist; with `avoidSameArtist: true` the X→Y chain wins) and a "length still dominates" test (proves a 3-track same-artist chain still beats a 2-track diverse chain). **164/164 total.**

### Added — Frontend watch mode (Iteration 45)

- **`gulp watch-webpack`** — runs webpack incrementally with `mode: 'development'` (no minification, ~4× faster rebuilds than the production bundle). Returns a never-resolving promise so gulp keeps the task alive; `compiler.watch(callback)` logs `[HH:MM:SS] webpack rebuilt — refresh the browser` on every save and surfaces compile errors with a timestamp.
- **`gulp watch`** task = `series('copy-data', 'watch-webpack')` — copies static assets once, then keeps webpack watching. `npm run dev -w @headbangbear/frontend` now points at `gulp watch` instead of a one-off build. Production-build commands (`gulp default`, `npm run build`) are unchanged.
- Type-check stays in lockstep with each rebuild via `ForkTsCheckerWebpackPlugin` (already wired in `webpack.config.js`).
- **Trade-off**: no live-reload — browser refresh is still manual. Adding livereload would need a tiny WebSocket service in the backend; deferred until the manual refresh actually feels like friction.

### Added — KeyLabels page + setlist persistence resilience (Iterations 42–43)

- **Iteration 42** — Ground-truth labelling UI. New page `Pages/KeyLabels.ts` with sidemenu entry "Key Labels" / "Key-Labels", new API wrapper `KeyLabelsApi`. Backend route `KeyLabelsRoute` (`GET / POST /api/v1/library/key-labels`) reads/writes `<library>/truth.json` — the same flat `{"filename.mp3": "A minor"}` map the existing `KeyEval` CLI consumes. Schemas (`KeyLabelEntry`, `KeyLabelsBody`, `KeyLabelsResponse`) live in `@headbangbear/schemas`. UI renders a per-track row (cover thumb, track-cell, predicted Camelot + Open Key, 24-key dropdown), Save button, and a "labelled / total" counter. Persistence is full-replacement: POST body replaces the whole truth.json.
- **Iteration 43** — `SetlistStore.loadFromStorage()` is now resilient against legacy payloads. Before validation, `migrateLegacyPayload` walks each entry and `backfillRouteTrackFields` stuffs `hasCover: false` on any `from`/`to` track that's missing it (Iter 38 added it as a required field). Without this, every user with a saved setlist would lose it on the next launch.

### Added — Library page polish: sortable headers + year/genre filter (Iteration 41)

- **Sortable column headers** — Track / Camelot / BPM / Energy / Drops. Click cycles `none → asc → desc → none`. Numeric keys are compared numerically; strings via `localeCompare`. Sort reorders DOM rows in place (no re-render) and uses `data-original-index` attrs to restore the input order on the third click. Active sort key is indicated by a `fa-caret-up` / `fa-caret-down` glyph in the header.
- **Year-range filter** (min / max number inputs) added to the existing filter row. Tracks without a year stay visible while the filter is inactive — only excluded when min OR max is set, otherwise untagged tracks would silently disappear.
- **Genre dropdown** — auto-populated from `library.tracks` (alphabetised distinct genres), default option "any" / "beliebig".
- `applyTableFilters` extended with year + genre branches; `loadFilterPrefs` / `saveFilterPrefs` / Clear-Filters all updated to include the new fields. `library_genre_any` lang string DE + EN.
- **Sort state is intentionally not persisted** — would interact surprisingly with Clear Filters and rescan flows.

### Added — Cover art + artist/title across the UI (Iterations 38–40)

- **Iteration 38** — ID3 metadata + cover-art Phase 1.
    - **Schemas**: `TrackMetadataSchema` in `@headbangbear/schemas` (artist / title / album / year / genre, all optional). `RouteTrackSchema` extended with `metadata?` + `hasCover: boolean` (required).
    - **Backend `Metadata/`**: `TrackMetadataExtractor` (abstract), `Id3TagExtractor` (uses `music-metadata@^10.5.0`), `StubMetadataExtractor` (test seam), `CoverArtCache` (filesystem at `<library>/.covers/<sha1>.<ext>`, sha1 of the absolute track path), `TrackMetadataCache` (parallel JSON cache with its own version pin so it doesn't invalidate the slow audio-analysis cache), and `LibraryMetadataEnricher` (orchestrator that runs after `TrackLibrary.scan()` and mutates `AnalyzedTrack` instances in place with `metadata` + `hasCover`).
    - **`AnalyzedTrack`** interface gains `metadata?: TrackMetadata` + `hasCover: boolean`. All test fixtures updated.
    - **New route**: `LibraryCoverRoute` (`GET /api/v1/library/cover?path=…`, binary out via `res.sendFile`, mirrors `AudioRoute`'s path-validation pattern). One bug fix on the way: `res.sendFile` rejects paths under dotfile dirs by default (`dotfiles: 'ignore'`) and surfaces a synthetic 404-style error to the callback that we'd return as a generic 500. Fixed by passing `{ dotfiles: 'allow' }` — safe because the path is already validated against the loaded library.
    - **`LibraryService`** orchestrates `scan() → enrich()`, exposes `getCoverArtCache()` for the route wiring.
    - **Frontend**: Library table gets a Cover column (40 × 40 thumb, fa-music placeholder when `hasCover: false`) and a Track column showing artist / title with filename as fallback. Search-haystack expanded to include all metadata fields. Lang strings DE + EN: `cover`, `track`, `artist`, `album`, `year`, `genre`.
    - **Phase 2** (AcoustID / MusicBrainz fingerprinting) intentionally skipped — actual ID3 coverage on a yt-dlp-sourced library is high enough that the fallback path isn't worth the dependency yet.
    - **Tests**: 16 new — `Metadata/CoverArtCache.test.ts` (6), `Metadata/TrackMetadataCache.test.ts` (5), `Metadata/LibraryMetadataEnricher.test.ts` (5). **162/162 total.**
- **Iteration 39** — Now-Playing card + chain-table covers on DJ-Set page.
    - New `Util/TrackDisplayUtil` with statics `coverUrl`, `coverThumbHtml`, `trackCellHtml`, `buildSearchHaystack`, `escape`, `filenameOf` — single source of truth for cover/track-cell rendering used by both Library and DJ-Set pages.
    - DJ-Set: `$nowPlayingCard` above the `nowPlayingDeck` (80 × 80 cover, "Track N / M" index, Title h5, Artist line, Album line; resets to a placeholder on idle). Driven by `setNowPlaying(track, index?, total?, filename?)` on every `onTrackChange` / `onFinished` / `stop()`.
    - Chain table grows a Cover column before Track; Track column shows title / artist via a `libraryByPath.get(path)` lookup with a `routeTrackStub` fallback for edge cases.
    - Status text becomes "Now playing #N: Artist — Title" when metadata is present.
    - Lang strings `dj_set_now_playing_idle`, `dj_set_now_playing_index` DE + EN.
- **Iteration 40** — Cover + artist in the Deck card-header (Library page).
    - `Deck.ts` card-header restructured into a flex row with a 56 × 56 cover slot (img or fa-music placeholder via `renderCover()`), a Title (from `metadata.title`, falling back to filename), and an Artist subtitle.
    - New option `DeckOptions.hideCover` (default `false`). On the DJ-Set page the now-playing deck sets it `true` because the dedicated `nowPlayingCard` already shows the cover.
    - `Deck.setTrack()` now populates cover + title + artist via `TrackDisplayUtil`.

### Added — AutoPlayer pitch-lock / master-tempo (Iteration 37)

- **AutoPlayer migrated** from `AudioBufferSourceNode` to `MediaElementAudioSourceNode` wrapping `HTMLAudioElement`. Same Web Audio chain (gain → 3-band EQ per side → master EQ → destination), but the source is now a media element so we can flip `audio.preservesPitch` for browser-native time-stretch. Recording (MediaRecorder reading from `streamDest`) is unchanged.
- **`AutoPlayer.setPitchLocked(locked)`** + `isPitchLocked()` — toggles pitch preservation across all currently-scheduled tracks *and* future ones in this player. With pitch-lock on, BPM matching no longer re-pitches the keys — the natural DJ-mixing setting. Off = turntable mode (pitch + tempo coupled), unchanged behaviour.
- **Constructor** gains a fourth optional arg `initialPitchLocked: boolean = false` so the DJ-Set page can hand in the persisted preference at construction time.
- **DJ-Set page UI**: new `Pitch lock (key lock)` checkbox next to the recording toggle. State persisted to `localStorage` (`hbb.autoplayer-pitch-lock.v1`); flipping it during playback calls `player.setPitchLocked()` for live response. EN + DE labels (`dj_set_pitch_lock` / `dj_set_pitch_lock_help`).
- **Trade-off**: scheduling went from sample-accurate (`source.start(when, offset)`) to ms-accurate (`setTimeout` + `audio.play()` after pre-seeking via `audio.currentTime`). Imperceptible for second-long crossfades; if precise sub-frame alignment ever matters again, the alternative is a WASM time-stretch lib (SoundTouch / Rubber Band) but that's a much larger change.
- **Browser support**: standard `preservesPitch` works in Chrome/Firefox/Edge; older Safaris use `webkitPreservesPitch` — both are set side-by-side. Quality is good across the typical DJ pitch-shift range (±~10%).
- **Smoke test**: not yet exercised in the browser (user wants to test).

### Added — Library filters, deck keyboard shortcuts, deck pitch-lock (Iterations 34–36)

- **Iteration 34** — Library page gains BPM-range and Energy-range filters next to the existing search box and Camelot-compatible toggle. Each row carries `data-bpm` / `data-energy` attributes; `applyTableFilters()` runs all four filter types in one pass and shows a `<visible>/<total>` count when any filter is active. **Clear-filters** button + filter values persisted to `localStorage` (`hbb.library-filters.v1`).
- **Iteration 35** — Keyboard shortcuts on the Library page's two decks. *Active deck* is highlighted with a blue border (`.hbb-deck-active`) and starts as **A**; click any deck to make it active.
    - `1`–`8` — trigger hot cue 1–8 on the active deck (set if empty, jump if filled, like the existing button behaviour)
    - `Shift`+`1`–`8` — clear the hot cue on the active deck
    - `Q` — loop in, `W` — loop out, `E` — clear loop
    - `Space` — toggle play/pause on the active deck
    - `Tab` — cycle the active deck (A ↔ B)
    - Inputs/textareas/contenteditable are skipped so typing doesn't trigger shortcuts. The handler is installed on `loadContent()` and torn down in `unloadContent()`.
    - `Deck` exposes new public methods: `triggerHotCue(slot, shift)`, `triggerLoopIn/Out/Clear()`, `togglePlayPause()`, `setActive(active)`, `getCardElement()`. Programmatic calls reuse the existing per-button handlers, so behaviour matches click-paths exactly.
- **Iteration 36** — Per-deck **tempo slider** (`0.7×`–`1.3×`) and **Pitch-lock** checkbox in the Deck card. Maps directly to the wavesurfer media element's `playbackRate` + `preservesPitch` (browser-native time-stretch — Chrome/Firefox both support). **Scope**: deck preview only — the `AutoPlayer` (Web Audio `AudioBufferSourceNode`) still runs in turntable mode (pitch + tempo coupled) because real-time time-stretch needs a third-party WASM library. Per-deck preferences persisted to `localStorage` (`hbb.deck-pitch.A.v1` / `…B.v1`).
- New CSS lives inline in `frontend/index.html` (`<style>`); CSP `style-src 'self' 'unsafe-inline'` allows it.
- All 146 backend tests still green; lint 0 errors.

### Added — User-selectable transition styles (Iteration 33)

- **Four transition styles** in `MixTransition.plan({ style })`:
    - **`drop-on-drop`** *(default, current behaviour)* — A's last drop and B's first drop coincide in wall time. Both drops hit together as the climax of the crossfade.
    - **`tail-out`** *(new)* — A's drop plays out fully (`TAIL_OUT_POST_DROP_BARS = 4` bars after the drop), then the crossfade begins. B fades in from its first beat. Climax sits on A's drop alone.
    - **`early-cut`** *(new)* — A is cut `EARLY_CUT_PRE_DROP_BARS = 2` bars *before* its drop, so A's drop never plays. The crossfade ends at B's first drop in wall time. B's drop is the sole climax — useful when A's drop would compete.
    - **`bar-match`** *(new)* — deliberately ignores drops, uses the existing energy-aligned strategy. For tracks with noisy drop detection (classical, ambient).
- **`alignment` field** in `TransitionPlan` extended to `'drop' | 'energy' | 'tail-out' | 'early-cut'`. New `style` field on every plan echoes back what was *requested* — the difference vs `alignment` reveals when a style fell back (e.g. requested `tail-out`, but A's drop too close to its end → `alignment: 'energy'` with a fallback note).
- **Schema/route plumbing**: `TransitionStyleSchema` in `@headbangbear/schemas`; `MixPlanBodySchema.style` and `DjSetBodySchema.style` accept the new field. `DjSetPlanner` and `BeamSearchDjSetPlanner` thread `style` through to every `MixTransition.plan()`. Beam-search transition cache key now includes the style so different styles don't collide on the same `(from, to)` pair.
- **CLI**: `npm run mix-plan -- ... --style=drop-on-drop|tail-out|early-cut|bar-match`, same flag on `npm run dj-set`. Uses `TransitionStyleSchema.validate()` for input checking — illegal values get a usable error message.
- **Frontend**: new `TransitionStyleStore` singleton (`frontend/src/inc/Widget/`), persists the user's choice to `localStorage` (`hbb.transition-style.v1`). Style selectors added to both the Library mix-plan toolbar and the DJ-Set generate panel; both stay in sync via the store. Selected style is forwarded to the backend on every plan request. Plan-summary badges now show `style: …` and `aligned: …` separately so a fall-back is visible at a glance. EN + DE labels.
- **Tests**: 6 new in `tests/Mix/MixTransition.test.ts` (default style, tail-out cue placement, early-cut cue placement, bar-match ignores drops, drop-on-drop falls back when one track has no drop, tail-out falls back when A's drop is too close to its end). **146/146 total**.

### Added — KeyExtractor profile sweep (Iteration 32)

- **`EssentiaAudioAnalyzer`** now accepts a `profileType` constructor arg (default `'bgate'`) — passed as the 10th positional arg to essentia's `KeyExtractor`. New helper `analyzeKeyOnly(filePath): Promise<MusicalKey>` skips the rhythm/RMS/drop pipeline; the sweep needs many fast key predictions per track.
- **`KeyProfileSweep`** (`backend/src/Eval/KeyProfileSweep.ts`) — runs every requested profile against the truth-listed tracks, scores each profile via `KeyEvaluator.evaluate`, and ranks by MIREX score. Per-profile predictions are cached at `<library-dir>/.keyeval-cache.<profile>.json` so subsequent sweeps are instant.
- **`npm run key-eval -- <library-dir> <truth.json> --sweep [--profiles=a,b,c]`** — extends the iter-31 CLI. Defaults sweep `bgate, temperley, krumhansl, edmm, edma, shaath`. Output is a sorted comparison table (or JSON with `--json`). Progress is written to stderr per analysis call so you can see where the sweep is in real time.
- **Schemas**: `KeyEvalCountsSchema` extracted (was inlined in `KeyEvalReportSchema`); new `KeyProfileSweepRowSchema` + `KeyProfileSweepReportSchema`.
- **Stub-friendly factory pattern**: `KeyProfileSweep` takes a `KeyOnlyAnalyzerFactory` (`profileType => analyzer`) so tests inject deterministic predictions without an essentia install. Defining the contract structurally (no `extends`/`implements`) keeps `Eval/` independent of the audio backend.
- **Tests**: 4 new in `tests/Eval/KeyProfileSweep.test.ts` (ranking, cache hit on second run, empty sweep, per-track progress events). **140/140 total**.

### Added — Key-prediction evaluation harness (Iteration 31)

- **`KeyEvaluator`** (`backend/src/Eval/KeyEvaluator.ts`) — MIREX-style scoring of predicted vs. labelled keys: `exact 1.0 / fifth 0.5 / relative 0.3 / parallel 0.2 / wrong 0.0`. Implementation routes through `Camelot` arithmetic — fifth = same letter, ±1 number mod 12; relative = same number, opposite letter; parallel = letter swap with number diff of 3 mod 12 (e.g. C major 8B ↔ C minor 5A).
- **`KeyEvaluator.parseKey()`** — accepts canonical (`A minor`), short-hand (`Am` / `CM`, lowercase-m=minor convention), Camelot (`8A`), and flat notation (`Bb major` → A# major). Returns `null` on unrecognised input so the CLI can list rejected truth lines without crashing.
- **`npm run key-eval -- <library-dir> <truth.json> [--json]`** (`backend/src/Cli/KeyEval.ts`) — read-only: loads `<library-dir>/.analysis-cache.json` directly (no analyser needed, no cache writes), parses the truth JSON (`{ "filename.mp3": "A minor" }`), emits a per-track diff table + MIREX summary, or JSON when `--json` is set. Filename matching strips `.mp3` so truth keys can be written either way.
- **Truth file format**: flat object `{ "<filename>": "<key string>" }`. vts-validated via `KeyTruthFileSchema` (`Vts.object2(Vts.string(), Vts.string())`). Both filename basename and bare-name forms accepted.
- **Tests**: 21 new in `tests/Eval/KeyEvaluator.test.ts` (parseKey: 7, categorize: 11, evaluate: 3). **136/136 total**.
- **Smoke test** (real cache, 5 hand-labelled tracks, `--json`): correctly identified 3 exact matches (Anyma 8A → A minor, Boom Cha La Ka via Camelot `8A`, Chopin Nocturne with flat-input `Eb major` → D# major), 2 wrong (Daft Punk, Easy by The Commodores). Confirms the wiring; real tuning needs the user's actual labels.
- **Note**: this is the harness only. Profile-sweep (re-running essentia.js with different `profileType` settings) is deferred until there's enough labelled data to make sweeping informative.

### Added — MP3 export for set recordings (Iteration 30)

- **`POST /api/v1/transcode`** — accepts the raw MediaRecorder upload (any container ffmpeg autodetects: WebM/Opus, OGG, MP4, WAV) on the request body and returns a 320 kbps mono MP3 (CBR via `libmp3lame`). Buffered (not streamed) so an encoder failure maps to a real `500 {"error": ...}` rather than a truncated 200 — for HBB's bounded use case (one DJ set ≤ a few hundred MB), in-memory is fine.
- **Backend classes** in `backend/src/Audio/`:
    - `AudioTranscoder` — abstract `transcode(input: Readable): Promise<Buffer>`.
    - `FfmpegTranscoder` — spawns `ffmpeg -i pipe:0 -vn -c:a libmp3lame -b:a 320k -f mp3 pipe:1`. EPIPE on stdin is swallowed (ffmpeg may close stdin before consuming the full upload on early errors), other process errors reject with the captured stderr.
    - `StubTranscoder` — test-only, prefixes the consumed input bytes; used to assert route framing without a real ffmpeg binary.
- **`TranscodeRoute`** — registered via `HbbRouteLoader` with a default `FfmpegTranscoder()`. No library dep, no auth (`checkUserLogin: false` like the other API routes).
- **Frontend**:
    - `frontend/src/inc/Api/TranscodeApi.ts` — bare `fetch` wrapper (binary in / binary out, doesn't go through `NetFetch`'s vts validation).
    - `Pages/DjSet.ts` `finalizeRecording()` now uploads the recorded blob to `/api/v1/transcode`, swaps in the returned MP3 blob for the download link, drops the old `extensionForMime()` branching (output is always `.mp3`), and shows a "transcoding…" status while the request is in flight. New language strings `dj_set_recording_transcoding` / `dj_set_recording_transcode_failed` (EN + DE).
- **Tests**: 4 new — `Audio/StubTranscoder.test.ts` (2: happy path + rejection) and `Audio/FfmpegTranscoder.test.ts` (2: real WAV→MP3 ID3v2/sync detection + reject on garbage input). Both ffmpeg tests `describe.skipIf(!ffmpegAvailable)`. **115/115** total.
- **Smoke test** (real server, `https://127.0.0.1:3777/api/v1/transcode`): a 1-second silent WAV (~88 KB) → 41841-byte MP3, identified by `file(1)` as `Audio file with ID3 version 2.4.0, contains: MPEG ADTS, layer III, v1, 320 kbps, 44.1 kHz, Monaural`. Garbage input → `HTTP 500 {"error":"ffmpeg exited with code 1: pipe:0: Invalid data found when processing input"}`.

### Changed — Schemas-workspace migration finished (Iteration 29)

- **`@headbangbear/schemas`** is now the single source of truth for all vts schemas + types shared between backend and frontend. The previously-unfinished migration is wrapped up: `frontend/src/inc/schemas/` (4 leftover duplicate files: `DjSet`, `Library`, `RouteTrack`, `TransitionPlan`) is **deleted**. The remaining frontend Api wrappers (`DjSetApi`, `LibraryApi`, `MixApi`) now import from `@headbangbear/schemas` — names normalised to the workspace's `*Schema` convention (e.g. `SchemaLibraryResponse` → `LibraryResponseSchema`, `DjSetRequest` → `DjSetBody`).
- Tests still 111/111, lint 0 errors.

### Added — UI-Polish: i18n + Drag-Loop + CLI-Flags (Iterations 24–28)

- **Iteration 24** — Bilingual UI everywhere: `Lang_EN`/`Lang_DE` extended with all sidemenu, page, control, button, status, and table-header strings. Top-right flag switcher (🇺🇸 EN / 🇩🇪 DE), persisted in `localStorage`. Re-renders the current page on switch so HTML-literal-built strings pick up the new language.
- **Iteration 25** — Landing page with two tabs: **Changelog** (iteration highlights, bilingual) and **Guide** (4-step workflow + 6-entry glossary on Camelot/BPM/Energy/Drops/Shape/Pitch). Replaces the Library page as the default landing. Includes the project logo from `doc/images/` (copied at build time via Gulp).
- **Iteration 26** — Energy-shape SVG preview next to the shape select on the DJ-Set page (live curve update on change). Help-Cards (collapsible) added to Library + DJ-Set pages.
- **Iteration 27** — Energy-walk chart under the chain table after Generate: actual energies as a blue polyline+dots, optional dashed grey ideal curve overlay when `energyShape` is set. Lets users eyeball how well the planner followed the requested trajectory.
- **Iteration 28** — Drag/Resize on the Deck loop region: wavesurfer's region plugin with `drag/resize=true`, `region-updated` listener writes the new bounds back to `loopIn`/`loopOut` so the active-loop wraparound uses the latest values. Status text refreshes live; the region itself is not rebuilt on drag (would yank the handle from under the user). Also: `dj-set` CLI gains `--shape=rising|arc|descending`, `--start=<path>`, `--target-min=N` flags — full symmetry with the HTTP API.
- Tests still 111/111. Bundle ~807 KB (was 772 before iter 22).

### Added — Energy-curve constraint (Iteration 23)

- **`DjSetPlannerOptions.energyShape`** (and `BeamSearchOptions.energyShape`) — `'rising' | 'arc' | 'descending'`, an explicit trajectory the chain should follow. Overrides `energyDirection`'s per-step scoring when set; the per-track `energyDirection` field stays in the response (for back-compat) and the new `energyShape` is echoed back when set.
- **`idealEnergyAt(shape, position, eMin, eMax)`** — closed-form ideal-energy curve. Rising/descending lerp eMin↔eMax; arc is a triangle peaking at position 0.5.
- **`trajectoryDeviation(energies, shape, eMin, eMax, expectedLength)`** — sum of `|energy[i] − idealEnergyAt(shape, i/(expectedLength−1))|` across the chain. **Pool-relative** position (`expectedLength = poolSize`), not chain-relative — so a partial chain `[0.1, 0.3, 0.5]` during beam expansion scores against the *same* curve its eventual extension `[0.1, 0.3, 0.5, 0.7, 0.9]` will. Chain-relative scoring would make a 3-track shortcut `[0.1, 0.5, 0.9]` look "perfect rising" at length 3 and starve out the better path that needs all 5 slots.
- **Greedy** picks each next track as the Camelot-compatible candidate whose energy is closest to the ideal at its position (`ordered.length / (poolSize − 1)`). `pickStartByShape` chooses lowest-energy for `'rising'`/`'arc'`, highest for `'descending'`.
- **Beam** comparator gains a `trajectoryDeviation` key, placed *below* the primary length / target keys so a long chain that loosely fits the shape still beats a perfectly shaped short chain. With `targetDurationSec` and `energyShape` both set: `(|estDuration − target|, trajectoryDeviation, −length, sumPitchAbs, −dropAligned)`. With shape only: `(−length, trajectoryDeviation, sumPitchAbs, −dropAligned)`.
- **Beam `keepShorterOnExtend`** is now also enabled when shape is set, so partial chains hand-picked by the comparator can survive iterations where their extensions would dominate the beam.
- **Backend**: `DjSetBodySchema.energyShape`, `DjSetSchema.energyShape` (both optional), `DjSetRoute` forwards.
- **Frontend**: new "Energy shape" select on the DJ-Set page (— / rising / arc / descending). Schemas mirror `EnergyShape`. Status text echoes `shape=…` when the chain was planned with one.
- **Tests**: 5 new in `BeamSearchDjSetPlanner.test.ts` (`'rising'` ascends, `'descending'` descends, `'arc'` peaks interior, greedy with `'rising'` walks the curve, response omits `energyShape` when not requested). 111/111 backend tests now.
- Bundle 772 KB (unchanged).

### Added — Time-budgeted DJ-Set generation (Iteration 22)

- **`DjSetPlannerOptions.targetDurationSec`** (and `BeamSearchOptions`) — soft target for the chain's wall-clock duration in seconds.
- **Greedy** stops adding tracks once the running estimated duration ≥ target.
- **Beam** keeps the original lex score `(−length, sumPitchAbs, −dropAligned)` when no target is set; with a target it switches to `(|estDuration − target|, −length, sumPitchAbs, −dropAligned)` so chains close to the target win even with fewer tracks.
- **Beam loop fix**: when targeting, partial states are kept *alongside* their extensions so a shorter chain that hits the target can beat its longer extensions in the lex score. Without this, a state was replaced by its extensions every iteration and the comparator never saw the shorter alternative.
- **`estimateChainDurationSec`** mirrors `AutoPlayer`'s scheduling math (cue points, pitch shift, crossfade overlap) so the estimate matches what the user actually hears.
- **Backend**: `DjSetBodySchema` gains optional `targetDurationSec`; `DjSetRoute` forwards.
- **Frontend**: new "Target (min)" input on the DJ-Set page next to beam width. Empty = no target. Pages converts to seconds before sending.
- **Tests**: 2 new tests in `BeamSearchDjSetPlanner.test.ts` (greedy stops at target, beam prefers target-fit over plain max-length). 106/106 backend tests now.
- Bundle 772 KB.

### Added — Loop In/Out (Iteration 21)

- **`Deck` widget** gains a loop row under the hot cues:
    - **Set In** / **Set Out** buttons snapshot the current playback position to the loop bounds.
    - **Clear** wipes both bounds and disables the loop.
    - **active** checkbox toggles auto-jump. While checked, an `audioprocess` listener calls `wavesurfer.setTime(loopIn)` whenever the cursor reaches `loopOut`. Activating with the cursor already past `loopOut` jumps back immediately.
    - Status text shows the bounds: `in 12.34s · out 18.20s`.
    - Setting an Out before In (or vice versa) clears the conflicting bound rather than silently accepting an invalid loop.
    - **Translucent yellow region** painted on the waveform between the bounds, with `↻ loop` content. Sits alongside the existing red drop markers and cyan hot-cue markers.
- **`hideLoop: true`** option for the DJ-Set page's Now-Playing deck (silent wavesurfer — looping that wavesurfer would do nothing audible since the AutoPlayer drives audio).
- **Per-track session state**: loop bounds reset on every track load, mirroring how DJs typically use loops as ad-hoc controls rather than persistent metadata. (Hot cues, by contrast, persist via `HotCueStore`.)
- Bundle 771 KB.

### Added — Hot Cues (Iteration 20)

- **`HotCueStore`** (`frontend/src/inc/Util/HotCueStore.ts`): singleton, 8 cue slots per track-path, persisted to `localStorage` under key `hbb.hotcues.v1`. vts-validated load (drops out-of-shape payloads silently). Tracks-with-no-cues are removed from the map to keep storage tight.
- **`Deck` widget** gains a hot-cue row under the EQ controls — 8 numbered buttons + a help hint:
    - **Click empty button** → snapshots `wavesurfer.getCurrentTime()` to that slot, button turns blue.
    - **Click filled button** → `wavesurfer.setTime(cue)` (jumps without changing play state).
    - **Shift+click filled button** → clears the slot.
    - Each set cue is also painted on the waveform as a 0.08 s cyan vertical bar with the slot number as the label (alongside the existing red drop markers).
- **`hideHotCues: true`** option for the DJ-Set page's Now-Playing deck (silent wavesurfer driven by AutoPlayer — cue jumps would do nothing there).
- Bundle 768 KB.

### Added — Per-source EQ A/B (Iteration 19)

- **`AutoPlayer` gains per-source EQ chains**: every scheduled track now gets its own LO/MID/HI BiquadFilters inserted between the per-track gain (used for crossfades) and the master gain. Tracks alternate sides — index `0, 2, 4, …` → Side A; `1, 3, 5, …` → Side B — mirroring a 2-channel DJ mixer.
    - `setSideEqGainDb(side, band, db)` updates the in-memory side state and propagates the new gain to every already-scheduled filter on that side. Live changes take effect mid-playback (BiquadFilter `.gain.value` is hot-swappable).
    - `getSideEqState()` / `resetSideEq(side)` round out the API.
    - Constructor takes optional initial `SideEqState` so a re-spawned player inherits the user's slider positions.
- **DJ-Set page** gets two new EQ rows (Side A, Side B) below the master EQ. Each has LO/MID/HI sliders + a per-side Reset. The `● active` badge follows the currently-audible side based on `onTrackChange` index parity.
- **Use case**: classic DJ EQ-cut during a crossfade — pull bass on the outgoing side, bring it in on the incoming side, all without affecting the master tonal balance.
- **Routing per scheduled source**: `source → trackGain (crossfade) → trackEqLow → trackEqMid → trackEqHigh → master gain → master EQ → destination`. Master EQ from Iteration 17 is unchanged and still useful as a global tonal layer on top.
- Bundle 765 KB.

### Added — Set recording (Iteration 18)

- **`AutoPlayer` gains MediaRecorder support**: `startRecording()` taps the master EQ chain via `AudioContext.createMediaStreamDestination()`, instantiates a `MediaRecorder` on that stream, and accumulates Blob chunks. `stopRecording(): Promise<Blob | null>` finalises the chunks into a single Blob, disconnects the stream tap, and returns it. Codec is auto-picked from `audio/webm;codecs=opus` → `audio/webm` → `audio/ogg;codecs=opus` → `audio/mp4` based on `MediaRecorder.isTypeSupported`.
- **DJ-Set page** has a **"Record set" checkbox** below the EQ controls. When armed and the user clicks **Play**, the AutoPlayer records the full session (with crossfades + EQ exactly as the user hears them). On natural finish or **Stop**, a download link appears with a timestamped filename (`headbangbear-set-YYYYMMDD-HHMMSS.webm`) and the file size in MB.
- Object URLs are revoked when superseded or when the page unmounts.
- Bundle 758 KB.

### Added — Master EQ on AutoPlayer (Iteration 17)

- **`AutoPlayer` gains a master 3-band EQ** wired between the master gain node and `AudioContext.destination`: lowshelf 250 Hz, peaking 1 kHz Q=0.7, highshelf 5 kHz. New API: `setEqGainDb(band, db)`, `resetEq()`, `getEqState()`. Constructor takes optional `MasterEqState` so pages can hand a fresh player the current slider values.
- **DJ-Set page**: three EQ sliders (LO/MID/HI, −12..+12 dB) plus an EQ Reset button next to the master volume. Live-binds to the active `AutoPlayer` instance — adjusting a slider during playback affects the audio immediately. Slider state is stored on the page so a re-spawned player (after Stop / Play) inherits.
- **Limitation**: EQ is master-level (applies equally to whatever is playing, including both tracks during a crossfade). Per-source EQ ("DJ-classic" — cut bass on outgoing while bringing in incoming separately) is deferred — would require per-scheduled-source filter chains plus a more complex UI that knows which side is "outgoing" vs "incoming".
- Bundle 754 KB.

### Added — Per-deck 3-band EQ (Iteration 16)

- **`Deck` widget gains a 3-band EQ row**: LO (lowshelf 250 Hz), MID (peaking 1 kHz, Q=0.7), HI (highshelf 5 kHz). Each slider goes -12 dB to +12 dB in 0.5 dB steps, with a Reset button. Live dB readout next to each slider.
- **Web Audio chain per deck**: on every track load `setupEqChain()` creates a `MediaElementAudioSourceNode` from `wavesurfer.getMediaElement()`, wires it through three `BiquadFilterNode`s, and connects to `AudioContext.destination`. `teardownEqChain()` disconnects on the next load (wavesurfer destroys its old audio element, so the previous source becomes orphaned).
    - Once `createMediaElementSource` is called for a media element, the element's normal speaker output is replaced — the chain *must* connect to `ctx.destination` or the deck goes silent.
    - First call may fail if wavesurfer reused the same element; we log + leave EQ inactive in that case rather than crash playback.
- **`hideEq: true` option** on `DeckOptions` for the DJ-Set page's Now-Playing deck — wavesurfer there is silent (the AutoPlayer drives audio via its own AudioContext) so per-deck EQ would do nothing. Saves visual clutter.
- **Note**: the EQ only affects the per-deck wavesurfer playback (Library Play button). The AutoPlayer (Library "Play Transition" + DJ-Set page) still plays unfiltered — adding per-track EQ to the AutoPlayer chain is a follow-up.
- Bundle 751 KB.

### Added — Beat grid + Compatible filter + Master volume (Iteration 15)

- **Beat-grid overlay** on every Deck — second pass on the existing canvas overlay, vertical lines at every beat (faint grey) with stronger lines at every 4th beat (bar marks). Uses the new `RouteTrack.beats` field.
- **`RouteTrack` schema** now includes `beats: number[]` (frontend + backend mirrors). Adds ~`durationSec / beatInterval` numbers per track to the `/api/v1/library/list` response (~500 entries for a 4-min track at 128 BPM).
- **Library "Compatible only" toggle** — Bootstrap-switch above the tracks table that hides every row whose Camelot is not compatible with whatever is currently loaded in Deck A. Updates live when the deck changes. Combined cleanly with the existing search filter via a single `applyTableFilters()` pass.
- **`CamelotUtil.isCompatible(a, b)`** — frontend mirror of the backend rule (same code / same number / same letter ±1 number) so the filter works without a round-trip to `/api/v1/tracks/compatible`.
- **Master volume slider** on both pages, controls `AutoPlayer.master.gain.value`:
    - Library toolbar (next to Setlist counter) → applies to "Play Transition" playback.
    - DJ-Set controls (next to Stop) → applies to set playback.
    - Slider state is stored on the page so newly-spawned `AutoPlayer` instances inherit it via constructor `new AutoPlayer(this.masterVolume)`.
- Bundle 746 KB.

### Added — Now-Playing waveform + DJ visualisations (Iteration 14)

- **DJ-Set page now has a Now-Playing deck** below the controls (purple-themed `Deck` instance, `'NP'` label, no per-deck Play button — driven entirely by `AutoPlayer`). The page pre-fetches the library on load to look up full `RouteTrack` data by path; on `onTrackChange` it swaps the deck's track, on `onTrackProgress` for the current index it calls `syncToTime` so the cursor follows playback (including across the crossfade window).
- **`Deck` widget visuals**:
    - **Hover plugin** always-on — tooltip with the formatted time at the mouse position.
    - **Energy curve overlay** — read-only orange polyline rendered on a canvas above the waveform from `RouteTrack.energyTimeline` (per-second RMS). DJ sees where a track gets quieter / louder without affecting playback. Wavesurfer's built-in `Envelope` plugin is *not* used because it acts as a volume controller, which would override the planned mix gains.
    - **Spectrogram toggle** — checkbox under the waveform lazily creates / destroys a `Spectrogram` plugin instance. Default off (heavy).
- **Backend**: `RouteTrackSchema` and `LibraryRoute.toRouteTrack` now include `energyTimeline` so the frontend can render the energy curve. Adds ~`durationSec` numbers per track to the response.
- **Frontend `RouteTrack` schema** mirrors the backend addition.
- **Library page search**: text input above the tracks table; live-filters rows by filename substring (case-insensitive). Each row is tagged with `data-filename` for the filter.
- Bundle 742 KB (vs 699 KB before — wavesurfer's `hover` + `spectrogram` plugins).

### Added — Setlist persistence + library rescan (Iteration 13)

- **`SetlistStore`** now persists to `localStorage` under key `hbb.setlist.v1`. Loaded once on first `getInstance()`, saved on every change. Schema-validated on load — out-of-shape payloads are dropped silently. The setlist therefore survives browser refresh.
- **Backend `POST /api/v1/library/rescan`**: re-runs `TrackLibrary.scan()` against the configured `library.rootDir`. Existing cache entries with matching `mtime`/`size` are reused, so a typical rescan after dropping in a few new MP3s finishes in well under a second. Returns the refreshed `LibraryResponse`.
    - `LibraryService.rescan()` is the new method.
    - `LibraryRoute` constructor now takes the whole `LibraryService` (not just `library + rootDir`) so the rescan handler can reach it.
- **Frontend rescan button** on the Library card header (sync icon). Spins while the request is in flight, re-renders the table on completion. `LibraryApi.rescan()` posts the request.

### Added — Synced wavesurfer cursors + better timeline & drop markers (Iteration 12)

- **`AutoPlayer.play()` gains a fourth callback `onTrackProgress(index, trackTimeSec)`**: a `requestAnimationFrame` loop fires it for every active scheduled track, with `trackTime = startOffset + (now - startWall) * pitchRate`. Library page wires it to `deckA.syncToTime()` / `deckB.syncToTime()` so the wavesurfer cursors actually move while the AutoPlayer plays — both decks during the crossfade window.
- **`Deck.syncToTime(sec)`** moves the cursor without playing audio (uses `wavesurfer.setTime()`).
- **Wavesurfer Timeline plugin** added under each deck (seconds ticks every 30 s major, 5 s minor).
- **Drop markers redesigned**: 0.08 s narrow regions (was 0.4 s) in solid red with a labeled `▼ N s` content tag, instead of the wide translucent yellow regions.
- Bundle 698 KB.

### Added — Manual Setlist + Play-Transition (Iteration 11)

- **`SetlistStore`** (`frontend/src/inc/Widget/SetlistStore.ts`): singleton frontend store. Each entry is `{from, to, transition}` (Library page adds via "Add to Setlist"). `toDjSet()` builds a `DjSet` for `AutoPlayer` consumption when the chain is continuous. `onChange` listeners drive the live count display and DJ-Set page refresh.
- **Library page**: new toolbar buttons after "Plan Mix":
    - **Play Transition** → spawns a 2-track `AutoPlayer` so the user hears the planned A→B mix without leaving the page (pauses both wavesurfer decks first to avoid overlap).
    - **Stop** → halts the transition playback.
    - **Add to Setlist** → pushes the current `{A, B, plan}` into `SetlistStore`.
    - Live "Setlist: N entries" counter.
- **DJ-Set page** gains a **source toggle** ("Auto-generated" / "Manual setlist (N)"):
    - Auto: existing greedy/beam generator, unchanged.
    - Manual: pulls from `SetlistStore`. Each row gets a remove (×) button, plus a "Clear setlist" action. Discontinuous setlists report which transition breaks the chain instead of playing.
- **`Deck.pause()`** added so callers can mute the wavesurfer decks before triggering AutoPlayer playback.
- Bundle 691 KB.

### Fixed — CSP blocks blob: media URLs (Iteration 10 follow-up)

- **`backend/src/Server/applyCspOverride.ts`**: monkey-patches `helmet.contentSecurityPolicy` to add `mediaSrc 'self' blob:` and `connectSrc 'self' blob:`. Without this the browser blocks `wavesurfer.js` waveform playback and the `AutoPlayer`'s decoded audio buffers (figtree's default CSP `default-src 'self'` rejects all `blob:` URLs). Implementation patches helmet rather than `HttpServer.prototype` because figtree's package `exports` map blocks deep imports of `HttpServer`. Idempotent; called from `HeadbangbearApp` constructor so the patched factory is in place by the time `HttpService.start()` registers the helmet middleware.

### Added — Auto-play DJ set with crossfades (Iteration 10)

- **`AutoPlayer`** (`frontend/src/inc/Widget/AutoPlayer.ts`): Web Audio API-driven sequential player. Pre-loads every track in the set as an `AudioBuffer` (parallel `fetch` against `/api/v1/library/audio`), schedules each `AudioBufferSourceNode` with a `GainNode` for linear-ramp crossfades at the planned `cueOutSec` / `cueInSec` / `mixDurationSec`, and applies `playbackRate = 1 + transition.pitchPercent / 100` per track (turntable-style — pitch and tempo move together).
- **New DJ-Set page** (`frontend/src/inc/Pages/DjSet.ts`) wired into the sidebar:
    - Controls card with strategy (`greedy` / `beam`), `energyDirection` (`up` / `down` / `either`), `beamWidth` input, and **Generate** / **Play** / **Stop** buttons.
    - Chain table showing every track + the per-pair pitch%, keyMatch, alignment, and mixBars.
    - Now-playing row gets `table-success` highlight as the player advances.
- **Bundle** grows to ~681 KB. No new deps — uses the browser's native `AudioContext`.

### Added — DJ-mixer UI with waveforms (Iteration 9)

- **Backend `AudioRoute`** (`backend/src/Server/Routes/AudioRoute.ts`): `GET /api/v1/library/audio?path=<abs>` streams the requested mp3 with HTTP Range support (`Accept-Ranges: bytes`, 206 Partial Content). The path is validated against the loaded library so the route cannot read arbitrary files. Uses `figtree`'s `HandlerResultType.handled` escape hatch + Express `res.sendFile()` for native range handling.
- **Frontend `Deck` widget** (`frontend/src/inc/Widget/Deck.ts`): one-shot DJ deck panel — track-info badges (Camelot, Open Key, BPM, energy %, drop count, duration), `wavesurfer.js` waveform with normalized rendering, drop markers as yellow regions, play/pause control. `setCue(positionSec, 'in' | 'out')` paints a red region from 0→position (cue-in) or position→end (cue-out) for mix-plan overlays.
- **Library page is now a DJ mixer**: two `Deck`s side by side (Deck A / Deck B), plus a "Plan Mix A → B" button. Track-list table at the bottom has `→ A` / `→ B` action buttons per row that load the track into the chosen deck.
- **Plan-Mix overlay**: clicking "Plan Mix" calls `MixApi.plan(A, B)`, paints `cueOutSec` on Deck A and `cueInSec` on Deck B, and shows badges for keyMatch / alignment / pitch% / mixBars plus the full notes list.
- **New deps**: `wavesurfer.js` (frontend, regions plugin used).
- **Smoke test (real library)**: server returns the index/bundle/audio over HTTPS. `curl -r 0-2047` against the audio endpoint returns `206 Partial Content` with a valid MP3 payload (`Audio file with ID3 version 2.3.0`). `Content-Length: 8645616` confirmed via HEAD-like probe.
- **Bundle size**: `dist/index.js` ~672 KB (vs 610 KB before — wavesurfer + regions plugin).

### Added — bambooo frontend (Iteration 8)

- **Frontend skeleton ported from `kavula`**: webpack + gulp build pipeline, AdminLTE/bambooo asset layout, bootstrap from `bambooo` `Wrapper` + `BasePage` + `PageLoader` singleton.
- **Library page** (`frontend/src/inc/Pages/Library.ts`): renders the full `/api/v1/library/list` response in a bambooo `Card`+`Table` (filename, Camelot badge, Open Key, BPM, energy, drop count). Clicking a row loads the matching `/api/v1/tracks/compatible` response into a second card with `bpmDelta` per match.
- **Net layer** (`Net/NetFetch.ts`, `Net/Response.ts`, `Net/Error/*`): adapted from kavula. Validates the bare JSON response against a vts schema — no `DefaultReturn` envelope.
- **API classes**: `LibraryApi.list/compatible`, `MixApi.plan`, `DjSetApi.plan` — thin wrappers over `NetFetch` against the `/api/v1/*` endpoints.
- **Inline schemas** under `frontend/src/inc/schemas/`: `RouteTrack`, `LibraryResponse`, `CompatibleResponse`, `TransitionPlan`, `DjSet`. Duplicated from `backend/src/Server/schemas.ts` and `Mix/MixTransition.ts`. *(Later extracted into the shared `@headbangbear/schemas` workspace — see Iteration 29.)*
- **i18n**: `Lang_EN` and `Lang_DE` (subset matching the Library page strings).
- **Backend wiring**: `httpserver.publicdir` now points at `../frontend`, so figtree serves `index.html`, `dist/`, and `assets/` from the same origin as the API. Browser opens `https://localhost:3000/` and the SPA fetches `/api/v1/...` without CORS hassle.
- **New deps**: `bootstrap`, `@popperjs/core` (frontend); webpack toolchain (`ts-loader`, `fork-ts-checker-webpack-plugin`, `webpack`, `webpack-cli`); gulp; `vts` for response validation in the browser.
- **Smoke test (real library)**: server returns `index.html` (1.2 KB), `/api/v1/library/list` (15 tracks), `/assets/css/adminlte.css` (1.5 MB), `/dist/index.js` (610 KB) all over HTTPS on the same origin.

### Added — figtree HTTP API (Iteration 7)

- **`HeadbangbearApp`** (`backend/src/Server/HeadbangbearApp.ts`): figtree `BackendApp` subclass that registers `LibraryService` (analyses + caches the configured library on startup) and `HttpService` (mounts our four routes).
- **`HbbConfigBackend`** extends figtree's `ConfigBackend` with an extra `library: { rootDir }` block on top of `SchemaConfigBackendOptions`. `install()` registers itself as the global `Config` singleton so any code calling `Config.getInstance()` (e.g. `HttpService`) sees the loaded extended config.
- **Routes** under `/api/v1/`:
    - `GET  /api/v1/library/list` — analysed-track list with Camelot, OpenKey, BPM, energy, drops.
    - `GET  /api/v1/tracks/compatible?path=<abs-path>` — Camelot-compatible tracks sorted by BPM proximity, with `bpmDelta`.
    - `POST /api/v1/mix/plan` — body `{ fromPath, toPath }` → full `TransitionPlan`.
    - `POST /api/v1/dj-set/plan` — body fields map 1:1 to `DjSetPlannerOptions` (incl. `startPath` resolved against the library) → full `DjSet` with per-pair transitions.
- **`LibraryService`** holds a single `TrackLibrary` for the lifetime of the process — no per-request rescans. Set status codes (`ServiceStatus.Progress` → `Success`) so `HttpService` resolves the dependency correctly.
- **`LazyEssentiaAnalyzer`**: defers `EssentiaAudioAnalyzer` import until the first cache miss. essentia.js installs a global `process.on('unhandledRejection', abort)` handler at module-load time which would otherwise terminate the server on any minor rejection elsewhere in the process.
- **CLI (existing)** unchanged. New entry point: `npm run dev -w @headbangbear/backend` (tsx watch on `src/index.ts`).
- **Config**: `backend/config.example.json` shipped as a starting point; gitignored `config.json` is what the server actually reads. Required fields: `httpserver.port/publicdir`, `library.rootDir`, plus optional `logging` (set `dirname` to a writable path or omit to use the default `/var/log/app/`).
- **Tests**: 10 new tests in `backend/tests/Server/Routes/Routes.test.ts` exercising every route handler with a stub-backed `TrackLibrary` (no real audio, no HTTP listener).
- **Smoke test (real library)**: `GET /api/v1/library/list` returns all 15 tracks; `POST /api/v1/dj-set/plan { "strategy": "beam" }` returns the same 5-track chain that `npm run dj-set` produces (Sono → Anyma → Boom Cha La Ka → Westbam → Có Khi Nào). HTTPS with self-signed cert by default.
- **New deps**: `figtree-schemas` (runtime peer of figtree, was missing), `@types/express` (devDep).

### Added — Multi-start beam search (Iteration 6)

- **`tryAllStarts` option** in `BeamSearchDjSetPlanner` (default `true`). When set, every track in the pool is tried as the starting track and the lex-best chain wins. The transition cache is shared across all starts so worst-case work is bounded by `N²` `MixTransition.plan()` calls regardless of pool size.
- **`DjSetPlanner.plan()`** now forwards `tryAllStarts` to the beam strategy. Greedy ignores it.
- **CLI**: `dj-set` accepts `--single-start` to opt out of multi-start, e.g. `npm run dj-set -- <dir> up beam --single-start`.
- **Real-library win**: on the sample library where greedy and single-start beam both terminated after 2 tracks (Chopin → Commodores dead-end cluster), multi-start beam finds a 5-track chain spanning the 8A cluster plus 7A → 6A neighbours.
- **Tests**: 3 new tests covering multi-start vs single-start outputs and explicit-start behaviour. Existing tests that depend on deterministic single-start chains were tagged with `tryAllStarts: false`.

### Added — Beam-search DJ-set planner (Iteration 5)

- **`BeamSearchDjSetPlanner`** (`backend/src/DjSet/BeamSearchDjSetPlanner.ts`): keeps the top-K partial chains per expansion step instead of committing greedily. Default `beamWidth = 8`.
    - **Lex score** (lower wins): primary `−ordered.length`, secondary `sumPitchAbs`, tertiary `−dropAligned`. Length always dominates pitch and drop count.
    - **Transition memoisation** per `(from.path, to.path)` so each `MixTransition.plan()` runs at most once per session.
- **`DjSetPlanner`** now accepts `strategy: 'greedy' | 'beam'` (default `'greedy'`) and `beamWidth?: number`. When `strategy === 'beam'`, planning is delegated to `BeamSearchDjSetPlanner`.
- **CLI**: `dj-set` now takes an optional strategy argument and `--beam-width=N`, e.g. `npm run dj-set -- <dir> up beam --beam-width=16`.
- **Tests**: 8 new tests in `backend/tests/DjSet/BeamSearchDjSetPlanner.test.ts` (edge cases, beam beats greedy on a deliberately dead-end fixture, lex score across mutually-exclusive equal-length chains, beam-width knob, determinism, `DjSetPlanner` delegation).
- **Known limitation**: beam search shares the greedy start-track pick (lowest energy by default, or `options.start`). On libraries where the start sits in a small Camelot sub-cluster, beam returns the same chain as greedy because no extension is reachable. Multi-start beam search is tracked as future work.

### Added — DJ-set planning (Iteration 4)

- **`DjSetPlanner`** (`backend/src/DjSet/DjSetPlanner.ts`): greedy planner that orders an `AnalyzedTrack` pool into a Camelot-compatible chain, respecting an `energyDirection` of `'up' | 'down' | 'either'`. Tracks that cannot be reached from the current end of the chain are returned in `skipped`.
    - Start track is auto-picked (lowest energy by default, highest for `'down'`) and can be overridden via `plan({ start })`.
    - Candidate ranking: primary key is direction-respecting energy delta with a flat penalty for wrong-direction picks; secondary is BPM proximity.
- **vts schemas** for the new types: `EnergyDirectionSchema`, `DjSetTrackSchema`, `DjSetSchema`.
- **CLI**: `npm run dj-set -- <library-dir> [up|down|either]` (`backend/src/Cli/DjSet.ts`). Emits the full plan as JSON, including every per-pair `TransitionPlan`.
- **Tests**: 9 new tests in `backend/tests/DjSet/DjSetPlanner.test.ts` (edge cases, greedy ordering, transitions).

### Added — Drop-aligned transitions (Iteration 3)

- **`MixTransition`** now dispatches between two strategies:
    - **Drop-aligned** (preferred): if both tracks have at least one detected drop, the crossfade is placed so A's last drop and B's first drop coincide in real wall time. The lead-in targets 16 bars (floor 8) and the pitch ratio (`fromBpm / toBpm`) is taken into account when projecting B's drop into wall time.
    - **Energy-aligned** (existing fallback): bar-snapped cue points derived from each track's loudness curve.
- **New plan field**: `alignment: 'drop' | 'energy'` exposes which strategy was used.
- **Drop notes** added to `notes[]`, e.g. `Drop-aligned: A's drop @166.0s ↔ B's drop @62.0s, 16.4-bar lead-in.`
- **Tests**: 7 new tests in `backend/tests/Mix/MixTransition.test.ts` covering drop-on-drop alignment, lead-in shortening, fall-back paths, pitch-ratio compensation, and the `alignment` field.

### Added — Drop detection (Iteration 2)

- **`DropDetector`** (`backend/src/Analysis/DropDetector.ts`): heuristic over the per-second energy timeline — a sample qualifies as a drop when it is `≥ max × highRatio` and was preceded within `lookbackSec` by a sample `≤ max × lowRatio`, and the previous drop is at least `minSpacingSec` ago. Defaults: `0.3 / 0.65 / 6 s / 16 s`.
- `EssentiaAudioAnalyzer` now invokes `DropDetector.detect()` during analysis, populating `AnalysisResult.drops` and the on-disk cache.
- Cache version bumped to **3**; old caches are auto-invalidated and re-analysed.

### Added — Mix transitions (Iteration 1, MVP)

- **`MixTransition`** (`backend/src/Mix/MixTransition.ts`) with `plan(): TransitionPlan` returning pitch-shift percent, cue-out / cue-in seconds, mix duration in seconds and bars, key-match classification (`identical | relative | energy-up | energy-down | incompatible`), and a `notes[]` array.
- **`TrackLibrary.compatible(track)`** filters Camelot-compatible tracks and sorts them by BPM proximity.
- **CLIs**: `mix-plan` (single A → B plan) and `compatible` (compatible-track listing).

### Added — Foundation (Iteration 0)

- **TypeScript monorepo** (`npm` workspaces) with `@headbangbear/backend` and `@headbangbear/frontend`. Strict + extra-strict (`noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`); decorators enabled for `figtree` / TypeORM.
- **`Camelot`** and **`OpenKey`** classes — full conversion graph, neighbour walks, and Camelot compatibility rules.
- **`AudioAnalyzer`** abstract class with two implementations:
    - `EssentiaAudioAnalyzer`: `essentia.js` WASM + `ffmpeg` decoding; computes key, BPM, average RMS energy, beat ticks, and per-second energy timeline.
    - `StubAudioAnalyzer`: deterministic synthetic output for tests.
- **`TrackLibrary`** with vts-validated incremental disk cache (`mtime` + `size` invalidation).
- **CLIs**: `analyze` (single-file inspection).
- **Toolchain**: `vitest`, `eslint` (flat config), `prettier` (4-space indent, single quotes, 100-char width), `tsx` for direct CLI execution.

---

## Notes

- `npm install` requires `--ignore-scripts` until upstream `summernote` removes its broken `husky install` postinstall.
- Audio analysis requires `ffmpeg` on `PATH`. First-pass analysis of a track is ~30 s on the WASM build; subsequent runs hit the cache.