# Alkalye on Jazz v2: port report

Classic Jazz 0.20.18 → `jazz-tools@2.0.0-alpha.61`, branch `jazz-v2-migration`, PR https://github.com/carlassmann/alkalye/pull/75 (head `75a303b`, 133 commits, 386 files, +66.7k/−28.5k lines). Audience: Carl (Alkalye's author) and the Jazz team (actionable feedback). This is an exploration; it will not ship as is.

## TL;DR

- Feature-complete port on stock Jazz (published Wasm + SDK, one 50-line backend JS patch). All 862 unit/integration tests and 17 production e2e cases pass; local CI signs off on `75a303b`.
- Wins: first large doc 11.35 s → 1.24 s, first list 7.44 → 1.46 s, IndexedDB 103.5 → 1.9 MB, ZIP import 42 → 19 s, ~3k lines of Classic workaround code deleted, permissions are declarative policies with real tests.
- Regressions: large-note typing p95 34 → 84 ms with 47 long tasks per 200 edits (Classic: 1); first load +0.5 MB Brotli; E2EE gone; CLI offline mode gone; public-space bookmarks not restored.
- Not shipping: v2 has no end-to-end encryption, and Alkalye's synced notes are E2EE today. Dropping it was an exploration shortcut, not an acceptable product change. E2EE in v2 is ask #1.
- If E2EE existed, remaining gaps: large-note typing (upstream engine work, ask #2), the backend auth patch (ask #3), and an untested production path (Jazz Cloud, Vercel, installed-PWA cutover).

## Numbers

Stock Jazz, five alternating fresh-account runs each, local production Node backends, Chromium 145, Brotli q6. Dataset: 50 Vite notes + Alice (171 KB) + Dracula (875 KB); 200 edits per note size per run. Median / p95.

| Metric                                  |  Classic 0.20.18 |     v2 alpha.61 |
| --------------------------------------- | ---------------: | --------------: |
| ZIP import + resolve                    |  42.38 / 63.46 s | 19.22 / 20.88 s |
| First usable list                       |    7.44 / 7.59 s |   1.46 / 1.64 s |
| Warm list                               |    2.76 / 3.01 s |   0.72 / 0.77 s |
| First large document                    |  11.35 / 12.39 s |   1.24 / 1.31 s |
| Fresh-device exact export               |  20.09 / 20.72 s | 12.07 / 12.43 s |
| Small-note sync                         |     293 / 325 ms |    202 / 224 ms |
| IndexedDB after import                  | 103.5 / 181.7 MB |  1.88 / 1.90 MB |
| First-load JS+Wasm, Brotli              |          2.96 MB |         3.46 MB |
| Small typing, dispatch → double-rAF     |   33.3 / 34.5 ms |  33.7 / 46.5 ms |
| Large typing, dispatch → double-rAF     |   33.3 / 34.1 ms |  34.1 / 83.6 ms |
| Large long tasks / 200 edits            |            1 / 1 |         47 / 54 |
| 5,000-edit large note, p95 / long tasks |     50.1 ms / 51 |   88.0 ms / 986 |
| 5,000-edit main-page JS heap            |           468 MB |           93 MB |

Method caveats: ~33 ms is the double-rAF floor at 60 Hz, so medians are at the floor for both; these are whole-app timings (v2 includes a 100/140 ms write coalescer, Classic a 250 ms save debounce), not protocol latency; host load uncontrolled; local backends, not Jazz Cloud. Stock CPU sampling attributes 10.8 ms page Wasm per large-note edit (SHA-256 3.9, materialization 1.7, UTF-8 validation 1.0) plus 11.6 ms page JS. Full method: `docs/benchmarks/jazz-classic-vs-v2.md`.

Removed experiment: an engine (Wasm rebuild) + SDK patch at `94fc4ed` brought large-note typing to 33.4 / 41.0 ms with 0 long tasks (5,000-edit case still 82.9 ms p95). Carl rejected forking Jazz; it was removed and recorded as an upstream proposal.

## What v2 made simpler

Deleted from Classic (not ported): `document-generations.ts` (513 lines), `incremental-document-save.ts` (238), save worker + protocol + background save (299), `document-move.ts` (184), `src/schema/migrations.ts` (345 + 904 test lines); `spaces.ts` shrank 708 lines. Specifically:

| Classic mechanism                                                              | v2 replacement                                                                                                 |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Group-per-document, invite Groups, group extension/revocation on move          | 28 relational tables + `permissions.ts` (277 lines) policies; move keeps the doc ID, backend changes `spaceId` |
| Invite secrets as Group members                                                | `invites` table with hashed token, single-use redemption in a serializable backend transaction                 |
| Content generations, compaction, archived content                              | `s.string().merge("markdown")` with `editedFrom`; metadata and text queried separately                         |
| Entry-ID incremental save, save worker, bounded transaction patching           | Direct writes with local durability receipts                                                                   |
| Account-root rotation, `migrationVersion`, metadata backfill, cold-read guards | Schema migrations graph; none of this exists                                                                   |
| CoFeed cursors, laser hub + sender rotation                                    | `.history("latest")` tables for presence/cursors/laser                                                         |
| Comment anchors via CoList plumbing                                            | `db.textAnchors()` ranges stored as JSON                                                                       |

Other wins: policy tests cover impersonation, self-escalation, moves, invite races against a real backend; one Astro catch-all route hosts the backend (`/jazz/[...path]`); Classic 24-word phrases restore v2 accounts unchanged (same 32-byte seed, different account IDs); `$history` gives time machine for free.

## Where v2 hurt, ranked

| #   | Symptom                                                                                                                                                                                | Root cause in Jazz                                                                                                                                                                                                                                     | Current workaround                                                                                                                                                               | Ask                                                                                                                                                                                                                                               |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Large-note typing p95 84 ms, 47 long tasks / 200 edits; 986 in the 5,000-edit case                                                                                                     | Every TEXT write/subscription converts, materializes and SHA-256-hashes the full string on the page thread; public splice subscriptions still deliver whole rows; `applyDiffs` has no atomic stale-base check so every write carries full `editedFrom` | Metadata-only library query, isolated content subscription with `splices`, 100 ms post-paint write coalescer (140 ms fallback), stale-echo filtering, retained query projections | Cache validated materialization by descriptor; delta subscriptions; version-guarded splice write or verified `editedFrom` hint with merge fallback; move optimistic engine work off the page. `docs/jazz-v2-issues/large-text-materialization.md` |
| 2   | Custom routes (sharing, import, CLI) and MCP cannot act as a device account                                                                                                            | `forReqUser` routes through external `authenticate`; `acceptDeviceAccounts` returns null there. No in-process `forUser(accountId)`                                                                                                                     | 50-line patch on `dist/backend/create-jazz.js`: proof/origin/audience/admission verification in `forReqUser`, `forUser` via `backendDbForSession` (policies still enforced)      | Ship device-proof auth for custom routes and trusted account delegation. `docs/jazz-v2-issues/device-account-backend.md`                                                                                                                          |
| 3   | CLI `--offline`/`--local` removed                                                                                                                                                      | Node path of the Wasm runtime opens a direct runtime without row persistence; `createAccountManager` requires an `AccountStore` outside the browser; no documented recipe                                                                              | Online-only CLI: origin-bound 0600 key file, per-command device proof to `/api/cli`                                                                                              | Documented Node/Bun device-account persistence + offline restart recipe. `docs/jazz-v2-issues/node-persistence.md`                                                                                                                                |
| 4   | Fixed text-range subscription dies when text shrinks (`value range is out of bounds`), never resumes                                                                                   | Strict range check in query layer                                                                                                                                                                                                                      | Whole-value subscription + splice metadata                                                                                                                                       | Clamped ranges or recoverable range errors. Repro: `bun docs/jazz-v2-issues/range-query-repro.ts`. `docs/jazz-v2-issues/range-queries.md`                                                                                                         |
| 5   | Schema branches could not be merged: "lenses from 2 versions disagree on where `classicAccess.classicId` comes from"                                                                   | `lenses_agree` rejects differing column origins even when shapes match; history → `latest` needs `allowDroppingHistory`                                                                                                                                | Regenerated one foundation snapshot, reset disposable stores (dev-only; not a production strategy)                                                                               | Detect at schema validation, document convergence/repair. `docs/jazz-v2-issues/schema-migrations.md`                                                                                                                                              |
| 6   | Dev auth admission 11 s, fresh-profile recovery 20.3 s under Vite                                                                                                                      | Vite leaves the WS upgrade unanswered; `SOCKET_OPEN_DEADLINE_MS = 10_000` before the HTTP-stream probe                                                                                                                                                 | 21-line dev plugin returns 426 on `/jazz/apps/*/ws` → 1.1 s / 0.6 s                                                                                                              | Explicit stream selection or concurrent discovery. `docs/jazz-v2-issues/auth-transport.md`                                                                                                                                                        |
| 7   | Identical 8.8 MB Wasm emitted at two URLs + unused broker-worker asset; raw first load was ~20.8 MB                                                                                    | Page glue and worker each resolve their own Wasm URL under Vite                                                                                                                                                                                        | `assetFileNames` alignment, precache ignore, Brotli → 3.46 MB (still +0.50 MB vs Classic)                                                                                        | Single shared Wasm URL, documented Vite/PWA config (`optimizeDeps.exclude` jazz-tools/jazz-wasm, SSR externals). `docs/jazz-v2-issues/duplicate-wasm-assets.md`                                                                                   |
| 8   | Latest-only tables unreadable in serializable transactions; >64 KiB values rejected; unchanged projections re-emit new identities; empty transactions and `restore` of live rows throw | Documented nowhere; found via upstream tests                                                                                                                                                                                                           | Don't touch presence in deletion tx; 48 KiB import chunks; `use-stable-rows` deep-equality at React boundary; skip empty tx; `update` vs `restore` branching                     | Document contracts; preserve unchanged snapshot identity. `docs/jazz-v2-issues/latest-history-and-projections.md`                                                                                                                                 |

Not Jazz's fault but cost days: Chromium `ERR_INSUFFICIENT_RESOURCES` was `/tmp` quota exhaustion (`docs/browser-resource-failures.md`); Classic binary headers resolve before chunks arrive, importer waits for `toBlob()`.

## For Carl: what shipping would take

1. E2EE in v2 (upstream; see ask #1). Without it the port trades Alkalye's privacy guarantee for speed.
2. Large-note typing at Classic parity (ask #2), or accepting p95 84 ms / 47 long tasks per 200 edits on 800 KB notes. Small/medium notes are fine.
3. Production setup and checks: Classic production sync URL + key for the importer; Jazz Cloud v2 `JAZZ_APP_ID` / `JAZZ_SERVER_URL` / `JAZZ_ADMIN_SECRET`; Vercel build; installed-PWA cutover. All untested.
4. A fresh security review of whatever the E2EE design changes (sharing, importer, MCP).

Regressions users would notice:

- Sync no longer E2EE; backend and Jazz Cloud read everything (changelog #169, README, landing, auth banner already say so).
- Old invite links dead; MCP/agent connections must be recreated.
- CLI `--offline`/`--local` error out.
- "Add to my spaces" bookmarks for public spaces not restored (no per-user space-list table).
- Imported Classic history credits the importing account, not original authors (browser supplies plaintext; signed ACLs can't prove plaintext matches ciphertext). Comment authors are remapped to the importer when they claim.
- Removed historical assets not exhaustively crawled; imports >512 MiB per upload or >1 GiB in flight per account fail.

Risks:

- Alpha pin: `2.0.0-alpha.61` exact; any upgrade may need schema/lens work (see row 5 above).
- Backend patch: 50 lines against `dist/` of the SDK via Bun `patchedDependencies`. Breaks silently on every upstream bump until ask #3 lands. It is the only thing between a forged proof and a policy-scoped DB; `device-routes.test.ts` covers forged/expired/foreign-audience/foreign-origin proofs.
- Server-trusted model + importer widened the attack surface. Independent reviews found and the branch fixed: stale-invite re-admission, import merge bases readable after revocation, stale Classic ACL re-grants (incl. already-activated grants), space writers self-escalating to doc admin, Classic readers forging authoritative import text, laser/presentation control injection, CLI move ownership, upload storage exhaustion. All have regression tests (`access.test.ts`, `server.test.ts`, `operations.test.ts`, `permissions.test.ts`). Expect more of this class.
- `jazz-tools-classic` (0.20.18) stays a dependency for the importer; removal date = when Classic sync is shut down.

## Asks to Jazz, prioritised

1. End-to-end encryption in v2: a supported way to keep row/text content (including mergeable markdown) encrypted client-side while sharing, policies and merging still work. This is what blocks Alkalye from moving.
2. Large TEXT: cached materialization, delta subscriptions, version-guarded splice write. `docs/jazz-v2-issues/large-text-materialization.md` (repro `large-text-repro.ts`; removed engine patch at `94fc4ed` shows 0 long tasks is reachable).
3. `forReqUser` device proofs + in-process `forUser(accountId)`. `docs/jazz-v2-issues/device-account-backend.md` (tests: `src/jazz/device-routes.test.ts`, `src/mcp/server.test.ts`).
4. Node/Bun persistent device-account client recipe. `docs/jazz-v2-issues/node-persistence.md`.
5. Range subscriptions surviving shrink. `docs/jazz-v2-issues/range-queries.md` (`range-query-repro.ts`).
6. Lens-origin conflict detection + history-mode migration docs. `docs/jazz-v2-issues/schema-migrations.md`.
7. HTTP-stream discovery without the 10 s WS deadline. `docs/jazz-v2-issues/auth-transport.md` (standalone repro, no Alkalye code).
8. One Wasm URL + documented Vite/PWA config. `docs/jazz-v2-issues/duplicate-wasm-assets.md`.
9. Document latest-only/transaction/restore contracts; stable unchanged snapshots. `docs/jazz-v2-issues/latest-history-and-projections.md`.

Code map for reviewers: `src/jazz/schema.ts`, `src/jazz/permissions.ts`, `src/jazz/server.ts`, `src/jazz/sharing/operations.ts`, `patches/jazz-tools@2.0.0-alpha.61.patch`, `src/app/features/documents/lib/{codemirror-sync,library}.ts(x)`, `src/app/features/classic-import/`, `src/cli/runtime.ts`, `scripts/jazz-dev-transport.ts`, `astro.config.ts`.

written with claude-fable-5-1 and claude-opus-5-5 in T3 Code
