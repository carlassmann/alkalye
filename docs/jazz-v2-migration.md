# Jazz v2 migration

Branch `jazz-v2-migration`. Goal: alkalye fully functional on Jazz v2, a seamless move for existing users, and measured performance of Classic vs v2 on real-life datasets.

## Decisions

- **Version:** `jazz-tools@2.0.0-alpha.61`, pinned exactly. Reference source: https://github.com/garden-co/jazz (clone at `/tmp/jazzref/jazz`; use tag `v2.0.0-alpha.61`, not `main`). Docs: https://jazz.tools/llms.txt. Never rely on Classic-era Jazz knowledge for v2 APIs.
- **Classic stays only for the importer**, as aliased packages (e.g. `jazz-tools-classic: npm:jazz-tools@0.20.18`, `cojson`). No app code outside the importer imports Classic.
- **End-to-end encryption is dropped for now.** Data is readable by our backend and Jazz Cloud. README, privacy page, landing copy and in-app copy must say so honestly.
- **Backend:** `createJazz` inside the Astro app, mounted at `/jazz` (catch-all API route, `jazz.handle(request)`), deployed on Vercel. Local dev and tests: `sqlite()` store. Production: `remote()` to Jazz Cloud v2 via env vars (`JAZZ_APP_ID`, `JAZZ_SERVER_URL`, `JAZZ_ADMIN_SECRET`).
- **Client:** local-first client (`jazz-tools/local-first`, SharedWorker + IndexedDB); the PWA precaches the Wasm and worker.
- **Auth:** local-first device accounts; `authenticate: acceptDeviceAccounts`. The 24-word recovery phrase replaces Classic's passphrase. Both are BIP39-English encodings of 32 bytes, so a Classic user's existing words restore their v2 account. Passkey backup optional.
- **Permissions:** policies plus membership tables (owner, space members, document grants, invites, public flag) replace Groups. Invite redemption is a backend route. Client updates cannot change document owner or space ID. Space reassignment needs a trusted backend operation in phase 2; personal folder assignments remain client-writable.
- **Text:** `content: s.string().merge("markdown")`. CodeMirror adapter writes every change immediately with `editedFrom`, applies incoming values as minimal changes (`addToHistory: false`).
- **Presence, cursors, laser:** `.history("latest")` tables.
- **Comments:** threads/replies tables; anchors are `db.textAnchors()` ranges in JSON.
- **Time machine:** v2 `$history` plus imported Classic versions (`documentVersions` table with original timestamp and author).

## Classic workarounds to delete (not port)

Classic-only and pointless on v2. Delete them with their tests, unless a measurement on v2 shows a need.

- Bounded replay rules, account root rotation, `migrationVersion`, account migrations (`src/schema/migrations*`), metadata backfill.
- Document content generations and archived content, compaction (`use-document-compaction`), late-write reconciliation.
- Entry-ID based incremental save and rebasing, document save worker, bounded transaction patching, document text caches.
- Laser hub/sender rotation; CoFeed cursor plumbing.
- Group inheritance juggling when moving documents between spaces; `delete-covalue`.
- `docs/jazz.md` is rewritten for v2 patterns.

## Seamless user migration

On first launch of the v2 app:

1. If the browser still holds Classic credentials (Classic `AuthSecretStorage` in localStorage), derive the v2 secret from the same 32-byte seed, sign in, and import silently with a progress indicator. Import resumes after interruptions.
2. Otherwise, signing in with the existing 24 words does the same.
3. Import reads Classic data in the browser (Classic sync server stays up), writes v2 rows, and keeps a `classicImports(classicId -> v2Id)` map. Docs shared between users are created once. Other members gain access only through a membership claim the backend can verify, so access can't be spoofed.
4. Text, comment anchors, assets (hash-verified), spaces, themes, settings and history are imported.

## Benchmarks

Same harness against Classic (`main`) and v2 (this branch), real-life datasets, results committed as JSON plus a markdown report: `docs/benchmarks/jazz-classic-vs-v2.md`.

## Phases

1. Foundation: deps, backend route, full schema and permissions, client, auth, documents, editor binding, sidebar. In parallel: benchmark harness and Classic baseline.
2. Features in parallel: spaces/sharing/invites/public; comments/presence/laser/time machine; assets/themes/import-export/settings/onboarding; agents/MCP/CLI.
3. Classic → v2 user migration.
4. v2 benchmark run, review, `bun run ci`, PR.

## Progress log

Agents append one line per finished step: date, phase, what, commit.

