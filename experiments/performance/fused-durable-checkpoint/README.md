# Fused durable checkpoint capture

Outside experiment, pending conscious production review. Native matched results are below; no 120 Hz claim.

The old cooperative snapshot captures owned scalar atoms, then compacts them. The candidate privately borrows immutable indexed atoms during capture, invokes the unchanged compactCheckpointEffect, and detaches nested order/observed/deleted arrays from emitted runs. Above the existing 2,000,000-atom cap, compaction returns v2 and the candidate copies every borrowed atom before publication. Public checkpoint/checkpointEffect ownership stays unchanged. Generation checks cover capture, compaction and detachment. Interrupted or stale work returns no snapshot.

DocumentSession uses this only for cooperative capture. Its current opened-replay reuse remains intact. The synchronous path stays unchanged. One temporary reference array remains; above the cap, it coexists with the owned output and can increase peak memory. Existing compaction behavior, including legacy limitations, is preserved. The public contracts establish ownership and replay; native results separately measure the app slice.

## Proof

Strict types passed. Eight public Replica cases and two real SQLite DocumentSession cases passed, 59 assertions: Unicode and lone surrogates, metadata/header structure, comments, peer history, Undo/Redo, public checkpoint reopening, tamper isolation, interruption and generation invalidation. A subsequent strengthened ownership case passed 15 assertions and explicitly exercised deleted[] rather than only order/observed arrays.

Separate sequential processes captured and reopened exactly 2,000,000 and 2,000,001 retained ASCII atoms. Bare targets avoid confusing source length with retained atom count. The cap emitted v3 with one run; above it emitted v2 with 2,000,001 independently owned atoms. First/middle/last returned atoms and container arrays were mutated; live source and visible count stayed exact. Independent public reopening matched the full source and visible count. Large generated JSON checkpoints are omitted; logs and reproducer are included.

Two read-only Opus reviews completed. The first identified the deleted[] ownership requirement; the second found inferred type/test weaknesses. Corrected types and ownership checks passed. A subsequent matched app A/B passed all six native acceptance/caret gates. Production adoption remains a separate review.

## Preserved failures

The first contract run had 3 passes and 7 failures: its JSON-byte oracle incorrectly compared synchronous visibility property order with the cooperative path. The oracle now uses the previous cooperative capture path; no production behavior was changed to satisfy it. The first threshold reader swapped the public fromCheckpointEffect arguments. Its log is retained. Final strict types exposed a threshold union-inference error; an explicit Atom | undefined annotation fixed it without casts. All failure logs remain here.

## Replay

Use the repository's pinned Bun/Effect dependencies. Make a separate checkout from 5b4d2b7. Copy crdt.ts.txt and document-session.ts.txt to src/shared with the .txt suffix removed. Copy the three test snapshots into tests with the .txt suffix removed. Keep node_modules as the only intentional read-only symlink. Use the repository Prettier configuration.

Run:

```sh
bun run check:types
bun test tests/durable-checkpoint.test.ts tests/durable-checkpoint-session.test.ts
mkdir -p /tmp/alkalye-fused-checkpoint
bun tests/durable-checkpoint-threshold.ts capture 2000000
bun tests/durable-checkpoint-threshold.ts reopen 2000000
bun tests/durable-checkpoint-threshold.ts capture 2000001
bun tests/durable-checkpoint-threshold.ts reopen 2000001
```

Threshold commands must run sequentially. Each creates a large independent process and generated checkpoint. The captured source snapshots and log hashes are in results.json. No browser bundle was built or loaded for this proof.

## Matched native app proof

Both arms freeze 5b4d2b7; the candidate changes only the two source snapshots above. The native Bun backend is identical. Three alternating trials reset the same database/profile per cell. Trusted append and Undo each have a complete 3-second main-thread task window, including microtasks and subsequent GC/layout/paint. Initial loading is outside those windows. The acceptance observer is closed before Undo profiling; it opens after each measured window to verify exact independently accepted source. Every cell also preserves source-mapped caret and bounded EOF viewport.

| Median                         |   Baseline |  Candidate |
| ------------------------------ | ---------: | ---------: |
| Initiating append task         |   7.370 ms |   6.766 ms |
| Largest append-window task     |  13.946 ms |  13.625 ms |
| Append-window busy union       | 915.056 ms | 884.621 ms |
| Largest Undo-window task       |  13.780 ms |  13.701 ms |
| Undo-window busy union         | 915.973 ms | 833.230 ms |
| Sampled main heap after append |   915.8 MB |   814.3 MB |

Largest task tails still exceed 8.33 ms. Median maximum minor GC is 13.601→13.339 ms after append and 13.484→13.422 ms after Undo: no substantial GC pause improvement. Heap is one main-heap observation per cell, not total process memory or a causal allocation count. Foreground input improvement is small; the clearer result is reduced background busy work. There is no broad multicursor, mobile or physical-refresh claim.

A separate instrumented native build proves the actual cooperative producer was used: five completed captures across generations 28/29/30, 1,048,589/90 retained atoms compacted to 15/16 owned rows. It passed the same accepted source/caret gate. Its source and entry hashes are separate; no diagnostic trace is included in timing summaries.

The initial app setup failed before measurement: the disposable work directory lacked Git workspace registration. All six failed setup cells and original runner are preserved. Only that disposable directory was initialized, stderr capture and fail-fast behavior were added, and the fresh six-cell run passed. Loading's tiny formatter grant caused no tool calls during this run. Original disposable backend restored after tests; user phone runtime untouched.

Native harness, raw cell results, task/GC summaries, separate eligibility record, exact source/entry/trace hashes and setup failures are included. Large trace files stay at the recorded outside paths. Replaying native cells additionally requires the retained authenticated disposable profile/database fixture; the standalone correctness replay above requires neither.
