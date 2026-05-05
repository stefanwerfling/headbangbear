<p align="center">
    <img src="doc/images/logo.png" alt="Headbangbear logo" width="280" />
</p>

# (H)ead (b)ang (b)ear

> Music analysis with **Harmonic Mixing** support — analyse audio files for key, BPM, energy, and drops, then plan DJ-style transitions, build full Camelot-compatible sets, and play them in the browser with crossfades, EQ, recording, and MP3 export.

Head bang bear is a TypeScript monorepo built around the idea that *"what should I play next?"* is a question with a deterministic answer once you know each track's key, tempo, energy curve, drops, and embedded metadata. The backend extracts that information from audio (essentia.js + ffmpeg + ID3 tags), models the Camelot wheel as a typed domain, and plans transitions and full sets on top. The frontend is a bambooo / AdminLTE SPA that turns that into a four-page app: Library (DJ-mixer style), DJ Set (set generator + player), Key Labels (ground-truth + profile sweep), and Home (changelog + guide).

### Word game
"Head Bang Bear" is a wordplay reference to "headbanging," a common movement in rock and metal culture where people shake their heads rhythmically to music. Combined with a bear, it creates a strong yet slightly playful image: a wild, energetic bear that symbolizes power, intensity, and raw energy.

---

## Features

### Library sources

- **Local filesystem** — point HBB at a directory of MP3s (configured in `backend/config.json` under `library.rootDir`). Embedded ID3 tags + cover art are extracted via `music-metadata`; no network.
- **Jellyfin server** — point HBB at a Jellyfin URL + API key in the Settings page. Tracks are listed via the Jellyfin REST API, audio bytes stream straight through to the analyser (`Jellyfin → fetch.body → ffmpeg stdin → essentia`) without ever materialising a local file. Playback proxies Jellyfin's `Items/{id}/Download` with the browser's `Range` header forwarded so seeking works through the proxy. Pagination + `AbortSignal.timeout` handle large libraries / slow upstreams cleanly.

### Analysis pipeline

- **Audio analysis** via `essentia.js` (WASM) + `ffmpeg` decoding: musical key, BPM, average energy, beat grid, per-second energy timeline, detected drops. The analyzer accepts either a file path (local source) or a `Readable` stream (Jellyfin source) — same essentia pipeline either way.
- **Embedded metadata** (artist / title / album / year / genre + cover art) read from ID3v2 / Vorbis / MP4 atoms via `music-metadata` for local sources; pulled directly from the Jellyfin item payload for remote sources.
- **Cover-art cache** on disk for local libraries (`<library>/.covers/<sha1>.<ext>`); proxied live for Jellyfin libraries.
- **Two-tier caching (local)** — slow audio analysis (`<library>/.analysis-cache.json`, version-pinned) and fast metadata enrichment (`<library>/.metadata-cache.json`) live in separate files so re-tagging tracks doesn't invalidate key/BPM data. **Jellyfin** uses one cache (`<rootDir>/.jellyfin-data/.analysis-cache.json`) keyed by item-ID + `DateModified`.
- **Background scans with live progress** — the scan runs in a fire-and-forget promise so the HTTP server is up immediately. The Library page polls `GET /api/v1/library/scan-status` and renders a banner with a progress bar; new tracks appear in the table as they're analysed.
- **Key-detection profile sweep** — re-run essentia with each of `bgate / temperley / krumhansl / edmm / edma / shaath` against your hand-labelled truth, ranked by MIREX score, so you can pick the profile that fits your library best.

### Domain model

- **Camelot wheel** (`8A`, `5B`, …) and **Open Key** (`8m`, `5d`, …) as first-class TS classes with conversions, neighbour walks, and compatibility rules.
- **MIREX-style key evaluator** — categorises predicted vs labelled keys as `exact / fifth / relative / parallel / wrong` (1.0 / 0.5 / 0.3 / 0.2 / 0.0).

