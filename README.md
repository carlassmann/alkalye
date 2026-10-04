# Alkalye

A local-first Markdown PWA written in TypeScript, HTML and CSS. Effect 4 is the sole pinned runtime dependency, with no transitive dependencies. Bun supplies HTTP, WebSockets, SQLite, bundling and tests. The browser supplies Web Components, editing, IndexedDB, Web Crypto and offline caching.

## Run

```sh
bun install
bun run dev
```

Open http://127.0.0.1:3000/app. `PORT` and `HOST` configure the server. For an HTTPS proxy, set `PUBLIC_ORIGIN` and preserve the public Host header. Back up `.data/`, including `master.key`. Use the exact public origin for CLI connections.

```sh
bun run check
bun run build
bun run start
```

## One document architecture

The browser, CLI and MCP use the same document protocol. Each document has one event stream for source, comments, attachment references, drawings, themes and access changes. Opening downloads a current snapshot; older history loads on demand. Frontmatter owns document metadata. Sidebar entries cache its derived values.

Browser actions commit to an IndexedDB journal before publication. CLI actions use the same Effect EventLog and document session with a Bun SQLite journal. Cached documents open offline, pending actions survive restarts, and synchronization publishes them after reconnecting. Text uses an operation-based CRDT. Whole-document undo records compensating actions and preserves other writers’ changes.

The server stores accepted document actions and materialized snapshots in SQLite. WebSockets announce changes and carry cursors, presentation positions and laser pointers. Workspace owner/writer/reader roles inherit into documents; owners can add document-specific grants. Agents operate under current account permissions and a scoped role ceiling.

The default `/app` runs the document controller. Addresses are ordinary paths, as in the original: `/app/doc/<id>` with optional `/preview`, `/slideshow`, `/teleprompter` or `/timemachine`, `/app/spaces/<workspace>` and `/app/spaces/<workspace>/doc/<id>`, `/app/spaces/<workspace>/settings`, and `/app/settings?category=general|editor|connections|app`. The server and service worker answer every `/app/…` path with the same shell, so deep links reload and reopen offline; `src/shared/routes.ts` parses and builds them, and older `/app#<id>` links are rewritten once. Invitation links keep their secret in the fragment, `/invite#…`, so it never reaches a server log. `/app/native` is an alias to the same bundle. The former room REST and WebSocket protocols return `410 Gone`; their implementation has been removed. Existing database files remain untouched. This rewrite does not automatically migrate Jazz or the earlier rewrite’s room data.

The app supports Markdown editing and preview, comments, attachments, drawings, custom document themes, slideshow, teleprompter, presenter following, history, document copying, workspace permissions and offline reopening. Settings is a page with the original's General, Editor, Connections and App & data categories; it exposes the account ID and recovery key and restores an account on another device. The library's workspace menu switches workspaces and creates them; the gear beside it opens the workspace's settings for its name, members and invitation links. The interface follows the original application's layout, Geist type and icons, in light and dark appearances.

Documents and workspaces export to ZIP with attachments, editable whiteboards, themes, comments and links, and import back without replaying history. Owners share by writer or reader invitation links, which they can revoke, or by public read links. Folders on the device open as workspaces: Markdown files edit in the same editor and save back to disk, merging changes made by other programs. Delete moves a document to the trash, owners can move documents between workspaces and collaborators can leave them. The tools panel adds a document outline, backlinks, save as, share a copy and turning a document into a presentation. See [docs/portability-sharing-and-folders.md](docs/portability-sharing-and-folders.md). The document log is not end-to-end encrypted.

## Agents

Settings → Connections (`/app/settings?category=connections`) shows the MCP URL, OAuth consent requests and connected clients. Connections choose workspace scope and a reader/writer/owner ceiling. `/mcp` exposes eleven document, comment and workspace tools with revision checks. OAuth discovery, public client registration, consent and S256 PKCE are built in.

```sh
ALKALYE_SERVER=http://127.0.0.1:3000 ALKALYE_MCP_TOKEN=... bun cli.ts mcp
```

## CLI

```sh
bun cli.ts --help
bun cli.ts auth signup --name Carl
bun cli.ts auth login --passphrase-stdin < recovery-key.txt
bun cli.ts doc create --title Notes --file notes.md --sync
bun cli.ts doc list
bun cli.ts doc update DOCUMENT_ID --file notes.md
bun cli.ts doc undo DOCUMENT_ID
bun cli.ts doc history DOCUMENT_ID
bun cli.ts sync
```

Profiles and document journals live in `~/.config/alkalye-native`. `--home` selects another directory; `--server` selects an origin. Datasets are isolated by origin and account. Local edits survive unavailable servers. `--sync` requires successful publication; a failed creation still prints its saved document ID. Use `--content=VALUE` when the value starts with a hyphen. CLI commands cover authentication, document reading/writing, archive/restore, undo/redo, history, synchronization and the MCP stdio proxy.

## Verification

`bun run check` checks dependencies, Effect boundaries, types, formatting and Bun tests. Tests cover CRDT convergence, journal recovery, cancellation, permissions, whole-document history, agent scope and real CLI subprocesses. Four concurrent frontmatter cases remain explicitly marked as TODOs.

```sh
bun run test:e2e
```

Browser tests use background `agent-browser` sessions against real Bun servers. They exercise IndexedDB, offline reload and publication, collaboration, comments, assets, drawings, themes, workspaces, presentations, MCP and OAuth. Browser tests must run sequentially because they build into the same directory.

The original app remains available in Git at `a749728`. Its known differences are listed in [docs/portability-sharing-and-folders.md](docs/portability-sharing-and-folders.md). Run `bun run ci` after the final PR push for the required exact-commit signoff; never push directly to `main`.

written with GPT-6 in Codex
written with claude-opus-5-5 in Claude Code