- 2026-11-13, phase 1 spike: Astro `/jazz/[...path]` + `jazz.handle`, isolated `.jazz` SQLite, local-first SharedWorker/Wasm, device account and React live query exercised with agent-browser at `/spike`. Created note survived reload. Vite 7 needs both `jazz-tools` and `jazz-wasm` excluded from prebundling, native backend externalized. HTTP stream fallback works without WebSocket attachment. Astro requires `export const prerender = false` for static route analysis. Commit: foundation spike.
- 2026-11-13, phase 1 schema: all 21 tables declared in `src/jazz/schema.ts`; explicit ownership, membership, grants and protected document administration. Nine real policy-server tests pass across document/space roles, public read and impersonation. `exists.where` accepts objects only in alpha.61; named relationship inheritance avoids nested policy relations. Commit: shared schema and permissions.
- 2026-11-13, phase 1 Classic retirement: deleted Classic-bound modules and their tests, including account migrations, generations/compaction, incremental save/worker/protocol, text caches, reconciliation and laser rotation. This also wrongly removed the original application UI. The workaround deletions remain valid; replacing the product UI did not meet the migration goal. MCP/OAuth/discovery return 503 and CLI exits explicitly. Commit: retire Classic runtime.

- 2026-11-13, phase 1 client: v2 provider/device accounts, existing recovery UI, document library, personal folders/pins, keyed CodeMirror binding with immediate `editedFrom` writes, minimal incoming diffs, mapped selections and IME handling. Kept wikilink decorations/autocomplete and derive backlinks from readable content. Browser navigation exposed duplicate sibling keys; fixed and verified one toolbar after switching. Nineteen policy tests and four editor-binding tests pass. Commit: v2 account and document UI.

## Phase 1 handoff

The reviewed shared contract is `src/jazz/schema.ts` with 21 tables. Settings JSON is typed in `src/jazz/value-types.ts`. The initial schema snapshot is committed. Subsequent schema changes must generate and import a migration graph before opening an existing store. The spike's disposable SQLite stores were preserved under `/tmp/alkalye-v2-foundation-spike-20261113` and `/tmp/alkalye-v2-pretyped-contract-20261113`; the final contract uses this worktree's `.jazz/`.

### Runtime decisions

- Astro hosts Jazz successfully. Fetch streams provide the fallback transport; no separate sync service is needed.
- `ALKALYE_LOCAL_PREVIEW=1 bun x astro build` builds a Node standalone preview with local SQLite. The default build still targets Vercel and remote Jazz Cloud storage. This flag is for local validation only. Production requires cloud credentials and a browser-facing `JAZZ_PUBLIC_URL`.
- Offline validation used a separate temporary Work project in `/tmp/alkalye-v2-foundation-preview` pointing at this checkout's built Node server. Its URL was `https://web-preview-alkalye-v2-foundation.cshed.carlassmann.com`. The ordinary dev URL is `https://web-jazz-v2-migration-alkalye.cshed.carlassmann.com`.
- Work reads its command definitions from the primary checkout. Until this branch's `work.config.js` lands there, `work up --tailscale` still starts its old Classic sync command. Stop that unused command; the v2 app never connects to it. Both setup and startup were run with `--tailscale`.
- The foundation incorrectly replaced the original TanStack routes and UI with a small browser-history router. The restoration below replaces that router; the Astro catch-all app shell remains.
- The foundation initially derived backlinks instead of preserving their frontmatter representation. The restoration below reinstates frontmatter backlinks. Personal folders and pins also have private rows. Document owner/space changes require a later trusted backend operation.
- BIP39 signup generates 32 random bytes and shows 24 English words before creating the account. Backing up a guest exports its existing key. Classic credential detection and importing remain phase 3 work. Passkey backup was skipped.

### Verification

2026-11-13, background agent-browser sessions `jazz-v2-final-one` and `jazz-v2-final-two`, independent browser profiles:

- Create device account, display 24 words, copy phrase, finish signup. Sign out returns to the existing auth form. Restore the original account using its phrase from another profile; the same document appears.
- Create a document, type, reload its deep URL. Content survives. Rename, pin, create a folder, move the document and reload; all survive and sync to the second profile.
- Use `[[id|alias]]`, follow its editor decoration, inspect the backlink on the target and delete the source document. Navigation leaves exactly one toolbar and one editor.
- Disable page networking and reload the production PWA. The service worker serves the app, including Wasm and worker assets; the document opens from IndexedDB.
- Stop the backend, type at opposite ends in both profiles, restart the backend. Both additions survive and converge. Repeat simultaneous typing on the final build, then reload offline. Both profiles show `LATEST ONE. FIRST DEVICE. # Foundation`, the original middle lines, and `Last line. SECOND DEVICE. LATEST TWO.`
- `bun run check:types`: zero errors. `bun run check:lint`: zero errors, existing style warnings. `bun run check:test`: 51 files, 554 tests pass, including 19 policy-server tests and four CodeMirror sync tests. Default Vercel and local Node builds pass. Classic alias core imports work under Node.

### Deferred areas

`v2-todo` markers identify agents, agents-mcp, assets, comments, import-export, importer, landing-demo, local-files, onboarding, presentation, settings, sharing, spaces, themes and time-machine. The schema covers their data. Phase 1 removed their UI/runtime wiring; the restoration below recovers the editor-facing controls, but several feature screens still need restoration. Presence/laser feature UI is part of sharing/presentation. Account preferences have a table but no settings UI. The static landing demo remains available. MCP/OAuth/discovery endpoints return 503; CLI exits with an explicit migration message. Pure helpers and tests remain for reuse; removed feature code remains in git history.

