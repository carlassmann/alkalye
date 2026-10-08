# Fused durable checkpoint capture

Outside experiment; not adopted. No native timing, heap reduction or 120 Hz claim.

The old cooperative snapshot captures owned scalar atoms, then compacts them. The candidate privately borrows immutable indexed atoms during capture, invokes the unchanged compactCheckpointEffect, and detaches nested order/observed/deleted arrays from emitted runs. Above the existing 2,000,000-atom cap, compaction returns v2 and the candidate copies every borrowed atom before publication. Public checkpoint/checkpointEffect ownership stays unchanged. Generation checks cover capture, compaction and detachment. Interrupted or stale work returns no snapshot.

DocumentSession uses this only for cooperative capture. Its current opened-replay reuse remains intact. The synchronous path stays unchanged. One temporary reference array remains; above the cap, it coexists with the owned output and can increase peak memory. Existing compaction behavior, including legacy limitations, is preserved. This proof does not establish a browser allocation or latency improvement.

## Proof

Strict types passed. Eight public Replica cases and two real SQLite DocumentSession cases passed, 59 assertions: Unicode and lone surrogates, metadata/header structure, comments, peer history, Undo/Redo, public checkpoint reopening, tamper isolation, interruption and generation invalidation. A subsequent strengthened ownership case passed 15 assertions and explicitly exercised deleted[] rather than only order/observed arrays.

Separate sequential processes captured and reopened exactly 2,000,000 and 2,000,001 retained ASCII atoms. Bare targets avoid confusing source length with retained atom count. The cap emitted v3 with one run; above it emitted v2 with 2,000,001 independently owned atoms. First/middle/last returned atoms and container arrays were mutated; live source and visible count stayed exact. Independent public reopening matched the full source and visible count. Large generated JSON checkpoints are omitted; logs and reproducer are included.

Two read-only Opus reviews completed. The first identified the deleted[] ownership requirement; the second found inferred type/test weaknesses. Corrected types and ownership checks passed. Native matched app A/B remains required before adoption.

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