### Mix planning

- **Single-transition planner** (`MixTransition`): pitch-shift to BPM-match, plus four user-selectable styles —
    - **Drop-on-Drop** (default) — A's last drop and B's first drop coincide in wall time.
    - **Tail-Out** — A's drop plays out fully, then fade.
    - **Early-Cut** — A is cut before its drop, B's drop is the climax.
    - **Bar-Match** — ignore drops, just bar-snap energy-aligned cues.
- **DJ-set planner** (`DjSetPlanner`): greedy or beam-search chain over a track pool with Camelot constraints, energy direction (`up` / `down` / `either`) and energy shape (`rising` / `arc` / `descending`). Multi-start beam by default avoids disconnected-cluster traps. Optional **artist-diversity penalty** as a tiebreaker.
- **Time-budgeted generation** — `targetDurationSec` makes the planner prefer chains close to a wall-clock target.

### Browser app

- **Library page** — DJ-mixer style with two decks (cover, artist/title, badges, waveform, beat grid, drop markers, energy curve), 8 hot cues per track, loop in/out, 3-band EQ per deck, tempo + pitch-lock per deck, plan-mix toolbar, sortable/filterable track table (text search + Camelot-compatible toggle + BPM/Energy/Year ranges + Genre dropdown), keyboard shortcuts. **Live scan banner** — when the backend is mid-scan, a progress bar at the top updates every 2 s and tracks appear in the table as they're analysed.
- **DJ Set page** — strategy/direction/shape/style/target/avoid-same-artist controls, generated chain table with covers, now-playing card with current track's cover/artist/title, per-side EQ, master EQ, master volume, AutoPlayer pitch-lock, set recording → server-side ffmpeg transcode → 320 kbps MP3 download.
- **Key Labels page** — labelling UI (24-key dropdown per track) + Profile Sweep card to run essentia against your labels and rank profiles by MIREX score.
- **Settings page** — pick the library source (Local files vs Jellyfin server). Jellyfin form (URL / API key / optional User ID with auto-discovery) + Test-Connection button with verbose result.
- **Home page** — landing with audio-intro (autoplay-on-first-visit with disable checkbox), Changelog tab, comprehensive Guide tab (quickstart → per-page walkthroughs → glossary → tips, EN/DE).
- **Bilingual** — top-right flag switcher (🇺🇸 EN / 🇩🇪 DE), persists in `localStorage`.

### HTTP API

`figtree`-based REST API on a self-signed HTTPS origin. Routes:

| Route | Purpose |
|---|---|
| `GET /api/v1/library/list` | All analysed tracks with metadata + `hasCover` flag |
| `POST /api/v1/library/rescan` | Re-run scan in the background |
| `GET /api/v1/library/scan-status` | Poll-friendly state of the background scan (current/total/phase/error) |
| `GET /api/v1/tracks/compatible?path=` | Camelot-compatible matches for a given track |
| `POST /api/v1/mix/plan` | Plan a single A → B transition |
| `POST /api/v1/dj-set/plan` | Plan a full chain through the library |
| `GET /api/v1/library/audio?path=` | Stream a track — `res.sendFile` (local) or Jellyfin proxy with Range forwarding |
| `GET /api/v1/library/cover?path=` | Stream the track's cover image |
| `GET /api/v1/library/key-labels` | Read `<library>/truth.json` |
| `POST /api/v1/library/key-labels` | Replace `<library>/truth.json` |
| `POST /api/v1/library/profile-sweep` | Run key-detection profile sweep |
| `GET /api/v1/settings/state` | Read persisted application settings |
| `POST /api/v1/settings/state` | Replace persisted application settings |
| `POST /api/v1/settings/jellyfin-test` | Probe a Jellyfin server (no save) |
| `POST /api/v1/transcode` | WebM/Opus → 320 kbps MP3 (libmp3lame) |

See [`doc/api.md`](doc/api.md) for the full reference.