### Alpha.61 findings and remaining work

- Vite 6/7 needs both `jazz-tools` and `jazz-wasm` excluded from dependency prebundling. Concurrent `astro check`/build can invalidate a running dev server's optimized dependencies; restart it after checks if the browser reports stale dependency hashes.
- `exists.where` accepts objects, not callbacks. Use relationship inheritance for admin policies.
- Changing a schema with `migrations: "none"` after a store has opened fails with disconnected migration roots. Changing a typed JSON schema in place is unsupported. The initial contract was frozen after the spike; future changes need lenses.
- Astro requires a literal `export const prerender` for static analysis. Other new application code uses `let`.
- No cloud deployment was attempted. Phase 2 still needs trusted invite redemption, space reassignment and complete deferred feature UIs. Phase 3 must verify Classic membership claims before writing imports/grants. `classicImports`, invites and imported versions deliberately reject client writes.

- 2026-11-13, phase 1 validation/infra: final browser sequence and checks above pass. PWA precaches Wasm and worker; default Vercel and local Node builds succeed. Replaced encryption claims with server-readable sync disclosures and rewrote `docs/jazz.md`. Commit: v2 runtime validation and handoff.

## UI restoration follow-up

Phase 1 was a working foundation, not a completed UI migration. Its document-library, document-editor and history-router replacements failed the requirement to preserve the product.

- 2026-11-13, restoration data layer: typed v2 document operations, document/library-entry transactions, nested private folder rows, pins and frontmatter backlinks. Real policy-server integration tests cover folder entries, pin persistence and adding/removing backlinks without losing target text. Commit: `bc9233e`.
- 2026-11-13, restoration UI: original editor, toolbar, floating actions, context menu, command palette, stats, sidebar list/folders/multi-selection/drag/keyboard controls, file actions, preview renderer/top bar and settings panels restored from `8379d4e` and connected to v2. TanStack plugin and all 17 route files restored. The phase-1 replacement editor/library/history router are removed. No Classic save infrastructure was restored. Commits: `d23c574` (editor/widgets), `3155b7b` (shell/routes/sidebar/settings).

### Implementation decisions

The editor receives the phase-1 `codeMirrorSync` binding directly. Its external-value effect delegates incoming values to that binding, avoiding a second write path for remote text. Every local edit commits immediately with `editedFrom`; local durability emits the existing automation event. Editor state and undo remain keyed by document.

Backlink sync at `8379d4e` wrote source IDs into editable targets' frontmatter within the same library. That was product behaviour, not a Classic workaround. The restored implementation adds/removes those entries, retaining target text and using `editedFrom`. Operations for a source are ordered to prevent a slow addition overtaking a removal. It excludes self-links, deleted documents and documents outside the personal library or current space. Folder and pin frontmatter remains visible; private library rows record folder assignments and pins too.

Account changes keep the router mounted while gating its outlet. Recovery waits for backend admission and an authoritative query before choosing the latest account document. Explicit private links are recorded separately from a guest's current document. Cross-profile e2e checks explicitly wait for source uploads; their URL/content assertions remain intact. Auth waits allow 30 seconds for alpha.61 admission. Reload and disconnect experiments were removed.

### Runtime evidence

Both checkouts were started with `work setup --tailscale` and `work up --tailscale`. The stale Classic sync command in the v2 workspace was stopped.

- V2 dev: https://web-jazz-v2-migration-alkalye.cshed.carlassmann.com
- Exact Classic baseline `8379d4e`: `/tmp/alkalye-classic-ui-baseline`, https://web-v2-ui-classic-baseline-alkalye.cshed.carlassmann.com
- Production PWA validation uses a separate SQLite store in `/tmp/alkalye-v2-ui-preview`: https://web-preview-alkalye-v2-ui.cshed.carlassmann.com

Background agent-browser profiles exercised the full editor, account phrase backup/restore, folders, pins, reload, backlink addition/removal and two-profile typing. Folder moves and pins appeared in both profiles after reload. With the backend stopped, the profiles added `OFFLINE ONE.` and `OFFLINE TWO.`; both additions converged after restart. The production PWA opened its document after networking was disabled and the page reloaded. Editor font-size changes persisted after reload.

Final validation at `3155b7b`: `bun run check:types` passes with zero errors; `check:lint` passes with 67 style warnings; `check:test` passes all 53 files / 630 tests. The local Node production build passes. All five tests in `e2e/auth.spec.ts` and `e2e/doc.spec.ts` pass in one stable-server run (2.8 minutes). The auth specs retain their assertions and only add source-upload waits and 30-second auth waits. The final production build also reloaded `# Final offline validation` with networking disabled. Editor settings and German language selection survived reload and synchronized to the second profile.

Screenshot pairs in `/tmp/alkalye-v2-ui-compare/`:

