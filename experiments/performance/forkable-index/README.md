# Shared-index experiment

Production is unchanged. This prototype replaces selected private Replica indexes with a native Map until its first fork, then an immutable native base and an Effect HashMap overlay. Effect Chunk preserves insertion order for new keys. Child sibling arrays retain existing copy-on-write behavior.

`prepare.ts` copies current source into a fresh temporary directory and builds four isolated browser modules: native, atom index only, child indexes only, both. Exact source anchors prevent silently patching a changed implementation. Run from the project root:

```sh
bun experiments/performance/forkable-index/prepare.ts /tmp/alkalye-index-experiment
```

Serve each variant's `assets` directory with a disposable work-managed server. The browser entry exposes `window.indexProbe.prepare(size)` and `await window.indexProbe.run(true)`. Preparation creates a warmed source and a cold checkpoint-restored replica. Prepare again before every run. Close the context between samples, especially at 1MiB. The public journey checks independent forks, retained views, Unicode changes, concurrent merge, local undo, checkpoint restore and frontmatter. It times these phases separately. Synchronous correctness reads and checkpoint restore are intentionally included; this is not an app-loading benchmark.

## First V8 run

Frozen production source: `8d2a063`, October 8, 2026. One fresh background Chromium context per variant and size; eight samples total. No statistical inference from single samples.

| 1MiB phase              |   Native | Atom index | Child indexes |     Both |
| ----------------------- | -------: | ---------: | ------------: | -------: |
| First fork              | 119.3 ms |    72.0 ms |       69.6 ms |  15.5 ms |
| Second fork             |  95.8 ms |    59.5 ms |       50.2 ms |   0.4 ms |
| Third fork              |  97.0 ms |    54.7 ms |       51.4 ms |   0.1 ms |
| Fork append             |   1.2 ms |     1.2 ms |        1.3 ms |   1.2 ms |
| Owner insertion         |   3.3 ms |     3.6 ms |        3.5 ms |   3.5 ms |
| Checkpoint plus restore | 660.7 ms |   700.9 ms |      736.5 ms | 799.2 ms |

All variants passed 108 existing public tests with 1,009 assertions: fork interruption, causal undo, frontmatter and checkpoint hydration. The shared-module closure type-checked. A separate 1MiB public journey passed in Bun; it was a correctness check, not timing evidence. Opus 5.5 found no isolation or insertion-order blockers.

The trace-save command initially used an unsupported flag and overwrote earlier traces. Only the final both/1MiB trace survived. Its largest task was 1,543 ms, including synchronous verification, materialization and checkpoint restore. There is no cross-variant task comparison. Post-journey heap readings include retained fixtures, forks and restored data; they do not measure allocations.

## Decision

Do not adopt this representation yet. Fork copies shrink substantially, but checkpoint plus restore became slower in this sample. After the first replaced child entry, every child lookup hashes the atom ID through Effect. Overlays keep growing after the first fork, including when a cooperative fork is interrupted. The wrapper also adds avoidable missing-key and iterator overhead. Automatic compaction could reintroduce an uninterruptible document-sized copy.

Next useful proof: improve native empty-overlay reads/iteration, exercise repeated middle edits and causal restoration, then measure actual cached app opening with cooperative persistence. Preserve native-map production behavior until those costs and lifecycle rules are reviewed.

written with gpt-6 in codex

## Native override membership follow-up

`membership-index.ts` keeps a private native Set of replaced base keys. Fork copies that set; Effect HashMap remains the persistent update source. Unchanged keys avoid Effect hashing, and empty-overlay reads and iteration delegate to the native base. No automatic compaction.

Build this variant with the optional index-source argument. The optional fourth argument selects a frozen source directory. The generated public-equivalence test exercises 64 Unicode middle edits, retained branch views, causal inverse and checkpoint insertion order.

```sh
bun experiments/performance/forkable-index/prepare.ts /tmp/alkalye-membership-experiment experiments/performance/forkable-index/membership-index.ts
bun test /tmp/alkalye-membership-experiment/contracts.test.ts
```

The follow-up used the same frozen `8d2a063` Replica source and fresh Chromium contexts. Six single-sample journeys compared native, previous shared indexes and membership-gated shared indexes at 128KiB and 1MiB. All variants passed the previous 108 public tests; the extra equivalence test passed 17 assertions. Types passed. Raw phases are in `membership-results.json`.

At 1MiB, checkpoint plus restore improved from 811.4 ms to 768.7 ms but remained slower than native's 665.8 ms. Three forks totaled 315.4 ms for native, 16.6 ms for the previous prototype and 16.5 ms with membership gating. This does not establish a frame-budget improvement or remove the checkpoint regression.

`dense-journey.ts` applies one batched edit through public `prepareReplacements`, inserting into 128 or 4,096 distinct base-parent positions in a 1MiB document. It checks independently editable copies. Fork time was 92.9 / 93.3 ms for native, 2.0 / 2.2 ms for the previous prototype and 2.1 / 2.3 ms for membership gating. Raw samples are in `membership-dense-results.json`.

The membership set is bounded by distinct replaced keys in the initial native base, but that bound can be document-sized. Copying it remains synchronous. Persistent additions continue accumulating. Neither these single samples nor the 4,096-key probe establish safe worst-case task bounds. Production remains unchanged.

written with gpt-6 in codex

