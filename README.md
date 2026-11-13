# Alkalye

Offline-capable markdown editor with real-time collaboration and presentation mode.

**[alkalye.com](https://alkalye.com)**

## Features

- **Server-readable sync** — Alkalye’s backend and Jazz Cloud can read synced data
- **Real-time Collaboration** — Share documents and edit together with live cursors
- **Presentation Mode** — Turn markdown into slideshows with `mode: present` frontmatter
- **Teleprompter Mode** — Present with auto-scrolling text
- **Offline-First** — Works without internet, syncs when back online (PWA)
- **Focus Mode** — Distraction-free writing environment
- **Media Assets** — Upload and embed images and videos in your documents
- **HTML/CSS Themes** — Custom document themes with HTML templates and CSS styling
- **PDF Export** — Export documents as formatted PDFs
- **Time Machine** — Browse document history and restore previous versions
- **Portable** — Settings stored in frontmatter, export as standard `.md` files anytime

## Tech Stack

- [Jazz](https://jazz.tools) for local-first sync
- [Astro](https://astro.build) 5 + React 19
- [Tanstack Router](https://tanstack.com/router) for routing
- Tailwind CSS 4 + shadcn/ui (base-lyra style)
- CodeMirror 6 editor

## Development

Requires [Bun](https://bun.sh). Starting your dev environment is as easy as:

```bash
bun install

cp .env.example .env

bunx jazz-sync run # start sync server

bun run dev
```

## Theme authoring

See the [theme authoring guide](public/docs/theming-guide.md) for Markdown theme sources, CSS/HTML hooks, light/dark styling, and a prompt to give your agent.

## CLI

```bash
bun link
alkalye --help
```

## Contributing

Contributions welcome! Please open an issue or PR.

`main` is protected: no direct pushes, and pull requests land as squash merges.

Every pull request adds exactly one entry at the top of
[`public/changelog.json`](public/changelog.json) describing what changed for
readers, carrying the next `id` and `"pr": <number>` so the entry links back to
it. Readers remember the highest `id` they have seen, so a published entry can
be reworded, reordered or removed afterwards without replaying old notes for
anyone — just never reuse an `id`. The entries render at
[alkalye.com/changelog](https://www.alkalye.com/changelog) and drive the
in-app update prompt.

## Local CI

Pull requests require a local CI signoff on their latest commit. Install the
pinned signoff extension once:

```bash
gh extension install basecamp/gh-signoff --pin v0.4.1
```

Push your commit, then run:

```bash
bun run ci
```

The command checks the changelog entry, installs dependencies, runs static
checks, types and unit tests, the production build, and the end-to-end suite
against the local `work` services. It signs off only when `HEAD` and the
working tree still match the state that was tested. The complete run has a
15-minute timeout. Every new commit requires another run. Do not call
`gh signoff` directly.

Set `CI_BASE_URL` to test against an already-running server instead of
restarting the `work` services.

## License

[MIT](./LICENSE)

© 2025 Carl Assmann

## Jazz benchmarks

Fetch checksum-pinned datasets, start this checkout's services, then run headless Chromium.
Install Chromium once with `bunx playwright install chromium` if needed:

```sh
bun run bench:fetch
bun scripts/bench/production.ts
bun scripts/bench/interleaved.ts
```

Run from the migration checkout. The provisioner builds Classic `8379d4e` in a
temporary worktree with the Node adapter and an external SPA history fallback;
app source stays unchanged. It builds v2 with `ALKALYE_LOCAL_PREVIEW=1` and
isolated SQLite. Work setup/start use `--tailscale`. This setup uses the local
cshed tailnet domain and a 32 GB Classic sync-server heap cap.

The runner alternates five Classic/v2 core pairs, then five separate pairs for
service-worker reload and offline reopening. Backends restart before each
account. Raw results retain load averages, exact-content checks and scenario
failures. Failures produce exit code 1; independent cases still run.
No fixed performance threshold runs in CI.

`bun run bench:verify-network` checks worker HTTP, binary WebSocket and Wasm
capture. For individual runs use `bun run bench:compare -- --target <url>
--label classic|v2 --out <path>`. Set `BENCH_JAZZ`, `BENCH_GIT_HEAD` and
`BENCH_SERVER_NOTE` when the served app differs from the harness checkout.
Set `BENCH_SERVER_MODE=development` for a dev-only diagnostic.

Defaults: three accounts, 50 Vite Markdown notes, two Gutenberg books and 200
Automerge trace edits per document. Use `--cpu 4` for page CPU throttling or
`--notes 20 --edits 50` for a smoke run. The full 259,778-edit trace exceeds two
hours at the frame-pacing floor alone. `--edits 5000 --large-only --literal-newlines` runs a longer
large-document slice; `--replay-timeout-ms <ms>` sets its deadline.
The literal-newline option uses plain-text paste for trace line breaks, avoiding
contenteditable newline normalization during cursor-heavy replay.
`BENCH_PROFILE_DIR` captures main-page CPU profiles. `--sw-only` measures a
hydrated returning user; `--skip-sw` excludes that case for diagnostics.

Only `scripts/bench/adapter.ts` binds account, import/export and editor UI.
Scenarios never call Jazz APIs. Credentials stay in memory and out of results.
Fresh contexts receive Classic's auth secret or v2's selected device root,
without document databases, cookies, other account roots or session leases.
See `docs/benchmarks/jazz-classic-vs-v2.md` for measurement definitions and limitations.

written with gpt-6.1-sol in T3 Code (Codex)
