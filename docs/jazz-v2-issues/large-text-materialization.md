# Draft: large TEXT subscriptions and editedFrom block the browser main thread

Status: issue draft, not submitted. Jazz `2.0.0-alpha.61`.

Alkalye's production Dracula benchmark is 874,540 bytes. Before app changes,
200 edits produce 118/148 ms dispatch-to-double-rAF median/p95 and 15.8 seconds
of cumulative long tasks. Classic is 33/34 ms and 0.34 seconds. A fresh profile
reproduced 122/143 ms, 200 long tasks and 16.4 seconds of blocking.

The fresh main-page profile spends 4.53 seconds in `sha2::sha256::compress256`
and 2.17 seconds in `large_values::materialize_attempt`. Ancestors include
`values::from_sql`, `fanout::refresh_group` and database ticks. App word counting
also accounts for about 1.69 seconds. Compressed profiles and app measurements
are under `bench/results/profiles/optimization-*` and `v2-opt-*-profile.json`.

## Minimal reproduction

`large-text-repro.ts` uses one local-only table and one note, without React,
CodeMirror, presence, comments or a backend. Open it through a Vite app with
`jazz-tools` and `jazz-wasm` excluded from dependency optimization:

```js
let { runLargeTextRepro } =
	await import("/docs/jazz-v2-issues/large-text-repro.ts")
await runLargeTextRepro("whole")
await runLargeTextRepro("splices")
await runLargeTextRepro("none")
await runLargeTextRepro("window")
await runLargeTextRepro("whole", true)
```

Each case inserts 200 characters, awaits local durability and double-rAF, then
verifies the final full string. Subscription startup and terminal errors are
fatal. `window` selects only the first 128 UTF-16 units, not a full editor body.
Run cases separately or give browser evaluation a sufficiently long timeout.
These diagnostics are separate from the production benchmark.

Hardened diagnostic results for a 918,761-byte synthetic note, one 200-edit run
per case, with 201 successful subscription deliveries where enabled:

| Read mode               | Write mode                  |   Median / p95 |
| ----------------------- | --------------------------- | -------------: |
| Whole text              | `editedFrom`                | 50.0 / 66.9 ms |
| Whole text plus splices | `editedFrom`                | 50.0 / 66.8 ms |
| No subscription         | `editedFrom`                | 33.3 / 50.1 ms |
| Whole text              | `applyDiffs`, single writer | 33.4 / 50.2 ms |

These are development-module diagnostics with a double-rAF floor, not production
app timings or concurrent-write validation. Raw results: `bench/results/v2-text-repro.json`.

## Relevant source at the pinned tag

- `packages/jazz-tools/src/runtime/db.ts`: `editedFrom` lowers to a `text_edit`
  descriptor carrying the full replacement and base strings.
- `crates/jazz/layers/db/src/large_ops.rs`, `LargeValueUpdate::TextEdit`:
  materializes the current cell even when `current == edited_from`.
- `crates/jazz/layers/types/src/large_values/mod.rs`: materialization walks all
  leaves and validates metrics; chunk hashes use SHA-256.
- Public `Db.subscribe` still delivers the complete result with `splices`.
  Receiving a delta does not opt out of native full-value query work.

`applyDiffs` accepts bounded splices and can avoid whole replacement work.
It has no `editedFrom` equivalent. Offsets against a stale editor snapshot can
address different text after an unseen remote edit. The single-writer repro's
partial-write case is diagnostic, not a safe collaboration adapter.

Explicit range queries require an in-bounds end. An oversized full-document
range terminates the subscription; it cannot be used as a clamped whole-text
read. An early exploratory range result measured a dead subscription and was
discarded. A fixed valid window cannot supply the entire growing document.

## Requested Jazz changes and current workaround

Expose a subscription that delivers text deltas without materializing the
complete scalar on every refresh. Expose splice writes tied to a stable text
version or anchors, with the same stale-base merge guarantee as `editedFrom`.
Keep text hashing, materialization and replication work in the persistent worker
where possible.

Alkalye now selects saved metadata for its library, fetches bodies for actions
on demand, applies incoming splices when their base matches, and counts words,
sentences and tasks in a worker. Immediate writes retain `editedFrom`. This
reduces app overhead while preserving convergence; remaining native costs need
an engine change. See the benchmark report for final production measurements
and the explicit target assessment.

written with gpt-6.1-sol in T3 Code (Codex)