| Screen       | Classic                | V2                |
| ------------ | ---------------------- | ----------------- |
| Home/sidebar | `classic-home.png`     | `v2-home.png`     |
| Document     | `classic-doc.png`      | `v2-doc.png`      |
| Preview      | `classic-preview.png`  | `v2-preview.png`  |
| Settings     | `classic-settings.png` | `v2-settings.png` |
| Auth form    | `classic-auth.png`     | `v2-auth.png`     |

The editor and preview use the original layout. Disabled comments, sharing and asset controls are visible. Auth retains the phase-1 server-readable-data disclosure. Screenshot pairs are review evidence, not a pixel-diff assertion.

### Remaining restoration work

This follow-up still does not complete the requested restoration of every deferred feature UI. Local-files, space documents/settings, invitations, time machine, presentation, theme workbench and tutor/welcome routes currently show a migration placeholder. Their full original screen implementations have not been restored. Theme/preset pickers and connection-management panels are also incomplete. Import/export, comments, sharing, spaces and binary assets have explicit disabled operations or `v2-todo` markers. These need their feature agents; they must not be reported as fully restored.

Auth admission remains slow in alpha.61. Final complete auth flows took 31–44 seconds, including their setup and navigation. No Classic importer, passkey implementation, cloud deployment, push or PR was attempted.

- 2026-11-13, restoration validation: 630 tests, zero type/lint errors, five unchanged-assertion auth/document e2e cases, screenshot pairs and final-build offline reload verified. Deferred original feature-screen restoration remains incomplete. Commit: validation handoff.

written with gpt-6.1-sol in T3 Code (Codex)

## Auth latency investigation

2026-11-13, research follow-up from `937934c`, branch `t3/diagnose-auth-admission`.

The 31–44 second handoff figure was a complete e2e scenario duration. The delay comes from Vite leaving Jazz WebSocket upgrades unanswered. Jazz alpha.61 waits its 10-second socket deadline before probing and selecting HTTP streaming. Restoring immediately in a fresh profile can pay it twice: guest uploads must finish before the account switch, then the restored replica discovers its transport. Local data already opens promptly; removing recovery's authoritative query would not fix this and would break account routing.

Representative seconds, fresh browser contexts and warm Vite transforms:

| Flow / milestone               | Dev before → after | Node build before → after |
| ------------------------------ | -----------------: | ------------------------: |
| First visit, local editor      |      1.423 → 1.489 |             0.878 → 0.907 |
| First visit, backend admission |     11.125 → 1.139 |             0.906 → 0.924 |
| Signup, show words             |      0.178 → 0.151 |             0.165 → 0.149 |
| Signup, finish backup          |      0.097 → 0.107 |             0.109 → 0.123 |
| Fresh-profile recovery, editor |     20.348 → 0.622 |             0.536 → 0.657 |
| Reload, local editor           |      0.777 → 0.854 |             0.347 → 0.395 |
| Reload, backend admission      |     10.666 → 0.861 |             0.356 → 0.409 |

Production preview uses `ALKALYE_LOCAL_PREVIEW=1 bun x astro build` and local SQLite, not Jazz Cloud/Vercel. Its auth was already fast. Cold dev compilation remains a separate cost: editor/admission at 8.331/17.992 seconds before, 8.136/8.160 after. These are diagnostic samples, not percentiles.

Added a development-only Vite plugin rejecting only `/jazz/apps/<id>/ws` upgrades. Jazz then immediately uses its supported HTTP stream fallback; HMR remains operational. No app UI or account-data gate changed. All auth helper/spec waits return from 30 to 10 seconds.

The standalone Vite/Jazz reproduction measures admission at 10.372 seconds before and 0.306 after. Its first remote query completes at 10.411 and 0.345 seconds. The draft upstream proposal is explicit HTTP transport selection or concurrent capability discovery. No upstream issue was submitted. Detailed phase tables, source trace, reproduction, temporary instrumentation and measurement harness are in `docs/jazz-v2-issues/auth-transport.md`; numeric results are in `auth-timing.json` beside it.

Validation: `check:types` has zero errors; `check:lint` has zero errors and 67 existing warnings; `check:test` passes 53 files / 630 tests. All four `e2e/auth.spec.ts` cases pass with one worker at the final implementation, retaining source-upload waits, document/URL assertions and the access-denied observer. Complete scenarios take 12.7–19.7 seconds. The measurement builds and final uninstrumented Node build pass. Full `check:format` still flags nine unchanged MCP/OAuth route files from the baseline; changed files pass formatting. Both app environments and the standalone reproduction ran through Work with tailnet HTTPS; stale Classic sync was stopped. No push or PR.

## Phase 2: agents, MCP, OAuth and CLI

2026-11-13, branch `t3/mcp-oauth-cli-v2`, based on `937934c`.

