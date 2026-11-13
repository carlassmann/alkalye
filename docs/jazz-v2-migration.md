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
- 2026-11-13, phase 1 Classic retirement: deleted Classic-bound modules and their tests, including account migrations, generations/compaction, incremental save/worker/protocol, text caches, reconciliation and laser rotation. Deferred features expose `v2-todo` barrels; MCP/OAuth/discovery return 503 and CLI exits explicitly. Portable editor, presentation, theme and filesystem helpers remain. Recover old feature implementations from git for phase 2. Commit: retire Classic runtime.

- 2026-11-13, phase 1 client: v2 provider/device accounts, existing recovery UI, document library, personal folders/pins, keyed CodeMirror binding with immediate `editedFrom` writes, minimal incoming diffs, mapped selections and IME handling. Kept wikilink decorations/autocomplete and derive backlinks from readable content. Browser navigation exposed duplicate sibling keys; fixed and verified one toolbar after switching. Nineteen policy tests and four editor-binding tests pass. Commit: v2 account and document UI.

## Phase 1 handoff

The reviewed shared contract is `src/jazz/schema.ts` with 21 tables. Settings JSON is typed in `src/jazz/value-types.ts`. The initial schema snapshot is committed. Subsequent schema changes must generate and import a migration graph before opening an existing store. The spike's disposable SQLite stores were preserved under `/tmp/alkalye-v2-foundation-spike-20261113` and `/tmp/alkalye-v2-pretyped-contract-20261113`; the final contract uses this worktree's `.jazz/`.

### Runtime decisions

- Astro hosts Jazz successfully. Fetch streams provide the fallback transport; no separate sync service is needed.
- `ALKALYE_LOCAL_PREVIEW=1 bun x astro build` builds a Node standalone preview with local SQLite. The default build still targets Vercel and remote Jazz Cloud storage. This flag is for local validation only. Production requires cloud credentials and a browser-facing `JAZZ_PUBLIC_URL`.
- Offline validation used a separate temporary Work project in `/tmp/alkalye-v2-foundation-preview` pointing at this checkout's built Node server. Its URL was `https://web-preview-alkalye-v2-foundation.cshed.carlassmann.com`. The ordinary dev URL is `https://web-jazz-v2-migration-alkalye.cshed.carlassmann.com`.
- Work reads its command definitions from the primary checkout. Until this branch's `work.config.js` lands there, `work up --tailscale` still starts its old Classic sync command. Stop that unused command; the v2 app never connects to it. Both setup and startup were run with `--tailscale`.
- The foundation uses a small browser-history document router and an Astro catch-all app shell. TanStack feature routes were Classic-bound and must return with their feature ports.
- Backlinks are derived, not written into other documents' frontmatter. Personal folders and pins live in private rows. Document owner/space changes require a later trusted backend operation.
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

`v2-todo` markers identify agents, agents-mcp, assets, comments, import-export, importer, landing-demo, local-files, onboarding, presentation, settings, sharing, spaces, themes and time-machine. The schema covers their data; their Classic UI/runtime wiring has been removed. Presence/laser feature UI is part of sharing/presentation. Account preferences have a table but no settings UI. The static landing demo remains available. MCP/OAuth/discovery endpoints return 503; CLI exits with an explicit migration message. Pure helpers and tests remain for reuse; removed feature code remains in git history.

### Alpha.61 findings and remaining work

- Vite 6/7 needs both `jazz-tools` and `jazz-wasm` excluded from dependency prebundling. Concurrent `astro check`/build can invalidate a running dev server's optimized dependencies; restart it after checks if the browser reports stale dependency hashes.
- `exists.where` accepts objects, not callbacks. Use relationship inheritance for admin policies.
- Changing a schema with `migrations: "none"` after a store has opened fails with disconnected migration roots. Changing a typed JSON schema in place is unsupported. The initial contract was frozen after the spike; future changes need lenses.
- Astro requires a literal `export const prerender` for static analysis. Other new application code uses `let`.
- No cloud deployment was attempted. Phase 2 still needs trusted invite redemption, space reassignment and complete deferred feature UIs. Phase 3 must verify Classic membership claims before writing imports/grants. `classicImports`, invites and imported versions deliberately reject client writes.

- 2026-11-13, phase 1 validation/infra: final browser sequence and checks above pass. PWA precaches Wasm and worker; default Vercel and local Node builds succeed. Replaced encryption claims with server-readable sync disclosures and rewrote `docs/jazz.md`. Commit: v2 runtime validation and handoff.

written with gpt-6.1-sol in T3 Code (Codex)
