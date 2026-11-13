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