- Restored the eleven Classic MCP tool definitions, OAuth/discovery endpoints and connection settings UI from `8379d4e`, then replaced their data access with v2. MCP commit: `693850a`.
- Approval sends a signed Jazz device proof, never the device secret. Grants hold account/client/connection IDs; the database stores only a SHA-256 credential hash. OAuth tokens encrypt the identifiers with the server key. Requests, each tool invocation and token exchanges check revocation. Connection rows are readable by their owner but reject direct client inserts, updates and deletes. Approval and revocation use authenticated backend routes.
- MCP runs through policy-scoped `jazz.forUser(accountId)`. Content replacements use serializable revision checks and `editedFrom`; comments use `db.textAnchors()` ranges stored directly in `commentThreads.anchor`. The quote is `anchor.matched`; replies include the original comment body. Comment-feature integration must use this same range representation or adapt the shared `src/mcp/comments.ts` reader.
- Restored CLI command trees/options and print rendering from Classic. Recovery phrases restore the same v2 device account. Keys stay in a mode-0600, origin-bound local auth file; `/api/cli` receives signed proofs and executes with `forReqUser`. Documents, spaces, comments, assets, themes, public flags, invites and guarded moves are implemented. Local file/stdin input and HTML/PDF rendering stay local. Docs and English/German consent copy describe server-readable data and device-local secrets.

### Shared contract and integration

No schema columns changed and no migration lens was added. Only `agentConnections`/`mcpConnections` write policies changed to backend-only. No local store wipe was needed.

`src/cli/sharing.ts` contains guarded backend operations for invites, document moves and leaving memberships. Invite links are `/app/invite?invite=<uuid>#<token>`, tokens are hashed, expire after seven days and redeem once. The resulting grant/member uses the invite UUID as its row ID. Revocation removes that grant/member while preserving other access. The sharing agent must reconcile these helpers and link format with its browser invitation route. This branch does not restore the sharing screen.

The CLI uses an online backend rather than a local replica. `--offline`/`--local` fail explicitly; offline CLI caching remains undone. `--sync-peer` remains accepted for compatibility, but requests use the deployment's `/jazz` authority. Base64 asset uploads remain subject to deployment body limits. Production Jazz Cloud and a deployed provider OAuth registration were not exercised.

### Alpha.61 API gaps and patch

The pinned Bun patch is `patches/jazz-tools@2.0.0-alpha.61.patch`, registered in `package.json`/`bun.lock`.

1. Upstream `createJazz.forReqUser` treats `acceptDeviceAccounts` as signed out. The patch verifies the device proof against the configured audience, checks browser origin and registry admission, then creates a policy-scoped database.
2. Upstream `createJazz` has no account-scoped `forUser`; its remote trusted-client version only resolves backend identities. The patch adds trusted, in-process `forUser(accountId)` using the existing policy-scoped backend context, with no policy bypass. Both patched paths attribute the user's account with backend identity `jazz:backend`, subject equal to the account UUID. They do not claim the device signed each server-side edit.

Tests cover forged proofs, other-app audiences, foreign origins, policy enforcement and cross-account revocation. Keep the patch until upstream provides these APIs; do not replace it with `withAttribution`.

### Verification

Started with `work setup --tailscale`, then `work up --tailscale`; stopped the stale Classic `sync` process. Runtime: https://web-t3-mcp-oauth-cli-v2-alkalye.cshed.carlassmann.com

- `bun run check:types`: zero errors. `check:lint`: zero errors, 60 style warnings. `check:test`: 55 files, 638 passing tests. New real-backend suites exercise all MCP tools, proof validation, revision conflicts, reader/writer isolation, comments, revocation, CLI CRUD, space moves, one-use invites/revocation, assets and theme sources. Changed TypeScript/Markdown files pass Prettier.
- `bun run qa:mcp:user <origin>` passed with generated accounts and with an account created through the browser. It verifies approval without secrets, PKCE exchange, document list/read/create/edit/rename, anchored comments/replies/resolution, outsider isolation, shared non-admin writing, archive rejection, connection revocation, refused refresh and an independent surviving connection. `ALKALYE_QA_DEVICE_KEY_FILE` selects a local test-device key; optional `ALKALYE_QA_STATE_FILE` saves the surviving QA access token locally for further tests.
- Background browser verification created an account with 24 recovery words, approved the original consent UI and received an authorization code. With the MCP-created document open, an HTTP tool update appeared live in CodeMirror. Disconnecting through Settings removed the rows; the same MCP token then returned HTTP 401. The browser's recovery phrase also restored its document library in the CLI.
- `bun run qa:mcp <origin>` passes discovery, PKCE metadata, cross-origin token errors, unauthenticated challenge and legal pages. OpenAI domain challenge was skipped because no challenge token was configured. Restoring the original endpoint exposed its missing GET handler; added GET so discovery receives the expected 401 challenge.
- CLI signup, document creation/listing, phrase login, unauthenticated local Markdown-to-HTML export and Chrome PDF export passed against the running worktree. Browser tab closed after validation. No push, PR or cloud deployment.

## Phase 2: comments, time machine, presentation

