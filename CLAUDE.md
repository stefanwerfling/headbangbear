# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Goal

**Headbangbear (HBB)** is a TypeScript application for **music analysis with Harmonic Mixing** support — analyzing audio files to extract musical key, BPM, and energy, then surfacing key-compatible tracks (Camelot wheel / Open Key notation) so tracks can be mixed harmonically like a DJ would.

## Status

Repo is **bootstrapped** as a TypeScript monorepo (npm workspaces) with toolchain in place; no application code yet. Both workspaces have only placeholder `index.ts` entrypoints. Routes, services, data model, audio analysis pipeline, and UI are all unwritten.

## Repo Layout

```
.
├── backend/          # @headbangbear/backend — figtree-based API
│   ├── src/index.ts
│   └── tsconfig.json
├── frontend/         # @headbangbear/frontend — bambooo / AdminLTE UI
│   ├── src/index.ts
│   └── tsconfig.json
├── tsconfig.base.json    # shared compiler options (strict, decorators on)
├── eslint.config.mjs     # flat config, typescript-eslint recommended
├── .prettierrc.json
└── package.json          # workspace root
```

## Tech Stack

- **Language:** TypeScript (backend + frontend)
- **Backend framework:** [figtree](https://github.com/stefanwerfling/figtree/tree/claude) (`claude` branch) — Node.js/TypeScript backend framework. App is built by extending `BackendApp`, implementing `_initServices()` to register services (e.g. `HttpService`, `MariaDBService`), and subclassing `DefaultRoute` for endpoints. Configuration is schema-validated JSON. TypeORM, Redis, sessions, Swagger, and clustering are built in.
- **Frontend framework:** [bambooo](https://github.com/stefanwerfling/bambooo) — AdminLTE-based TypeScript framework for admin dashboards. Peer deps: `admin-lte`, `ionicons-css`, `jQuery`.

Both frameworks are installed directly from Git (already wired into the respective workspace `package.json`):

- `figtree` → `git+https://github.com/stefanwerfling/figtree.git#claude` (in `backend/`)
- `bambooo` → `git+https://github.com/stefanwerfling/bambooo.git` (in `frontend/`)

**Important install caveat:** A transitive dep (`summernote`) has a postinstall that calls `husky install`, which fails in fresh checkouts. Always install with `npm install --ignore-scripts` until that is resolved upstream.

## Architectural Notes for Future Work

When wiring up the backend, expect a layout split along figtree's contract: a `BackendApp` subclass as the entry point, a `config.json` matching a declared schema, route classes per domain area (e.g. `tracks`, `analysis`, `library`), and service registrations in `_initServices()`. The frontend will be a separate workspace consuming the backend's HTTP API via bambooo pages/components.

Domain concepts to keep in mind for any music-analysis code:

- **Key detection** → output in both standard notation (e.g. `A minor`) and Camelot (`8A`) / Open Key. Harmonic compatibility rules are derived from the Camelot wheel (same number, ±1 number, or A↔B switch at the same number).
- **BPM detection** → tempo, plus half/double-time disambiguation.
- **Energy / loudness** → for selecting transition candidates within a mix flow.
- Audio decoding/analysis is CPU-heavy — design it as a background job (figtree supports clustering) rather than inline in HTTP handlers.

## Commands

Run from repo root unless noted otherwise:

| Task | Command |
|------|---------|
| Install deps | `npm install --ignore-scripts` (see caveat above) |
| Typecheck both workspaces | `npm run typecheck` |
| Build both workspaces | `npm run build` |
| Lint everything | `npm run lint` |
| Format (write) | `npm run format` |
| Format (check only) | `npm run format:check` |
| Backend dev (tsx watch) | `npm run dev:backend` |
| Frontend dev (tsc --watch) | `npm run dev:frontend` |
| Run a single workspace script | `npm run <script> -w @headbangbear/backend` (or `@headbangbear/frontend`) |

A test runner is **not yet wired up** — `npm test` currently echoes "no tests yet" in each workspace. Pick and configure one (vitest is a natural fit) when the first real code lands.

## Conventions

- **TypeScript is strict + extra-strict:** `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch` are all on at the base level. Decorators are enabled (`experimentalDecorators` + `emitDecoratorMetadata`) because figtree routes and TypeORM entities need them.
- **Prettier:** 4-space indent, single quotes, trailing commas, 100-char width, LF line endings. Match this in any new file.
- **Module systems differ between workspaces:** backend uses `Node16` modules (CommonJS-friendly); frontend uses `ESNext` + `Bundler` resolution because it'll be browser-bundled later. Don't unify them blindly.