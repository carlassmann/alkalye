# Alkalye

A local-first Markdown PWA written in TypeScript, HTML and CSS. Effect 4 powers the application with no transitive dependencies. The whiteboard uses a lazy tldraw island with React and React DOM; those are the only runtime exceptions. Bun supplies HTTP, WebSockets, SQLite, bundling and tests. The browser supplies Web Components, editing, IndexedDB, Web Crypto and offline caching.

## Run

```sh
bun install
bun run dev
```

Open http://127.0.0.1:3000/app. `PORT` and `HOST` configure the server. For an HTTPS proxy, set `PUBLIC_ORIGIN` and preserve the public Host header. Development servers build tldraw in development mode; production builds and `bun run start` use production mode. Set `PUBLIC_TLDRAW_LICENSE_KEY` before building for production. Whiteboard styles, icons, translations and fonts are served locally and cached offline. Back up `.data/`, including `master.key`. Use the exact public origin for CLI connections.

```sh
bun run check
bun run build
NODE_ENV=production bun run start
```

## Cloudflare

The Worker serves the app shell. Each workspace has a SQLite Durable Object for
its permissions, document events and snapshots. A shared gateway authenticates
requests and routes them to the workspace; attachment bytes live in R2.
WebSockets and polling remain available.
See [deployment, configuration and platform limits](docs/cloudflare.md).

## Email sign-in

Keep writing without an account setup step. To open the same account on another device, choose **Sign in with email** in the account menu, then **Link this account**. Enter the code sent to your email. On the other device, choose **Sign in to another account** and use the linked email. Codes expire after five minutes, work once, and belong to the browser that requested them.

The server sends codes through Resend's HTTP API. Configure `RESEND_API_KEY` and `EMAIL_FROM` in the server environment; the sender must be verified with Resend. Without these settings, email sign-in stays disabled and the recovery-key workflow remains available. Production needs HTTPS and `PUBLIC_ORIGIN`.

Email recovery stores your account recovery key encrypted under `.data/master.key`. Protect and back up that key together with the databases. The server and anyone who can access your email can recover the account; this is not end-to-end encryption. Linking preserves document ownership. Switching accounts preserves the previous recovery key and its local data on the device.

Integration tests use an injected delivery service or an explicitly enabled `ALKALYE_TEST_EMAIL_MAILBOX` directory. This local mailbox writes private test codes to disk and is forbidden with `NODE_ENV=production`; never configure it on an exposed server.

## One document architecture

The browser, CLI and MCP use the same document protocol. Each document has one event stream for source, comments, attachment references, drawings, themes and access changes. Opening downloads a current snapshot; older history loads on demand. Frontmatter owns document metadata. Sidebar entries cache its derived values.

Typing appears immediately and commits to IndexedDB in bursts: after 250 ms of quiet, or within one second of continued typing. Selection changes and composition boundaries separate undo groups; navigation and hiding the page flush pending edits. The Saved indicator confirms persistence. Only durable actions are published. CLI actions use the same Effect EventLog and document session with a Bun SQLite journal. Cached documents open offline, durable pending actions survive restarts, and synchronization publishes them after reconnecting. Text uses an operation-based CRDT. Whole-document undo records compensating actions and preserves other writers’ changes.

Whiteboards mount tldraw inside a Web Component. An Effect scope owns the React root, store listeners, queued saves and cursor presence. Each tldraw record occupies a document register field and names its schema, so interrupted upgrades remain readable. Shape edits use the same journal, synchronization and history as other document actions. Cached light and dark previews let documents and slides show drawings without mounting the editor.

The server stores accepted document actions and materialized snapshots in SQLite. WebSockets announce changes and carry cursors, presentation positions and laser pointers. When a network keeps refusing or dropping WebSockets, the browser switches to HTTP long polling at `/api/live/poll`, `/api/live/send` and `/api/live/close`, which share the WebSocket path's authorization and presence, and it retries WebSockets about every 90 seconds. Workspace owner/writer/reader roles inherit into documents; owners can add document-specific grants. Agents operate under current account permissions and a scoped role ceiling.