- 2026-11-13, phase 2 presentation: restored Classic slideshow, teleprompter, laser preview/trails and sidebar links from `8379d4e`; ported transport to v2 latest-history rows, without hub/sender rotation. Commit: `7e00fd7`.
- 2026-11-13, phase 2 comments: restored Classic sidebar, selection dialog, preview highlighting, replies and thread actions. Anchors use `db.textAnchors().captureRange/resolveRange`; quote/context recovery rejects ambiguous matches and shows deleted text as orphaned. Commit: `d896715`.
- 2026-11-13, phase 2 time machine: restored Classic route, screen and bars; accepted v2 history merges chronologically with `documentVersions`. Restore writes ordinary document content. Historical copies retain comments, asset bytes and cloned whiteboard revisions. Commit: `74976f9`.
- 2026-11-13, phase 2 access review: inherited space ownership/membership now enables preview comments, slideshow controls, teleprompter and time machine. Browser profile B opened a space-only writer document without a document grant. Commit: `e3fb4d8`.

### Data contract and integration

No schema changes or migration lenses. The worktree started without a `.jazz` store. Permissions changed: laser readers inherit document access; publishers still own their rows and cannot change their document/sender identity. Comment threads cannot be moved to another document by updating their foreign key. Existing permission tests now expect document readers to see laser messages.

The new `useDocumentAccess` hook covers document grants and inherited space roles for preview, slideshow, teleprompter and time machine. The editor/library and shared-space routing still belong to the sharing/spaces area. Shared files changed here are the documents barrel, two document screens, three feature routes, the themes barrel export for existing slideshow CSS, and the permission rules/tests. `useDocumentAssets` and `assetViews` convert v2 asset rows to the existing editor asset view model; the assets agent can reuse them.

`useComments(doc)` supplies the sidebar/highlight view model. Non-React import/export callers use `await loadCommentDocument(db, documentRow)` before `getExportComments` or `getExportCommentsForContent`. `ExportComment` retains the Classic JSON format. `await restoreExportedComments(commentDocument, exported, sourceContent?)` restores it with new v2 thread/reply IDs. Export includes existing comments when comments are disabled.

Time machine subscribes to `app.$history.documents`, explicitly selecting author metadata, acceptance time and transaction ID. It removes adjacent versions with unchanged text, so laser/presentation/sharing changes do not fill the text timeline. Imported versions use their original dates and author names. Attribution uses `$updatedBy.account`; a local-first device's `identity.subject` differs from the owning account.

V2 historical asset preview/restore recovers bytes, metadata and whiteboard revision references. Copy creates new asset IDs and independent whiteboard revision rows. Imported Classic asset history is not available in this schema yet: restoring an imported text version preserves current assets, while copies/previews cannot reconstruct pre-import assets. Asset deletion-only events are absent from v2 content history; current deletion metadata handles a single deletion, but repeated delete/restore intervals cannot be reconstructed exactly.

### Browser evidence

Work setup/start both used `--tailscale`; the stale Classic sync service was stopped. Runtime: https://web-t3-comments-timemachine-presentation-alkalye.cshed.carlassmann.com

Background agent-browser profiles `phase2-a` and `phase2-b` used different device accounts. A granted B document write access with the ordinary v2 database API because the sharing UI is another phase-2 area.

- A created a comment through the editor selection shortcut/dialog. B received its highlighted quote in preview. Inserting text before the quote preserved both highlights. B replied; resolve/reopen changed the count and editor decoration. Disabling/re-enabling comments synchronized. Deleting the selected words displayed "Original text deleted"; restoring the words recovered the anchor.
- B wrote document text through its v2 database. Time machine displayed B's version as "Profile B" and A's earlier version as "you". The restore confirmation returned to the editor and B's preview received the older content. The restored version remained in history as a normal new write.
- A's teleprompter controlled B's slideshow. Starting, selecting the second slide and presentation-line updates synchronized. A drew a laser trail on the preview; B displayed the red trail. A screenshot captured it before fading.
- Classic `8379d4e` and v2 screenshot pairs for comments/editor, comments/preview, time machine, teleprompter and slideshow are under `/tmp/alkalye-v2-phase2/comments-time-machine-presentation/`. Extra v2 screenshots show resolved/orphaned comments and the viewer's laser trail. These are layout evidence, not pixel-diff assertions.

### Final validation

At code head `e3fb4d8`, `bun run check:types` passes with zero errors; `check:lint` passes with zero errors and 93 style warnings; `check:test` passes all 60 files / 662 tests. Changed files pass Prettier. All five existing auth/document e2e cases pass in one final stable-server run, 2.9 minutes, with their assertions unchanged. The checks include real policy-server tests for comments/export/restore, author attribution, imported chronology, historical asset restore/copy, and cross-author laser transport, plus the restored laser widget/protocol tests.

- 2026-11-13, phase 2 validation: two-profile browser checks, Classic/v2 screenshots, inherited space-writer access, 662 tests and five unchanged-assertion e2e cases pass. No push or PR. Commit: phase-2 validation handoff.

### Alpha.61 findings

Empty mergeable transactions throw `empty mergeable transaction has no committed unit; roll it back instead`. Asset restore and comment import skip transactions when there is nothing to write. Regression tests cover text-only restore and copies without comments. A live asset row must be updated; `restore` rejects it with `row not deleted`. Deleted rows use `restore`.