### CLIs

`npm run analyze`, `compatible`, `mix-plan`, `dj-set`, `key-eval` — every analysis + planning step has a CLI counterpart, useful for batch jobs and CI.

---

## Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Language | TypeScript (strict + `noUncheckedIndexedAccess`) | Decorators enabled. |
| Backend framework | [`figtree`](https://github.com/stefanwerfling/figtree/tree/claude) (`claude` branch) | Routes, services, sessions, TypeORM, Redis, clustering. |
| Frontend framework | [`bambooo`](https://github.com/stefanwerfling/bambooo) | AdminLTE-based admin UI toolkit. |
| Audio analysis | `essentia.js` (WASM) | `KeyExtractor`, `RhythmExtractor2013`, `RMS`. |
| Decoding | `ffmpeg` (spawned) | mono f32le PCM @ 44.1 kHz from MP3. |
| Tag reading | `music-metadata` | ID3v2 / Vorbis / MP4 atoms — pure JS. |
| Validation | [`vts`](https://github.com/OpenSourcePKG/vts) | Single source of truth for data shapes — no parallel TS interfaces. |
| Tests | `vitest` | Unit-level, no real audio required (synthetic `StubAudioAnalyzer`). 164 tests in 17 files. |

---

## Repository layout

```
.
├── schemas/                     # @headbangbear/schemas
│   └── src/                     # vts wire schemas shared between backend + frontend
├── backend/                     # @headbangbear/backend
│   ├── src/
│   │   ├── Analysis/            # Camelot, OpenKey, AudioAnalyzer (string | Readable), DropDetector
│   │   ├── Audio/               # FfmpegDecoder (path or stream), FfmpegTranscoder
│   │   ├── Cli/                 # analyze, compatible, mix-plan, dj-set, key-eval
│   │   ├── DjSet/               # DjSetPlanner, BeamSearchDjSetPlanner
│   │   ├── Eval/                # KeyEvaluator, KeyProfileSweep
│   │   ├── Library/             # TrackLibrary (local), JellyfinLibrary (remote)
│   │   ├── Metadata/            # Id3TagExtractor, CoverArtCache, TrackMetadataCache, LibraryMetadataEnricher
│   │   ├── Mix/                 # MixTransition (drop / energy / tail-out / early-cut / bar-match)
│   │   ├── Provider/            # JellyfinClient (REST wrapper)
│   │   ├── Server/              # HeadbangbearApp + figtree routes (dispatching local ⇌ Jellyfin)
│   │   ├── Settings/            # SettingsStore (JSON persistence + singleton)
│   │   └── types/               # essentia.js.d.ts
│   └── tests/                   # mirror of src/ — vitest
├── frontend/                    # @headbangbear/frontend — bambooo / AdminLTE SPA
│   ├── src/
│   │   ├── inc/
│   │   │   ├── Api/             # LibraryApi, MixApi, DjSetApi, KeyLabelsApi, KeyProfileSweepApi, SettingsApi, TranscodeApi
│   │   │   ├── Net/             # NetFetch, Response, Errors
│   │   │   ├── Pages/           # Home, Library, DjSet, KeyLabels, Settings
│   │   │   ├── Util/            # CamelotUtil, HotCueStore, TrackDisplayUtil
│   │   │   ├── Widget/          # AutoPlayer, Deck, SetlistStore, TransitionStyleStore
│   │   │   └── PageLoader.ts
│   │   ├── langs/               # Lang_EN, Lang_DE
│   │   └── index.ts
│   ├── index.html               # AdminLTE shell, loads dist/index.js
│   ├── webpack.config.js
│   └── gulpfile.js              # copy-data + watch-webpack
├── doc/
│   ├── api.md
│   ├── audio/                   # logo.mp3 (intro jingle)
│   └── images/                  # logo.png
├── CHANGELOG.md
├── CLAUDE.md                    # repo instructions for Claude Code
└── README.md
```

---

## Installation

> **Important caveat:** a transitive dependency (`summernote`) has a `husky install` postinstall script that fails in fresh checkouts. Install with `--ignore-scripts` until that is resolved upstream.

Prerequisites:

- **Node.js ≥ 20**
- **`ffmpeg`** on `PATH` (for audio decoding + recording transcode)

```bash
git clone https://github.com/stefanwerfling/headbangbear.git
cd headbangbear
npm install --ignore-scripts
```

---

## Quick start

1. **Configure your library.** Copy `backend/config.example.json` to `backend/config.json` and set `library.rootDir` to a directory of `.mp3` files. (`samples/youtube/` is the conventional gitignored location.)

2. **Build the schemas workspace once** so backend + frontend can resolve shared types:

    ```bash
    npm run build -w @headbangbear/schemas
    ```

3. **Start backend + frontend in two terminals:**

    ```bash
    npm run dev -w @headbangbear/backend       # tsx watch — auto-reloading API server (HTTPS on the configured port)
    npm run dev -w @headbangbear/frontend      # gulp watch — incremental webpack bundle
    ```

4. **Open** `https://localhost:<httpserver.port>` and accept the self-signed cert. The first scan takes ~3 s per track via WASM; subsequent starts hit `<library>/.analysis-cache.json` and are instant.

### CLIs (no browser, no server)

```bash
# Analyse a single track
npm run analyze -w @headbangbear/backend -- /abs/path/to/song.mp3

# List harmonically-compatible tracks in the same directory
npm run compatible -w @headbangbear/backend -- /abs/path/to/song.mp3

# Plan a single A → B transition
npm run mix-plan -w @headbangbear/backend -- /abs/path/to/a.mp3 /abs/path/to/b.mp3

# Plan a full DJ set over a directory
npm run dj-set -w @headbangbear/backend -- /abs/path/to/library [up|down|either] [greedy|beam] [--shape=rising|arc|descending] [--target-min=N] [--style=drop-on-drop|tail-out|early-cut|bar-match]

# Score predicted keys against a hand-labelled truth file (or sweep multiple essentia profiles)
npm run key-eval -w @headbangbear/backend -- /abs/path/to/library /abs/path/to/truth.json [--json] [--sweep] [--profiles=bgate,temperley,...]
```

---

## Domain model — Camelot in 30 seconds

The Camelot wheel is a 24-slot map of keys arranged so that **harmonically compatible** moves are spatial neighbours:

- **Same slot** (e.g. `8A → 8A`): identical key.
- **Same number, opposite letter** (`8A ↔ 8B`): relative major/minor.
- **±1 number, same letter** (`8A ↔ 7A`, `8A ↔ 9A`): perfect-fifth move; `+1` is the typical "energy-up" move.

Anything else is harmonically dissonant and Headbangbear flags it as `incompatible`. See [`doc/api.md`](doc/api.md) for the full domain reference.

---

## Development

| Task | Command |
|---|---|
| Install deps | `npm install --ignore-scripts` |
| Typecheck all workspaces | `npm run typecheck` |
| Build all workspaces | `npm run build` |
| Lint everything | `npm run lint` |
| Format (write / check) | `npm run format` / `npm run format:check` |
| Run all backend tests | `npm test -w @headbangbear/backend` |
| Backend dev (tsx watch) | `npm run dev:backend` |
| Frontend dev (gulp watch) | `npm run dev:frontend` |

Tests are run with `vitest`. They use a deterministic `StubAudioAnalyzer` so the suite needs no real audio and runs in under two seconds.

---

## Status

Active personal project — not yet versioned for release. Backend domain, analysis pipeline, set planner, and HTTP API are stable and covered by tests; the frontend SPA covers the Library / DJ Set / Key Labels / Home pages end-to-end. See [CHANGELOG.md](CHANGELOG.md) for the per-iteration history.

---

## License

See [LICENSE](LICENSE).