The default `/app` runs the document controller. Addresses are ordinary paths, as in the original: `/app/doc/<id>` with optional `/preview`, `/slideshow`, `/teleprompter` or `/timemachine`, `/app/spaces/<workspace>` and `/app/spaces/<workspace>/doc/<id>`, `/app/spaces/<workspace>/settings`, and `/app/settings?category=general|editor|connections|app`. The server and service worker answer every `/app/…` path with the same shell, so deep links reload and reopen offline; `src/shared/routes.ts` parses and builds them, and older `/app#<id>` links are rewritten once. Invitation links keep their secret in the fragment, `/invite#…`, so it never reaches a server log. `/app/native` is an alias to the same bundle. The former room REST and WebSocket protocols return `410 Gone`; their implementation has been removed. Existing database files remain untouched. This rewrite does not automatically migrate Jazz or the earlier rewrite’s room data.

The app supports Markdown editing and preview, comments, attachments, drawings, custom document themes, slideshow, teleprompter, presenter following, history, document copying, workspace permissions and offline reopening. Settings is a page with the original's General, Editor, Connections and App & data categories; it exposes the account ID and recovery key and restores an account on another device. The library's workspace menu switches workspaces and creates them; the gear beside it opens the workspace's settings for its name, members and invitation links. The interface follows the original application's layout, Geist type and icons, in light and dark appearances.

Documents and workspaces export to ZIP with attachments, editable whiteboards, themes, comments and links, and import back without replaying history. Owners share by writer or reader invitation links, which they can revoke, or by public read links. Folders on the device open as workspaces: Markdown files edit in the same editor and save back to disk, merging changes made by other programs. Delete moves a document to the trash, owners can move documents between workspaces and collaborators can leave them. The tools panel adds a document outline, backlinks, save as, share a copy and turning a document into a presentation. See [docs/portability-sharing-and-folders.md](docs/portability-sharing-and-folders.md). The document log is not end-to-end encrypted.

## Agents

Settings → Connections (`/app/settings?category=connections`) shows the MCP URL, OAuth consent requests and connected clients. Connections choose workspace scope and a reader/writer/owner ceiling. `/mcp` exposes eleven document, comment and workspace tools with revision checks. OAuth discovery, public client registration, consent and S256 PKCE are built in.

```sh
ALKALYE_SERVER=http://127.0.0.1:3000 ALKALYE_MCP_TOKEN=... bun cli.ts mcp
```

## CLI

Create an API key in Settings → Connections, choosing its workspaces and permission ceiling. The same key works with the CLI and MCP; disconnecting it revokes both. API keys use the server's current account permissions and never require copying your recovery key.

```sh
export ALKALYE_SERVER=https://your-alkalye-server.example
export ALKALYE_API_KEY=YOUR_API_KEY
bun cli.ts doc list
bun cli.ts doc content DOCUMENT_ID
bun cli.ts --scope space:WORKSPACE_ID doc create --title Notes --file notes.md
bun cli.ts doc update DOCUMENT_ID --file notes.md --expected-revision REVISION
bun cli.ts mcp
```

`--api-key` also accepts a key. Prefer the environment variable to keep it out of shell history. API-key commands run online and use revision checks; a stale revision fails without overwriting a collaborator's work. History, undo, redo, restore and offline synchronization require the recovery-key account workflow below. Invalid or revoked API keys fail without falling back to a local account.

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

`bun run check` checks dependencies, Effect boundaries, types and formatting, then runs module integration tests and fast app journeys. Tests use real SQLite, IndexedDB, HTTP, WebSockets, polling and CLI processes. Four concurrent frontmatter cases remain explicitly marked as TODOs.

```sh
bun run test:integration            # Deep module contracts, Bun and browser
bun run test:e2e                    # Fast app journeys
bun run test:e2e:full               # Broader app behavior and screen checks
bun tests/e2e.ts --suite theme-library
```

Browser tests use background `agent-browser` sessions. Straight-line journeys use native command batches, with condition-based waits. The broader suite builds once and runs a bounded worker pool; each suite keeps its own server, database and browser session. See [testing boundaries and coverage](docs/testing.md).

The original app remains available in Git at `a749728`. Its known differences are listed in [docs/portability-sharing-and-folders.md](docs/portability-sharing-and-folders.md). Run `bun run ci` after the final PR push for the required exact-commit signoff; never push directly to `main`.

written with GPT-6 in Codex
written with claude-opus-5-5 in Claude Code

written with gpt-6 in codex