The existing Vite/astro-check dependency-hash issue still applies. Restart the dev server after type checks before running browser/e2e validation. One e2e run also hit the existing boot helper's `Execution context was destroyed` navigation race; its assertions were not changed.

written with gpt-6.1-sol in T3 Code (Codex)

## Phase 2: assets, themes, import/export, local files and onboarding

- 2026-11-13, phase 2: restored the Classic screens and widgets for this area and ported their storage to alpha.61. Asset bytes stream into `s.bytes()` and listing queries select metadata. Image uploads retain the Classic 2048-pixel maximum and generate dimensions plus a small PNG thumbnail. Video uploads compress when an encoder exists and otherwise stream the original file. Video playback uses Blob URLs; uploads also derive dimensions and a small sidebar thumbnail without downloading full videos when listing. Whiteboards save immutable revisions with snapshot and light/dark PNG previews. Theme libraries, source workbench, presets, default themes, font assets and portable exports use v2 rows. The workbench uses the v2 CodeMirror binding, including `editedFrom`, and theme edits survived reload. Markdown/ZIP import and export, comment sidecars, asset copies, the duplicate dialog, local filesystem screen, welcome and tutor routes are restored. New account profiles receive a random writer name.

### Contract and merge notes

- Schema change: one optional `assets.thumbnail: s.bytes()` column. No permission changes or migration lenses. This worktree started with a fresh disposable `.jazz` store after the schema change. Reset disposable backend and browser stores when integrating the changed schema.
- `useDocumentAssets(documentId, content)` exports metadata, sidebar/editor view models and Blob URL preview assets. It reads full image/video bytes only for referenced assets; unused images use their thumbnail. Whiteboard listings load previews, never snapshots. Cleanup revokes URLs.
- `uploadAsset`, `createTldrawAsset`, `updateTldrawAsset`, `copyDocumentAssets` take the v2 database and document IDs. Streaming handles return an ID, unlike ordinary inserts. Uploads wait for local durability. Compression accepts videos up to 500 MB; the byte-upload guard is 2 GB. ZIPs and Blob playback materialize bytes in memory. Whiteboard backups retain Classic's 32 MB bundle, 8 MB snapshot and 8 MB preview limits.
- `createDocument` now accepts an optional fourth `spaceId` for creating copies directly in a destination space. It does not reassign existing documents. `handleSaveCopy` takes database, owner ID, document, UI state setter and navigate. The original toolbar gates it on a backed-up account and a public document owned by someone else.
- Shared UI changes are confined to document asset/rendering/copy/import controls, settings' theme section, barrel exports and the local/welcome/tutor/workbench routes. The presentation barrel additionally exports the restored pure slideshow renderer. Its asset input is `{ id, type, url, lightUrl?, darkUrl?, muteAudio? }`, from `useDocumentAssets().previewAssets`. The presentation agent should use this renderer and pass those assets when restoring the slideshow screen.
- Comment sidecars retain the Classic export format. Imported anchors are alpha.61 text ranges with `matched`, `before`, `after` and optional positions. Export resolves those ranges against current content. Coordinate the `anchor` JSON shape with the comments agent if its UI wraps ranges in another object.
- The local-file screen retains directory handles, asset references, conflict/recovery UI and PWA file-handler consumption. `MockDirectoryHandle` gains the optional native-move signature required by its restored tests.

### Checks and commits

`bun run check:types` passes with zero errors. `bun run check:lint` passes with zero errors and 123 style warnings. `bun run check:test` passes all 60 files and 727 tests. Five unchanged-assertion auth/document e2e cases pass together with two workers and a 120-second test timeout, 1.5 minutes. The sidebar auth selector now uses the existing sync-status test ID because restored random writer names replace “Anonymous user.” No assertion was removed. Repository-wide `check:format` still reports nine pre-existing API/discovery files outside this area; changed-area formatting passes.

Code commits: `88b71cc` assets and revisions, `a70cc19` themes and workbench, `91d297b` imports/local files/onboarding. `eb46fa8` adds generated video thumbnails. No push or PR.

### Runtime evidence

Work setup and startup used `--tailscale`; the stale Classic sync process was stopped. Runtime: https://web-t3-port-assets-themes-onboarding-alkalye.cshed.carlassmann.com

Background agent-browser sessions compared exact Classic `8379d4e` with v2. Screenshot pairs and fixtures are in `/tmp/alkalye-v2-phase2/assets-themes/`.