## Rejected child-value traversal, then empty-overlay guard

The public journey now times checkpoint creation and restoration separately. First-fork measurements start from a live edit with a large insertion operation to freeze. They do not attribute freeze cost in an actual cache-hydrated app session, which may retain different operation facts.

`child-values-index.ts` derives child-map keys from the first sibling's immutable `after`, preserving the empty-string root key. This avoids entry tuples when iterating base values. Child arrays must be nonempty, with all siblings sharing that parent. Existing public contracts and Opus review found no invariant violation. Generic iteration remains available for other indexes.

```sh
bun experiments/performance/forkable-index/prepare.ts /tmp/alkalye-child-values-experiment experiments/performance/forkable-index/child-values-index.ts . --child-parent
bun test /tmp/alkalye-child-values-experiment/contracts.test.ts
```

Eight fresh-context V8 samples used the frozen `8d2a063` source, comparing four variants at 128KiB and 1MiB. Each phase is a single sample, not a significance test. Types and 109 public tests with 1,026 assertions passed.

| 1MiB phase |   Native | Previous shared | Membership | Child-key values |
| ---------- | -------: | --------------: | ---------: | ---------------: |
| Checkpoint |  71.2 ms |        160.6 ms |   118.1 ms |         117.3 ms |
| Restore    | 585.1 ms |        655.3 ms |   647.8 ms |         659.1 ms |

Child-key traversal did not remove the regression. Reject that added complexity. The remaining checkpoint penalty is distinct from restoration cost; source inspection suggests generator and membership work per retained parent, but these phase timings do not establish CPU attribution.

`empty-overlay-index.ts` adds one guard to the membership variant: avoid Effect `HashMap.has` when the overlay is empty. Installed Effect hashes the key unconditionally in `has`, so the earlier prototype hashed every long insertion identity during initial native restoration. This change preserves the existing membership representation.

```sh
bun experiments/performance/forkable-index/prepare.ts /tmp/alkalye-empty-overlay-experiment experiments/performance/forkable-index/empty-overlay-index.ts
bun test /tmp/alkalye-empty-overlay-experiment/contracts.test.ts
```

Six fresh-context 1MiB journeys ran in two rounds of native, membership and guarded membership. Same frozen source and fixture; public contracts and types passed. Restore time was 585.9 / 583.1 ms native, 636.7 / 649.5 ms membership, and 593.5 / 603.3 ms guarded. The guard removed most of the restoration penalty. Checkpoint remained slower: 71.7 / 70.9 ms native versus 117.7 / 128.2 ms guarded. Two observations do not establish statistical confidence or task bounds.

Raw results are in `child-values-results.json` and `empty-overlay-results.json`. Large traces remain outside Git. Production keeps native indexes. Do not adopt the shared representation before resolving its checkpoint regression and measuring actual accepted/passive-cache reopening.

written with gpt-6 in codex

## Actual app warm opening

Frozen source `660423c`. `app-index.patch` applies the empty-overlay guard variant to the two Replica indexes in a copied source tree. Both client builds used the same native current-source backend. Server index changes were not measured. Each of three pairs restored the same disposable server dataset and browser profile, removed browser/service-worker caches, and verified the loaded bundle hash and byte size. No production changes.

Before opening, the journey validates the complete original fixture source, types an `X`, waits for an accepted cache at the newest journal cursor, undoes it, then requires an accepted cache at a strictly newer cursor and the complete original source. Pending and rejected actions must both be empty. It selects the base document, then measures reopening the target. Earlier samples with a late-edit-cache readiness race are excluded.

| Median                                 |   Native | Shared-index prototype |
| -------------------------------------- | -------: | ---------------------: |
| 128KiB warm ready                      |  65.8 ms |                33.1 ms |
| 1MiB warm ready                        | 416.1 ms |                32.5 ms |
| 1MiB largest opening task              |  10.2 ms |                 6.5 ms |
| 1MiB undo accepted-cache delay         | 2,999 ms |               3,369 ms |
| 1MiB largest edit/undo acceptance task |   839 ms |                 881 ms |

Opening improved; accepted undo regressed. The acceptance window includes transport, validation, persistence, materialization and collection work, so these timings do not attribute the regression to compaction. Largest opening tasks were 9.7–26.6 ms for native and 6.4–6.6 ms for the prototype. The largest sampled 1MiB heap per pair was 2.16–2.26 GB versus 1.62–1.94 GB; these are samples, not peak-memory or allocation measurements. Headless animation callbacks indicate frame opportunities, not sustained 120Hz.

`app-results.json` retains all six exact phases. Full timeline traces remain outside Git at `/tmp/alkalye-guarded-app-660`. `app-journey.ts` accepts the existing fixture configuration and an output directory, with `--fresh-echo`. Restore identical backend/profile fixtures before every phase, and verify matching frozen assets before running it.

```sh
bun experiments/performance/forkable-index/app-journey.ts /tmp/config.json /tmp/results --fresh-echo
```

Current-source types and 131 public tests with 1,123 assertions passed, including SQLite passive-session isolation, interruption, frontmatter, recovery and a 64-edit Unicode branch/checkpoint comparison. Opus 5.5 found no correctness blocker; it flagged permanently growing overlays, synchronous override-set copying, mutation during iteration and unmeasured server behavior. Keep this experimental until those tradeoffs are consciously reviewed.

written with gpt-6 in codex
