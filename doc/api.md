# Headbangbear backend API

Reference for the public surface of the `@headbangbear/backend` workspace. Every type listed here is exported from the path given in its heading. Schemas are defined with [`vts`](https://github.com/OpenSourcePKG/vts) and act as the single source of truth — TypeScript types are derived from them via `ExtractSchemaResultType`.

> All file paths in this document are relative to `backend/src/` unless stated otherwise.

---

## Contents

1. [Domain types](#domain-types)
2. [Camelot wheel — `Analysis/Camelot.ts`](#camelot-wheel--analysiscamelotts)
3. [Open Key — `Analysis/OpenKey.ts`](#open-key--analysisopenkeyts)
4. [Audio analysis](#audio-analysis)
5. [Library — `Library/TrackLibrary.ts`](#library--librarytracklibraryts)
6. [Mix transitions — `Mix/MixTransition.ts`](#mix-transitions--mixmixtransitionts)
7. [DJ-set planner — `DjSet/DjSetPlanner.ts`](#dj-set-planner--djsetdjsetplannerts)
8. [HTTP API](#http-api)
9. [CLIs](#clis)

---

## Domain types

Defined in `Analysis/schemas.ts`.

| Schema | Type | Shape |
|---|---|---|
| `KeyModeSchema` | `KeyMode` | `'major' \| 'minor'` |
| `PitchClassSchema` | `PitchClass` | One of `C, C#, D, D#, E, F, F#, G, G#, A, A#, B` |
| `MusicalKeySchema` | `MusicalKey` | `{ tonic: PitchClass; mode: KeyMode }` |
| `AnalysisResultSchema` | `AnalysisResult` | In-memory analysis output (full domain instances). |
| `SerializedAnalysisResultSchema` | `SerializedAnalysisResult` | JSON / cache form (Camelot + OpenKey as strings). |

### `AnalysisResult`

```ts
{
    key: MusicalKey;
    camelot: Camelot;       // class instance
    openKey: OpenKey;       // class instance
    bpm: number;            // global tempo
    energy: number;         // average RMS over the whole track
    durationSec: number;
    beats: number[];        // beat positions in seconds (RhythmExtractor2013.ticks)
    energyTimeline: number[]; // RMS per ENERGY_WINDOW_SEC window (default 1 s)
    drops: number[];        // detected drop timestamps in seconds
}
```

`SerializedAnalysisResult` has the same shape but with `camelot` and `openKey` as canonical strings (`"8A"`, `"1m"`).

### `ENERGY_WINDOW_SEC`

```ts
export const ENERGY_WINDOW_SEC: number = 1;
```

Width of one bucket in `energyTimeline`. Each entry is the RMS over that window.

---

## Camelot wheel — `Analysis/Camelot.ts`

```ts
class Camelot {
    readonly number: CamelotNumber;  // 1..12
    readonly letter: CamelotLetter;  // 'A' | 'B'

    constructor(number: CamelotNumber, letter: CamelotLetter);

    static fromKey(key: MusicalKey): Camelot;
    static fromString(input: string): Camelot | null;

    toKey(): MusicalKey;
    toString(): string;            // e.g. "8A"

    equals(other: Camelot): boolean;

    next(): Camelot;               // +1 number, same letter (wraps 12 → 1)
    prev(): Camelot;               // -1 number, same letter
    switch(): Camelot;             // same number, opposite letter

    isCompatibleWith(other: Camelot): boolean;
    compatibleKeys(): Camelot[];   // [self, switch, next, prev]
}

type CamelotNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
type CamelotLetter = 'A' | 'B';
```

### Compatibility rule

`a.isCompatibleWith(b)` is `true` when one of the following holds:

1. `a.equals(b)` — identical key.
2. `a.number === b.number` — relative major/minor switch (`8A ↔ 8B`).
3. `a.letter === b.letter` and `b.number` is `a.next().number` or `a.prev().number` — perfect-fifth move on the same letter row.

Anything else is incompatible.

### Wheel reference

| # | A (minor) | B (major) |
|---:|---|---|
| 1 | G♯m | B |
| 2 | D♯m | F♯ |
| 3 | A♯m | C♯ |
| 4 | Fm | G♯ |
| 5 | Cm | D♯ |
| 6 | Gm | A♯ |
| 7 | Dm | F |
| 8 | Am | C |
| 9 | Em | G |
| 10 | Bm | D |
| 11 | F♯m | A |
| 12 | C♯m | E |

---

## Open Key — `Analysis/OpenKey.ts`

The Mixed-In-Key notation: `8A` ↔ `1m`, `8B` ↔ `1d`. Provided for interoperability with tools that prefer Open Key labels.

```ts
class OpenKey {
    readonly number: number;       // 1..12
    readonly mode: OpenKeyMode;    // 'm' | 'd'

    constructor(number: number, mode: OpenKeyMode);

    static fromCamelot(c: Camelot): OpenKey;
    static fromString(input: string): OpenKey | null;

    toCamelot(): Camelot;
    toString(): string;            // e.g. "1m"
}

type OpenKeyMode = 'm' | 'd';
```

---

## Audio analysis

### `AudioAnalyzer` (abstract) — `Analysis/AudioAnalyzer.ts`

```ts
abstract class AudioAnalyzer {
    abstract analyze(filePath: string): Promise<AnalysisResult>;
}
```

Contract for any backend that decodes a file and returns an `AnalysisResult`. Two implementations ship:

### `EssentiaAudioAnalyzer` — `Analysis/EssentiaAudioAnalyzer.ts`

Production analyzer.

- Decodes `filePath` via [`FfmpegDecoder`](#ffmpegdecoder--audioffmpegdecoderts) (mono f32le PCM @ 44.1 kHz).
- Loads `essentia.js` (WASM) lazily, awaiting `Module.onRuntimeInitialized` once per process.
- Runs `KeyExtractor` (key + mode), `RhythmExtractor2013` (BPM + beat ticks), and `RMS` (per-window energy).
- Computes per-second `energyTimeline` from a windowed RMS pass.
- Calls `DropDetector.detect()` with the timeline to populate `drops`.

### `StubAudioAnalyzer` — `Analysis/StubAudioAnalyzer.ts`

Deterministic stub for tests. Constructor accepts `key`, `bpm`, `energy`, `durationSec`, `drops` overrides; generates plausible synthetic `beats` and `energyTimeline` from those inputs.

### `DropDetector` — `Analysis/DropDetector.ts`

```ts
class DropDetector {
    constructor(
        lowRatio: number = 0.3,
        highRatio: number = 0.65,
        lookbackSec: number = 6,
        minSpacingSec: number = 16,
    );

    detect(energyTimeline: readonly number[], windowSec: number = 1): number[];
}
```

Heuristic: index `i` is a drop when

- `timeline[i] ≥ max × highRatio`, **and**
- some sample within `[i - lookbackSec, i)` was `≤ max × lowRatio`, **and**
- the previous reported drop was at least `minSpacingSec` ago.

Returns drop timestamps in seconds, rounded to one decimal. Continuous-energy material (classical, ambient) yields no drops; transient false positives can occur on dynamic classical pieces.

### `FfmpegDecoder` — `Audio/FfmpegDecoder.ts`

Spawns `ffmpeg` and decodes audio to a `Float32Array` of mono samples at 44.1 kHz from stdout. `ffmpeg` must be on `PATH`.

---

## Library — `Library/TrackLibrary.ts`

```ts
interface AnalyzedTrack {
    readonly path: string;
    readonly result: AnalysisResult;
}

type ProgressFn = (filePath: string) => void;

class TrackLibrary {
    constructor(analyzer: AudioAnalyzer, cachePath: string, onProgress?: ProgressFn);

    scan(dir: string): Promise<AnalyzedTrack[]>;
    tracks(): AnalyzedTrack[];
    findByPath(path: string): AnalyzedTrack | null;
    compatible(track: AnalyzedTrack): AnalyzedTrack[];
}
```

### `scan(dir)`

- Lists every `*.mp3` in `dir` (non-recursive, sorted alphabetically).
- For each file: looks up the cache by absolute path; if `mtime` and `size` match, deserialises the cached `AnalysisResult`. Otherwise calls `analyzer.analyze(file)` (and `onProgress(file)` first, if provided).
- Writes the merged set back to `cachePath` as JSON.
- Returns the in-memory list and populates `tracksByPath`.

### Cache format

`cachePath` is JSON of the form `{ version: number, entries: CachedTrack[] }`. **Cache version is currently 3.** A version mismatch or a schema-validation failure invalidates the entire cache and triggers a full re-analysis on the next `scan()`. `vts` validation is what makes that boundary safe.

### `compatible(track)`

Filters the loaded library to tracks whose Camelot code is in `track.result.camelot.compatibleKeys()`, excludes `track` itself, and sorts the result by ascending `|bpm − target.bpm|`.

---

## Mix transitions — `Mix/MixTransition.ts`

Plans a single A → B crossfade.

### Schemas / types

```ts
type KeyMatch = 'identical' | 'relative' | 'energy-up' | 'energy-down' | 'incompatible';
type Alignment = 'drop' | 'energy';

const TransitionPlanSchema: Vts.Schema<TransitionPlan>;

interface TransitionPlan {
    from: {
        path: string;
        camelot: string;
        bpm: number;
        durationSec: number;
        drops: number[];
    };
    to: {
        path: string;
        camelot: string;
        originalBpm: number;
        pitchPercent: number;
        resultingBpm: number;
        drops: number[];
    };
    cueOutSec: number;       // second-mark in A where the crossfade starts
    cueInSec: number;        // second-mark in B (B's original-tempo clock) where playback starts
    mixDurationSec: number;  // wall-clock length of the crossfade
    mixBars: number;         // mixDurationSec expressed in bars at fromBpm
    keyMatch: KeyMatch;
    alignment: Alignment;
    notes: string[];
}
```

### Class

```ts
class MixTransition {
    constructor(from: AnalyzedTrack, to: AnalyzedTrack);
    plan(): TransitionPlan;
}
```

### Strategy dispatch in `plan()`

`plan()` first attempts the **drop-aligned** strategy and falls back to the **energy-aligned** strategy if the former is not feasible.

#### 1. Drop-aligned (preferred)

Used when both tracks have at least one detected drop.

- Picks A's last drop `aLastDrop` and B's first drop `bFirstDrop`.
- Targets a 16-bar lead-in at `fromBpm` (floor 8 bars).
- Computes the wall-time runway available before each drop:
    - A advances at 1× → available wall time before its drop is `aLastDrop`.
    - B advances at `pitchRatio = fromBpm / toBpm` → available wall time before its drop is `bFirstDrop / pitchRatio`.
- Lead-in is the minimum of (target, A-runway, B-runway), rounded down to the bar grid.
- `cueOutSec = snapToBar(A.beats, aLastDrop − leadInWall)`.
- `cueInSec = snapToBar(B.beats, bFirstDrop − effectiveLeadInWall × pitchRatio)`.
- Returns `null` (forcing fallback) when the maximum feasible lead-in is below the 8-bar floor.

Note added to `notes[]`: e.g. `Drop-aligned: A's drop @180.0s ↔ B's drop @30.0s, 16.0-bar lead-in.`

#### 2. Energy-aligned (fallback)

Used when drop alignment is unavailable.

- `aLastLoud` = last second in `A.energyTimeline` whose RMS is `≥ max × 0.55`.
- `bFirstLoud` = first second in `B.energyTimeline` whose RMS is `≥ max × 0.55`.
- Mix length = `min(targetBars, A's available outro, B's available intro)`, floored at 8 bars.
- A's mix-out ends at `aLastLoud`; bar-snapped cue-out is `aLastLoud − mixDurationSec`.
- B's cue-in is `B.beats[0]`, bar-snapped.

### `keyMatch` classification

| Value | Condition |
|---|---|
| `identical` | A and B share the same Camelot code. |
| `relative` | Same number, opposite letter (`8A ↔ 8B`). |
| `energy-up` | Same letter, B is `A.next()`. |
| `energy-down` | Same letter, B is `A.prev()`. |
| `incompatible` | None of the above. |

### Notes

`notes[]` may include any of:

- Pitch-shift warning above ±6 %.
- `Keys X → Y are not Camelot-compatible.` for `incompatible`.
- `Drop-aligned: ...` and an optional `Lead-in shortened ...` (drop strategy).
- `Track B has no detectable low-energy intro ...`, `Track A has no detectable energetic body ...`, `Mix shortened to N bars ...` (energy strategy).

---

## DJ-set planner — `DjSet/DjSetPlanner.ts`

Plans a Camelot-compatible chain over a track pool. Two strategies are available:

- **`'greedy'`** (default): myopic, picks the next-best candidate per step.
- **`'beam'`**: keeps the top-K partial chains per expansion step (see [`BeamSearchDjSetPlanner`](#beam-search--djsetbeamsearchdjsetplannerts)).

### Schemas / types

```ts
type EnergyDirection = 'up' | 'down' | 'either';
type DjSetStrategy = 'greedy' | 'beam';

interface DjSetTrack {
    path: string;
    camelot: string;
    bpm: number;
    energy: number;
    durationSec: number;
}

interface DjSet {
    tracks: DjSetTrack[];          // ordered chain
    transitions: TransitionPlan[]; // length = tracks.length − 1
    skipped: DjSetTrack[];         // tracks the planner could not reach
    energyDirection: EnergyDirection;
}

interface DjSetPlannerOptions {
    start?: AnalyzedTrack;
    energyDirection?: EnergyDirection;  // default 'up'
    strategy?: DjSetStrategy;            // default 'greedy'
    beamWidth?: number;                  // default 8 (only used when strategy === 'beam')
    tryAllStarts?: boolean;              // default true; only used when strategy === 'beam'
}
```

### Class

```ts
class DjSetPlanner {
    constructor(tracks: readonly AnalyzedTrack[]);
    plan(options?: DjSetPlannerOptions): DjSet;
}
```

When `strategy === 'beam'`, planning is delegated to `BeamSearchDjSetPlanner` with the same `start`, `energyDirection`, `beamWidth`, and `tryAllStarts` options.

### Greedy algorithm

1. **Pick the start.** If `options.start` is given (and is in the pool) it's used as-is. Otherwise the lowest-energy track is picked (highest for `'down'`).
2. **Greedy loop.** While there are remaining tracks, look at the current end of the chain:
    - Filter unused tracks to those whose Camelot is compatible with the current track.
    - Sort by primary key (direction-respecting energy delta) then secondary key (BPM delta).
    - Pick the best, append it, append its `MixTransition` plan to `transitions`.
    - If no compatible candidate exists, stop.
3. **Skipped.** Whatever remains in the pool when the loop terminates is returned in `skipped`.

#### Direction score

```
deltaE = candidate.energy - current.energy

direction === 'up'    → score = deltaE < 0 ? |deltaE| + 1000 : |deltaE|
direction === 'down'  → score = deltaE > 0 ? |deltaE| + 1000 : |deltaE|
direction === 'either'→ score = |deltaE|
```

The penalty (`1000`) is large enough that a wrong-direction candidate is only chosen when no right-direction candidate exists. Within the same bucket, ties are broken by `|candidate.bpm − current.bpm|`.

---

## Beam search — `DjSet/BeamSearchDjSetPlanner.ts`

```ts
interface BeamSearchOptions {
    start?: AnalyzedTrack;
    energyDirection?: EnergyDirection;
    beamWidth?: number;       // default 8
    tryAllStarts?: boolean;   // default true
}

class BeamSearchDjSetPlanner {
    constructor(tracks: readonly AnalyzedTrack[]);
    plan(options?: BeamSearchOptions): DjSet;
}
```

### Algorithm

1. **Pick the starts.**
    - If `options.start` is set (and is in the pool), only that track is used — `tryAllStarts` is ignored.
    - Otherwise, if `tryAllStarts` is `true` (default), every track in the pool is used as a separate start. The transition cache is shared across all starts so the total work is bounded by `N²` transitions.
    - Otherwise, only the lowest-energy track is used (highest for `'down'`).
2. **For each start**, run the beam:
    1. Initialise the beam with one state — the chain `[start]`.
    2. At each step, every state in the beam is extended to all Camelot-compatible successors in `state.remaining`. States that cannot be extended are kept unchanged. The combined expansion is sorted by lexicographic score and truncated to `beamWidth`.
    3. Terminate when no state in the beam could be extended.
3. **Return** the lex-best state across all starts.

### Lex score (lower wins)

| Key | Direction | Meaning |
|---|---|---|
| 1 | `−ordered.length` | Longer chains always win. |
| 2 | `sumPitchAbs` | Among equal-length chains, prefer the one with the lowest total `\|pitchPercent\|` across transitions. |
| 3 | `−dropAligned` | Among equal-length and equal-pitch chains, prefer the one with more drop-aligned transitions. |

`sumPitchAbs` and `dropAligned` accumulate per transition as it's added to a state, using the same `MixTransition.plan()` that ends up in the output `transitions[]`.

### Performance

`MixTransition.plan()` is memoised per `(from.path, to.path)` pair. With `N` tracks, at most `N²` transitions are computed across the entire search, regardless of `beamWidth`.

### Multi-start vs single-start

With `tryAllStarts: true` (default), beam search avoids the disconnected-Camelot-cluster trap by trying every track as a starting point and returning the lex-best chain. On the project's sample library this lifts the chain length from 2 (single start, stuck in the Chopin → Commodores cluster) to 5 (multi-start, full 8A cluster + neighbours).

Multi-start adds a constant factor over single-start (`N` extra beam runs) but reuses the transition cache, so the total `MixTransition.plan()` work is still bounded by `N²` and finishes well under a second for typical libraries (≤100 tracks). For very large pools, set `tryAllStarts: false` (CLI: `--single-start`) to fall back to the cheaper auto-pick.

---

## HTTP API

Implemented in `backend/src/Server/`. Run with `npm run dev -w @headbangbear/backend` (or `npm run start` after `npm run build`). The server reads `backend/config.json` (see `backend/config.example.json`) and uses figtree's defaults — including HTTPS with a self-signed in-memory certificate when no `httpserver.sslpath` is configured.

### Bootstrap

`HeadbangbearApp` (`Server/HeadbangbearApp.ts`) extends figtree's `BackendApp`, registers `LibraryService` (depends on `library.rootDir`) and `HttpService` (depends on the library service so routes always see a populated library). `HbbConfigBackend` extends `ConfigBackend` with our `library` block and registers itself as the global `Config` singleton on `install()` so figtree's other components see the loaded config.

### Endpoints

All endpoints live under `/api/v1/`. Request and response bodies are validated via the existing vts schemas — the same ones used internally by `MixTransition` and `DjSetPlanner`.

| Method | Path                                          | Body / Query                       | Response               |
| ------ | --------------------------------------------- | ---------------------------------- | ---------------------- |
| GET    | `/api/v1/library/list`                        | —                                  | `LibraryResponse`      |
| GET    | `/api/v1/library/audio?path=<abs-path>`       | `path` query                       | `audio/mpeg` (range)   |
| GET    | `/api/v1/tracks/compatible?path=<abs-path>`   | `path` query                       | `CompatibleResponse`   |
| POST   | `/api/v1/mix/plan`                            | `MixPlanBody` (`fromPath`,`toPath`)| `TransitionPlan`       |
| POST   | `/api/v1/dj-set/plan`                         | `DjSetBody`                        | `DjSet`                |

#### Audio streaming

`GET /api/v1/library/audio?path=<abs-path>` streams the mp3 for the requested track with full HTTP Range support (`Accept-Ranges: bytes`; `206 Partial Content` for ranged requests). The frontend's `wavesurfer.js` decks consume this directly. The path is validated against the loaded library before reading — arbitrary file paths return `404`.

#### `LibraryResponse`

```ts
{
    libraryDir: string;
    tracks: Array<{
        path: string;
        camelot: string;     // e.g. "8A"
        openKey: string;     // e.g. "1m"
        bpm: number;
        energy: number;
        durationSec: number;
        drops: number[];
    }>;
}
```

#### `CompatibleResponse`

```ts
{
    track: RouteTrack;          // the input track
    matches: Array<RouteTrack & { bpmDelta: number }>; // sorted ascending by |bpmDelta|
}
```

#### `MixPlanBody` → `TransitionPlan`

Request: `{ fromPath: string, toPath: string }`. Both paths must be members of the loaded library. Response is the `TransitionPlan` shape documented in [Mix transitions](#mix-transitions--mixmixtransitionts).

#### `DjSetBody` → `DjSet`

```ts
{
    energyDirection?: 'up' | 'down' | 'either';   // default 'up'
    strategy?: 'greedy' | 'beam';                  // default 'greedy'
    beamWidth?: number;                            // default 8 (only used when strategy === 'beam')
    tryAllStarts?: boolean;                        // default true (only used when strategy === 'beam')
    startPath?: string;                            // optional; resolved against the library
}
```

Response is the `DjSet` shape documented in [DJ-set planner](#dj-set-planner--djsetdjsetplannerts), including every per-pair `TransitionPlan`.

### Notes

- The library is scanned + cached **once** on server startup. To pick up new files, restart the server (or call `library.scan(rootDir)` from a service action — not yet exposed as an endpoint).
- `EssentiaAudioAnalyzer` is loaded lazily via `LazyEssentiaAnalyzer` (`Server/LazyEssentiaAnalyzer.ts`). The essentia.js module installs a global `process.on('unhandledRejection', abort)` handler at import time that conflicts with figtree's lifecycle — the wrapper defers that import until the first cache miss.
- HTTPS-by-default (self-signed) means `curl` needs `-k` for local testing.

---

## CLIs

All CLIs live under `src/Cli/`. They use `EssentiaAudioAnalyzer` and write the per-library cache to `<library-dir>/.analysis-cache.json`. The first analysis pass is slow (~30 s/track via WASM); subsequent runs are instant.

| Script | Module | Usage |
|---|---|---|
| `analyze` | `Cli/Analyze.ts` | `npm run analyze -w @headbangbear/backend -- <abs-path-to-mp3>` |
| `compatible` | `Cli/Compatible.ts` | `npm run compatible -w @headbangbear/backend -- <abs-path-to-mp3>` |
| `mix-plan` | `Cli/MixPlan.ts` | `npm run mix-plan -w @headbangbear/backend -- <from-mp3> <to-mp3>` |
| `dj-set` | `Cli/DjSet.ts` | `npm run dj-set -w @headbangbear/backend -- <library-dir> [direction] [strategy] [--beam-width=N] [--single-start]` |

### `analyze`

Decodes and analyses one MP3, prints `key`, `camelot`, `openKey`, `bpm`, `energy`, `durationSec`, and `drops` as JSON.

### `compatible`

Scans the parent directory of the supplied track, then prints every track in the library whose Camelot is compatible with the input — sorted ascending by `|bpm − target.bpm|`. Output includes a `bpmDelta` field per match.

### `mix-plan`

Both arguments must live in the same directory (the planner re-uses that directory's `.analysis-cache.json`). Emits a complete `TransitionPlan` as JSON.

### `dj-set`

Scans the supplied directory and runs `DjSetPlanner` over the result. Emits a complete `DjSet` as JSON, including every per-pair `TransitionPlan`.

| Positional  | Values                  | Default  |
| ----------- | ----------------------- | -------- |
| `direction` | `up`, `down`, `either`  | `up`     |
| `strategy`  | `greedy`, `beam`        | `greedy` |

`--beam-width=N` overrides the beam search width (default `8`). `--single-start` opts out of multi-start beam search (default behaviour is to try every track as a start). Both flags are silently ignored when `strategy` is `greedy`. The CLI does not currently expose the `start` override.