- Fresh account opens “Welcome to Alkalye” with a random writer profile. Markdown tutor creates a document in Tutor and replaces shortcut tokens.
- Uploaded an image, inserted it, navigated to preview and observed a decoded Blob image. Dispatched real File objects through the editor’s paste and drop handlers; both were handled, created assets and inserted links. Uploaded a video without a browser encoder, toggled mute, inserted it and observed actual playback, `readyState=4` and `muted=true`.
- Drew and saved a whiteboard, saw its preview, exported/imported it in a ZIP, duplicated the document and reopened the copied whiteboard with its original shape.
- Edited theme CSS in the original workbench and observed the preview heading change to red. Exported and reimported portable theme Markdown. Imported a theme ZIP containing a font, thumbnail and light/dark presets; the font loaded, and the heading switched between red and green with appearance. Video playback also reached `readyState=4` inside the workbench slideshow renderer. A fresh video upload produced a decoded 128-pixel sidebar thumbnail.
- Exported the whole library to ZIP and inspected image, video and whiteboard entries. Reimport completed with all three assets visible. The original duplicate dialog created independent asset IDs.
- Opened a real browser OPFS file handle through the file-picker seam, typed in the original local editor and saved with Ctrl+S. Reading the actual file returned the edited content. This exercises browser filesystem writes without an OS picker.

### Limits and remaining integration

The standalone slideshow route still belongs to the presentation agent; this area restores and exercises its renderer through the workbench. Shared-document access and space routes depend on the sharing/spaces port. Public-theme access policy remains the foundation contract. The installed PWA’s OS launch queue was not manually exercised; its restored route consumes launch files. No cloud deployment, Classic importer, push or PR was attempted. No new confirmed Jazz v2 defect was found. Alpha.61's ID-only streaming handle and Vite's stale dependency hashes were observed; restarting Work after type checks resolved the latter.

written with gpt-6.1-sol in T3 Code (Codex)

## Phase 2C integration into the migration branch

2026-11-13, merged `t3/port-assets-themes-onboarding` at `4ece575` into `jazz-v2-migration` after `8994a88`.

The document editor combines 2B's comments and presentation extensions with 2C's uploads, whiteboards, imports and copies. Preview retains live comments and inherited document access while using 2C's Blob assets and themes. The slideshow renderer follows Classic `8379d4e` with 2C's v2 media/theme access; its screen retains 2B's presentation-line writes, inherited access checks and laser receiver. Settings retains both Themes and MCP Connections. Both feature handoffs above remain intact; stray conflict-base markers from earlier handoffs were removed.

The optional `assets.thumbnail` column now has a generated migration from `8ef72cb0424c` to `35991c834bd8`, shipped through `defineApp`. The existing worktree SQLite store opened successfully without being reset. This supersedes 2C's disposable-store reset instruction for integration. `bun x jazz-tools validate --schema-dir src/jazz` validates all 21 tables. Work setup reinstalled the existing pinned MCP patch; without reinstalling, this checkout's old `node_modules` lacked `forUser` and device-proof support.

Portable comment sidecars and all copy paths use 2B's shared anchor recovery/export implementation. Sidebar duplication now copies comments as well as assets. Copies map anchors across title/frontmatter changes and new asset IDs. A real policy-server regression test covers replies, resolution, independent thread IDs, transformed positions and orphaned exports. Preview verifies mapped text before applying highlight offsets, falling back to quote/context recovery when media segmentation changes rendered offsets.

Validation: `bun run check:types` has zero errors; `check:lint` has zero errors and 142 style warnings; `check:test` passes 69 files / 768 tests. Changed integration files pass Prettier. All five unchanged-assertion cases in `e2e/auth.spec.ts` and `e2e/doc.spec.ts` pass against a stable Work server with two workers and a 120-second timeout.

Work setup/start both used `--tailscale`; the stale Classic `sync` command was stopped. Runtime: https://web-jazz-v2-migration-alkalye.cshed.carlassmann.com

Background agent-browser profiles `merge-2c-a` and `merge-2c-b` exercised:

- Image upload/insert plus a comment created through the selection dialog. Preview decodes the Blob image and highlights the exact quote, including an image immediately before a heading.
- Settings' Themes section creates a custom theme. Its original workbench saves a heading-color override. Preview and slideshow render `Custom theme 1` with the expected `rgb(190, 30, 60)` heading color. Settings' Connections category displays the MCP connection panel.
- Recovery into the second independent browser profile. A's teleprompter starts the presentation and changes B's slideshow to slide 2. A's real pointer drag on the laser surface creates a visible red SVG trail in B; the themed slideshow also decodes its image.
- Time machine browses an earlier edit and restores it through the confirmation dialog. The editor retains its image and comment after returning. The duplicate dialog creates independent asset IDs; its preview still decodes the image, applies the theme and highlights the copied comment correctly.

Screenshots: `/tmp/alkalye-2c-merge-smoke/` (`slideshow-theme-laser.png`, `teleprompter.png`, `copy-preview.png`). Existing Base UI native-button/slider warnings remain. Vite hot reload during integration also invalidated open profiles; restarting Work after type checks and reloading cleared that state. Cloud deployment, the Classic importer and the sharing/spaces branch remain outside this merge. No push or PR.

- 2026-11-13, phase 2C integration: merged assets/themes/onboarding with comments/time-machine/presentation and MCP settings; added the thumbnail migration, shared copy/comment anchor handling and preview highlight recovery; types/lint, 768 tests, five auth/document e2e cases and two-profile browser smoke checks pass. Commit: phase-2C integration merge.

written with gpt-6.1-sol in T3 Code (Codex)
