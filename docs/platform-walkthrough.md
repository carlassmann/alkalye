# Building with Effect and the platform

Start with `src/client/document-app.ts`, `src/server/index.ts` and `src/cli/main.ts`. These are the browser, Bun server and Effect Command entrypoints. They construct service graphs through Layers. Scopes own resources; cancellation interrupts work and runs finalizers before those resources close.

## A document edit

`src/client/components/editor.ts` uses a textarea for selection, composition, keyboard behavior and accessibility. A separate syntax overlay paints tokens. Web Components own interactive controls and release their listeners and fibers when disconnected. Each component has a scoped CSS file. Markdown previews use Shadow DOM.

Follow an edit into `src/shared/document-session.ts`. This is the shared browser/CLI engine. A document action can change source, comments, assets, drawings, themes or permissions. The underlying replica represents text as identified inserts and deletions and other values as registers. Frontmatter is the metadata source; sidebar summaries are derived copies.

The session stages a change against committed state, appends a typed Effect EventLog record and updates its projection. Unsaved source stays in a queue when persistence fails. A failed save prevents navigation from silently discarding the draft. Opening first restores a cached projection; a damaged cache rebuilds from the durable journal. Cache failure cannot invalidate a committed edit.

`src/platform/indexeddb-journal.ts` adapts browser IndexedDB. `src/platform/sqlite-journal.ts` adapts Effect SqlEventJournal through Bun SQLite. The browser adapter and `src/cli/document-platform.ts` provide the same session with platform lifetimes and notifications. Neither implements another synchronization engine.

## Opening and synchronization

`src/client/browser-library.ts` caches the authenticated catalogue and uses Effect RcMap to acquire document sessions. Each acquired scope includes assets, discussion, live presence and media resolution. Selecting another document saves first and releases the old scope. A stale lookup is cancelled; its callback cannot replace the current editor.

Snapshots contain the full current document. Opening does not download its history. `src/shared/document-transport.ts` supplies the shared typed HttpApi client. Synchronization publishes the exact local creation, pulls accepted facts and submits pending actions with stable identities. Lost replies retry the same action. History pages are separate requests.

`src/server/document-store.ts` uses Effect EventLog, SqlClient, SqlSchema and Migrator. Authorization, accepted facts, receipts and projections commit in one SQLite transaction. Failed commits leave no partial event or history edge. Current snapshots and source-derived library summaries are materialized projections; the event stream remains authoritative.

Undo appends a compensating document action. Text compensation preserves another writer’s characters. Register guards reject compensation that would overwrite an intervening incompatible change. Compensation provenance and chains survive snapshots and cold reopening. Older attachment bytes remain reachable by retained history.

`src/server/document-live.ts` carries cursor positions, presentation state and laser pointers and announces changed documents. Announcements trigger the normal document synchronization path. Workspace owners own their documents; writer/reader memberships inherit into them. Additional document grants are recorded in that document’s event stream.

## Accounts and agents

`src/platform/signatures.ts` derives an Ed25519 identity from a recovery key using Web Crypto. Challenges bind the public key, origin and intended browser-cookie or bearer session. The browser uses an HTTP-only cookie; CLI requests use bearer sessions. Account changes are checked before browser requests. Settings can reveal the recovery key or restore another account.

`src/server/agent-store.ts` contains agent and OAuth storage, separate from document storage. `src/server/agent-credentials.ts` issues scoped account grants. `src/server/account-documents.ts` implements MCP operations through the document store and its current permission checks. There is no room fallback. Cipher uses Effect Crypto and Cache around the Web Crypto AES-GCM adapter to protect stored agent credentials. Document events are currently plaintext; end-to-end encryption is unfinished.

OAuth consent, code redemption and refresh rotation claim records transactionally. Revoking a connection invalidates its access and refresh family. Effect’s MCP modules supply protocol parsing and HTTP routing. `src/cli/mcp.ts` adapts stdin/stdout through Stdio, Stream and scoped fibers and forwards requests to that same server.

## CLI and testing

`src/cli/profile.ts` uses Effect KeyValueStore with its SQL layer. Profile changes and document discovery updates use SQL transactions so simultaneous processes cannot lose each other’s writes. Private profile storage and per-document journals live under the selected home directory. Origin and account identity isolate datasets. Logout removes the profile while retaining document data.

`src/cli/documents.ts` acquires the shared document session with the SQLite adapter. Offline edits remain durable. List and synchronization release each document’s scope promptly; failures in one document do not prevent processing healthy documents. Explicit sync reports incomplete work. `src/cli/runtime.ts` adapts Effect Runtime signals to Bun and waits for interruption cleanup.

Bun tests exercise real SQLite, subprocesses, CRDT convergence, journal replay, cancellation, permissions and failure injection. Background agent-browser suites exercise actual IndexedDB, offline page reloads, multiple tabs, assets, presentations, drawings, preferences and OAuth. Four concurrent frontmatter cases remain TODOs. Coverage from the retired room protocol was removed with that implementation; current document tests cover the replacement.

The former room HTTP and WebSocket routes return `410 Gone`. `/app/native` aliases `/app`; both serve one bundle. App addresses are paths such as `/app/doc/<id>/slideshow`, `/app/spaces/<workspace>/settings` and `/app/settings?category=connections`, parsed in `src/shared/routes.ts`; the server and service worker answer each with the app shell. ZIP backups, invitation links and local folders are described in [portability-sharing-and-folders.md](portability-sharing-and-folders.md). Existing storage is retained; automatic migration of Jazz data remains unfinished.

written with GPT-6 in Codex
written with claude-opus-5-5 in Claude Code
