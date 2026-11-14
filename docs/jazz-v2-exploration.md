# Exploring Jazz v2 in Alkalye

This PR explores `jazz-tools@2.0.0-alpha.61` in Alkalye, a local-first Markdown
PWA previously using Classic Jazz 0.20.18. The port covers the editor, shared
documents/spaces, comments, media/whiteboards, themes, presentations, history,
local files and agent/MCP/CLI access. Existing Classic users import automatically.
Offline CLI editing and public-space bookmarks remain gaps.
[Dependencies](../package.json), [routes](../src/app/routes),
[CLI](../src/cli/runtime.ts),
[import controller](../src/app/features/classic-import/migration-notice.tsx),
[bookmark limitation](jazz-v2-migration.md#phase-3-integration-into-the-migration-branch).

End-to-end encryption was intentionally dropped. Alkalye's backend and Jazz
Cloud can read synced data. The browser uses Jazz's local-first SharedWorker
and IndexedDB path. Astro hosts the backend, using SQLite locally and a remote
Jazz store in the production configuration. [Disclosure](../README.md),
[browser setup](../src/app/main.tsx), [backend](../src/jazz/server.ts),
[PWA caching](../astro.config.ts).

The alpha version is pinned. Recorded stock-runtime validation passed all
862 unit/integration tests in 84 files and all 17 production-build e2e cases.
The port has not deployed to production; Cloud and installed-PWA Classic
cutovers remain untested. [Validation record](../bench/results/stock-diagnostics.json),
[e2e cases](../e2e),
[cutover limits](jazz-v2-migration.md#security-follow-up-validation).

## How Alkalye maps onto v2

### Tables and policies

The [schema](../src/jazz/schema.ts) has 28 tables. `documents` owns mergeable
Markdown and saved list metadata; `userDocuments` and `folders` hold each user's
private organization. `spaces`, `spaceMembers`, `documentGrants` and `invites`
model shared access. Other tables cover comments/replies, assets/whiteboard
revisions, themes/assets, settings/profiles, connections, import state and
imported document versions.

[Policies](../src/jazz/permissions.ts) replace Classic group ownership and
inheritance. Documents inherit space reads; writer/admin predicates include
explicit grants and space membership. Client updates cannot change document
owner or space, or elevate ordinary writers through administrative fields.
Memberships, grants, invites and import state reject direct client writes.
[Policy tests](../src/jazz/permissions.test.ts) cover roles and impersonation.

Classic required invite groups and group/asset access changes when moving a
document. V2 replaces those paths with relational policies and trusted row
updates. Classic also had cold-read guards, account-root rotation, bounded text
generations/compaction, incremental entry-ID saves and a save worker. That
machinery is deleted; v2 queries metadata separately from text. Compare Classic
[moves](https://github.com/carlassmann/alkalye/blob/4319a45/src/app/features/documents/lib/document-move.ts),
[invite groups](https://github.com/carlassmann/alkalye/blob/4319a45/src/app/features/spaces/lib/spaces.ts),
[account migration](https://github.com/carlassmann/alkalye/blob/4319a45/src/schema/migrations.ts),
[text generations](https://github.com/carlassmann/alkalye/blob/4319a45/src/app/features/documents/lib/document-generations.ts)
and [incremental save](https://github.com/carlassmann/alkalye/blob/4319a45/src/app/features/documents/lib/incremental-document-save.ts)
with the v2 [library](../src/app/features/documents/lib/library.tsx) and
[sharing operations](../src/jazz/sharing/operations.ts).

### Trusted sharing operations

The [sharing route](../src/pages/api/sharing/[action].ts) authenticates a device
proof through patched `forReqUser`. [Backend transactions](../src/jazz/sharing/operations.ts)
check the verified account's current authority, then create/redeem hashed
invites, revoke derived grants, change roles or move a document while retaining
its ID. Single-use redemption is serializable. These operations require the
backend; ordinary editing remains local-first.
[Sharing tests](../src/jazz/sharing/operations.test.ts).

### Markdown, comments, history and presence

`documents.content` uses `s.string().merge("markdown")`. The
[CodeMirror binding](../src/app/features/documents/lib/codemirror-sync.ts) keeps
the original editor base for `editedFrom`, handles stale echoes and IME, and
applies incoming splices/minimal diffs without adding remote edits to local undo.
The [content subscription](../src/app/features/documents/hooks/use-document-content.ts)
requests splice metadata. The [write queue](../src/app/features/documents/lib/library.tsx)
coalesces visible typing for 100 ms after its first frame, with a 140 ms fallback.
Buffered edits are not durable until submitted; saved events wait for
[local receipts](../src/app/features/documents/lib/writes.ts).
[Binding tests](../src/app/features/documents/lib/codemirror-sync.test.ts),
[batching/stale-base tests](../src/app/features/documents/lib/library.test.ts),
[convergence e2e](../e2e/document-collab.spec.ts).

Comments store `db.textAnchors()` ranges in JSON with quote/context recovery.
Time machine combines accepted v2 `$history` with imported `documentVersions`.
Presence, cursors and laser messages use `.history("latest")`, replacing
Classic feeds and sender rotation. See [schema](../src/jazz/schema.ts),
[comments](../src/app/features/comments/lib/comments.ts),
[time machine](../src/app/features/time-machine/lib/time-machine.ts),
[presence](../src/app/features/sharing/lib/presence.ts) and
[laser transport](../src/app/features/presentation/lib/laser-channel.ts).

### Device accounts and service access

A guest is already a device account. Backup exports its key as 24 BIP39 English
words; restore derives the same key. Classic phrases encode the same 32-byte
seed, so users keep their words, although v2 account IDs differ. Existing
`jazz-logged-in-secret` credentials also trigger automatic restoration.
[Auth UI](../src/app/features/auth/widgets/auth-form.tsx),
[seed conversion](../src/app/features/classic-import/identity.ts),
[compatibility/proof tests](../src/app/features/classic-import/conversion.test.ts).

The browser approves MCP connections using audience-bound device proofs, without
sending its seed. MCP later validates a revocable connection and uses patched
`forUser(accountId)` for policy-scoped operations. The CLI keeps an origin-bound
key file with mode 0600, mints proofs and calls `/api/cli` through `forReqUser`.
[Proof creation](../src/app/features/agents/lib/agent-api.ts),
[MCP authorization](../src/mcp/jazz.ts), [CLI runtime](../src/cli/runtime.ts),
[route authentication tests](../src/jazz/device-routes.test.ts).

### Classic importer

The [controller](../src/app/features/classic-import/migration-notice.tsx) detects
Classic credentials or phrase recovery and imports with progress and retry.
The [reader](../src/app/features/classic-import/reader.ts) flushes unsynced
Classic writes and visits retired account roots, retaining late offline
documents. The [client](../src/app/features/classic-import/client.ts) submits
snapshots; deterministic IDs and backend-only maps make retries resumable.
[Conversion](../src/app/features/classic-import/conversion.ts) rewrites links
and checks byte hashes. Classic runtime dependencies stay inside the importer.
[Import contract](../src/app/features/classic-import/contract.ts).

The backend verifies a nonce signed by the Classic account's founding agent,
then independently reads signed Classic groups to derive ACLs and ownership.
A writer/admin must submit the first snapshot; readers can claim an already
completed import. Reconciliation removes/demotes Classic-derived grants while
preserving later v2 removals and independent grants. Later Classic text uses the
last import as its `editedFrom` ancestor.
[Verification](../src/app/features/classic-import/verification.ts),
[authorization](../src/app/features/classic-import/authorization.ts),
[server](../src/app/features/classic-import/server.ts),
[access regressions](../src/app/features/classic-import/access.test.ts).

The browser supplies decrypted plaintext. Signed ACLs and checksums do not prove
that plaintext matches Classic ciphertext. Imported text history therefore
credits the authenticated importing account, not submitted author names.
Classic invites and agent/MCP credentials do not transfer; users reconnect.
Removed historical assets are not exhaustively crawled. Uploads/envelopes
materialize in memory, with a 512 MiB per-upload bound, 1 GiB account reservations
and activity-driven expiry cleanup.
[Server regressions](../src/app/features/classic-import/server.test.ts),
[uploads](../src/app/features/classic-import/uploads.ts),
[reader](../src/app/features/classic-import/reader.ts),
[cutover assertions](../scripts/fixtures/classic-cutover-checks.js),
[reconnection disclosure](../src/shared/intl/messages.auth.ts).

## What worked well

- Startup and storage improved on the measured dataset: first large-document
  median 11.35 → 1.24 s; first list 7.44 → 1.46 s; IndexedDB after import
  103.53 → 1.88 MB. Exact exports validate every file. These are whole-app results,
  including the new data model. [Stock benchmark](benchmarks/jazz-classic-vs-v2.md).
- Policies make ownership and role boundaries explicit. Real backend tests cover
  public/space access, impersonation, guarded moves and invite races without
  reintroducing group manipulation. [Policies](../src/jazz/permissions.ts),
  [policy tests](../src/jazz/permissions.test.ts),
  [sharing tests](../src/jazz/sharing/operations.test.ts).
- Original-base text writes serve both the editor and late Classic imports.
  Tests assert simultaneous, rapid same-position and offline Unicode convergence
  with exact reload checks. [Collaboration e2e](../e2e/document-collab.spec.ts),
  [import tests](../src/app/features/classic-import/server.test.ts).
- Astro hosts Jazz as a fetch route with HTTP streaming. The production e2e run
  includes offline guest restore. [Backend route](../src/pages/jazz/[...path].ts),
  [cache configuration](../astro.config.ts), [auth e2e](../e2e/auth.spec.ts),
  [recorded result](../bench/results/stock-diagnostics.json).

## Friction and gaps, ranked by impact on Alkalye

| Priority | What we hit and evidence                                                                                                                                                                                                                                                | Current workaround                                                                                                                                 | Concrete ask                                                                                               |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 1        | Large TEXT edits/subscriptions still convert, materialize and hash full strings. Large typing p95 is 83.55 ms vs Classic's 34.05; long tasks are 47 / 54 vs 1 / 1 per 200-edit case. [Issue/profile](jazz-v2-issues/large-text-materialization.md).                     | Metadata-only library, isolated content subscription, batching and retained projections.                                                           | Cache validated materialization, avoid full-scalar subscription conversion, move engine work off the page. |
| 2        | `forReqUser` does not accept device proofs; in-process `forUser` is missing. Custom routes and MCP need both. [Issue/tests](jazz-v2-issues/device-account-backend.md).                                                                                                  | The [SDK patch](../patches/jazz-tools@2.0.0-alpha.61.patch) verifies proof/origin/audience/admission and delegates through policy-scoped contexts. | Ship device authentication for custom routes and trusted account delegation.                               |
| 3        | `applyDiffs` cannot atomically check the editor's stale base for the same text column. [API evidence](jazz-v2-issues/large-text-materialization.md#current-workaround).                                                                                                 | Keep complete `editedFrom` replacements; no positional-write shortcut.                                                                             | Version-guarded splice writes or verified hints with merge fallback.                                       |
| 4        | Alkalye's CLI has no persistent local replica; offline/local options fail explicitly. Its error overstates the SDK limitation. [Integration request](jazz-v2-issues/node-persistence.md).                                                                               | Online proof-authenticated commands; local file rendering.                                                                                         | A supported Node/Bun device-account persistence/restart/offline recipe.                                    |
| 5        | Fixed text-range reads error rather than clamp when text shrinks, terminating subscriptions. [Executed repro](jazz-v2-issues/range-queries.md).                                                                                                                         | Whole-value subscription plus splice metadata.                                                                                                     | Clamped windows or recoverable range subscriptions.                                                        |
| 6        | Schema integration rejected differing column origins through divergent lenses. Full history → latest also requires `allowDroppingHistory: true`; the latter is verified in upstream tests, not a retained app failure. [Evidence](jazz-v2-issues/schema-migrations.md). | Combined foundation and disposable-store resets before production; retain final additive migration.                                                | Validate branch convergence early; document safe repair/history transitions.                               |
| 7        | Vite leaves Jazz upgrades unanswered, delaying HTTP fallback by 10 s; representative dev recovery was 20.348 s. [Repro/data](jazz-v2-issues/auth-transport.md).                                                                                                         | Dev-only upgrade rejection; recovery became 0.622 s in that sample. Node preview was already below 1 s.                                            | Explicit streaming selection or concurrent capability discovery.                                           |
| 8        | Page/worker builds emitted identical Wasm at distinct URLs and an unused broker-worker asset. [Packaging issue](jazz-v2-issues/duplicate-wasm-assets.md).                                                                                                               | Match asset names, prune unused precache entry, compress assets. Final first load still exceeds Classic by about 0.50 MB.                          | One shared asset URL and supported Vite/PWA packaging.                                                     |
| 9        | Latest-only tables reject snapshot reads and chunked values; unchanged projections can still invalidate consumers. [Contracts/evidence](jazz-v2-issues/latest-history-and-projections.md).                                                                              | Avoid transactional presence cleanup, use small upload chunks, retain equivalent React results.                                                    | Document latest-only limits and retain unchanged selected snapshots.                                       |

Vite also needs `jazz-tools` and `jazz-wasm` excluded from prebundling, with
`jazz-napi`/`jazz-tools` externalized for SSR. Checks/builds invalidated optimized
dependency hashes during development; restarting dev restored them.
[Configuration](../astro.config.ts),
[observations](jazz-v2-migration.md#alpha61-findings-and-remaining-work).
Include this in Vite setup guidance. The
[package findings](jazz-v2-migration.md#package-findings) also record Classic
binary headers arriving before complete blobs; the importer waits for `toBlob()`
and uses `restore` for tombstoned upload IDs. These are handled integration
contracts. [Reader](../src/app/features/classic-import/reader.ts),
[chunk reuse test](../src/app/features/classic-import/server.test.ts).

A separate Chromium `ERR_INSUFFICIENT_RESOURCES` failure came from `/tmp` user
quota exhaustion, verified by `fallocate` returning `EDQUOT`. Changing browser
`TMPDIR` fixed it without changing Jazz. It is excluded from Jazz findings.
[Diagnosis](browser-resource-failures.md).

## Performance

Five alternating fresh-account runs per implementation, local production Node backends, Chromium 145, Brotli q6, fresh first-load contexts with HTTP caching enabled and SW blocked.
Dataset: 50 Vite notes, Alice and Dracula, 52 files / 1,595,667 bytes; 200 edits per size/run, 25 sync markers, plus one 5,000-edit large-note case each. [Methodology](benchmarks/jazz-classic-vs-v2.md#method-and-reproduction).

Stock Jazz means published SDK/Wasm with the auth-only backend patch and app
optimizations. Values are median / p95; MB is decimal. Results:
[Classic](../bench/results/stock-classic.json), [v2](../bench/results/stock-v2.json),
[Classic stress](../bench/results/stock-classic-5000.json),
[v2 stress](../bench/results/stock-v2-5000.json).

| Metric                                   |    Classic 0.20.18 |  Stock v2 alpha.61 |
| ---------------------------------------- | -----------------: | -----------------: |
| ZIP import + resolve                     |    42.38 / 63.46 s |    19.22 / 20.88 s |
| First usable list                        |      7.44 / 7.59 s |      1.46 / 1.64 s |
| Warm list                                |      2.76 / 3.01 s |      0.72 / 0.77 s |
| First large document                     |    11.35 / 12.39 s |      1.24 / 1.31 s |
| Fresh-device exact dataset export        |    20.09 / 20.72 s |    12.07 / 12.43 s |
| Small-note sync                          | 292.99 / 325.33 ms | 201.82 / 223.66 ms |
| IndexedDB after import                   | 103.53 / 181.69 MB |     1.88 / 1.90 MB |
| First-load JS/Wasm, Brotli               |     2.96 / 2.96 MB |     3.46 / 3.46 MB |
| Small typing, dispatch → double-rAF      |   33.31 / 34.52 ms |   33.69 / 46.45 ms |
| Large typing, dispatch → double-rAF      |   33.31 / 34.05 ms |   34.05 / 83.55 ms |
| Large long tasks / 200 edits             |              1 / 1 |            47 / 54 |
| 5,000-edit typing, dispatch → double-rAF |   33.42 / 50.12 ms |   34.03 / 87.96 ms |
| 5,000-edit long tasks, one case          |                 51 |                986 |

The roughly 33 ms double-rAF floor is part of this measurement. The stress case
includes 26,401 Arrow movements in whole-window long tasks, but excludes cursor
positioning from input latency. One Classic attempt timed out before its first
progress marker and was replaced; no latency outlier was excluded. Host load
was uncontrolled. Sync includes v2 batching and Classic's 250 ms save debounce,
so these are app comparisons, not protocol latency.
[Report](benchmarks/jazz-classic-vs-v2.md),
[excluded attempt](../bench/results/stock-diagnostics.json).

An engine-patch experiment was explored, then removed. At historical `94fc4ed`,
large-note typing was 33.39 / 40.98 ms with 0 / 0 long tasks; its contemporaneous
Classic run was 33.32 / 33.78 ms with 1 / 1 tasks. Its single stress case still
had p95 82.90 ms and 1,077 long tasks. It combined app changes, validated-scalar
caching, bounded text tails, verified edit hints and query snapshot reuse.
Nothing in the current repo depends on those engine changes. These results
support an upstream proposal; they do not isolate individual optimizations.
[Proposal/implementation references](jazz-v2-issues/large-text-materialization.md#removed-engine-experiment),
[historical v2](../bench/results/final-v2.json),
[historical Classic](../bench/results/final-classic.json),
[historical stress](../bench/results/final-v2-5000.json).

## Prioritized asks for the Jazz team

1. [Large TEXT editing](jazz-v2-issues/large-text-materialization.md): reduce full-string work and provide safe delta reads/writes while retaining stale-base merging.
2. [Device-account backend APIs](jazz-v2-issues/device-account-backend.md): replace the auth patch with supported proofs and account delegation.
3. [CLI persistence](jazz-v2-issues/node-persistence.md): document a durable Node/Bun device-account client and offline restart/reconnect flow.
4. [Range subscriptions](jazz-v2-issues/range-queries.md): keep read windows alive across text shrinkage.
5. [Migration workflows](jazz-v2-issues/schema-migrations.md): detect conflicting column origins early and document safe convergence/history changes.
6. [HTTP transport discovery](jazz-v2-issues/auth-transport.md): avoid silent-upgrade delays in fetch-only hosts.
7. [Vite/PWA assets](jazz-v2-issues/duplicate-wasm-assets.md): share the Wasm URL and document prebundling/SSR configuration.
8. [Latest-only and query contracts](jazz-v2-issues/latest-history-and-projections.md): document ephemeral-data limits and retain unchanged snapshots.

## Where to look in the PR

| Concern                 | Files                                                                                                                                                                                                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contract and access     | [Schema](../src/jazz/schema.ts), [policies](../src/jazz/permissions.ts), [migration graph](../src/jazz/migrations/index.ts)                                                                                                                                       |
| Backend/auth            | [Server](../src/jazz/server.ts), [SDK patch](../patches/jazz-tools@2.0.0-alpha.61.patch), [device route tests](../src/jazz/device-routes.test.ts)                                                                                                                 |
| Sharing                 | [Trusted operations](../src/jazz/sharing/operations.ts), [tests](../src/jazz/sharing/operations.test.ts)                                                                                                                                                          |
| Editor/queries          | [CodeMirror](../src/app/features/documents/lib/codemirror-sync.ts), [subscription](../src/app/features/documents/hooks/use-document-content.ts), [write queue](../src/app/features/documents/lib/library.tsx), [stable rows](../src/app/hooks/use-stable-rows.ts) |
| Classic cutover         | [Importer](../src/app/features/classic-import), [runner](../scripts/qa-classic-migration.ts), [assertions](../scripts/fixtures/classic-cutover-checks.js)                                                                                                         |
| MCP/CLI                 | [MCP authorization](../src/mcp/jazz.ts), [CLI](../src/cli/runtime.ts)                                                                                                                                                                                             |
| Build/transport         | [Astro/Vite/PWA](../astro.config.ts), [dev transport](../scripts/jazz-dev-transport.ts), [benchmark serving](../scripts/bench/serve-production.ts)                                                                                                                |
| Measurements            | [Report](benchmarks/jazz-classic-vs-v2.md), [results](../bench/results), [issues/repros](jazz-v2-issues)                                                                                                                                                          |
| Historical observations | [Migration log](jazz-v2-migration.md), [browser resource diagnosis](browser-resource-failures.md)                                                                                                                                                                 |

written with gpt-6.1-sol in T3 Code (Codex)
