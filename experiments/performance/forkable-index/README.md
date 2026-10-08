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

## Undo acceptance attribution

One separate V8-sampled diagnostic per variant used the same frozen client/backend fixtures. These sampler timings are excluded from the three-pair opening comparison. `app-profile-results.json` records source-mapped self and inclusive samples from the longest renderer task after undo began.

Native's 966 ms task resumes inside `indexeddb-journal.ts:585`, then enters `buildOptionalAction`: 821 ms inclusive, of which checkpoint cloning takes 662 ms and `Replica.restore` 628 ms. Building the inverse then reads a cold view for another 159 ms. GC contributes 113 ms of sampled self time. The prototype's corresponding task is 976 ms: clone 701 ms, restore 623 ms and inverse/view 148 ms. Checkpoint collection copying costs 219 ms versus native's 184 ms.

The direct target is synchronous full-state staging through `restore(checkpoint())`, followed by cold materialization. Replacing that staging with an independently forked replica can preserve isolation while removing unnecessary checkpoint copying, restoration and cold scans. That change requires its own public contracts and matched app measurement. Neither the shared-index cutover nor automatic compaction follows from this diagnosis.

written with gpt-6 in codex

## Combined fork-staging and shared indexes

Frozen source `41716e4` replaces action staging through checkpoint restoration with an independent replica fork. The same guarded index patch was applied only to the copied client candidate. Both phases used the native fork-only backend. Three fresh paired phases repeated the strict accepted edit/undo and warm-opening journey without changing its assertions or instrumentation. Current-source types and 124 public tests with 1,091 assertions passed.

| Median                                 | Fork-only native | Fork plus shared indexes |
| -------------------------------------- | ---------------: | -----------------------: |
| 128KiB warm ready                      |          65.9 ms |                  32.5 ms |
| 1MiB warm ready                        |         434.2 ms |                  30.9 ms |
| 1MiB largest opening task              |          11.3 ms |                   6.5 ms |
| 1MiB undo accepted-cache delay         |         2,157 ms |                 1,857 ms |
| 1MiB largest edit/undo acceptance task |           291 ms |                   335 ms |

All complete-source, cursor, pending and rejection checks passed. The largest acceptance tasks ranged from 288–337 ms for native and 286–354 ms for the prototype. Its median still regressed about 15%. Cache delay includes scheduling, so its decrease does not establish faster processing of every acceptance stage. Largest sampled 1MiB heaps per phase were 1.71–2.39 GB versus 1.19–1.46 GB. This remains sampled rather than peak memory.

`app-fork-results.json` retains exact metrics, hashes and scope. Timeline traces remain outside Git at `/tmp/alkalye-guarded-app-fork`. Staging through a fork removes the earlier full-checkpoint clone penalty, but it does not clear the shared index's residual main-task tradeoff. Keep indexes experimental pending attribution and a conscious adoption decision.

written with gpt-6 in codex

## Residual refresh after the inverse guard

Frozen `2d95381` adds the empty-inverse guard to independent action staging. One further diagnostic per native/index client used the same current native backend and exact accepted undo fixtures. Source-mapped samples show a different bottleneck: the longest task now comes from the application animation-frame refresh, not undo checkpoint staging.

Native's 314 ms task includes 150 ms of cold document text materialization through `currentDocument` and `session.replica.documents`, then 138 ms in editor `atomPositions`. The shared-index task is 373 ms: 167 ms of cold text through media refresh and 182 ms of editor identity indexing. Editor indexing self time is 117 / 165 ms; shared-index lookups contribute 52 ms during materialization. GC contributes about 5 ms in either sample.

Undo deletes the caret's anchor. The editor's local search misses that exact identity, then builds a full identity-to-offset index before looking for a surviving predecessor. Separately, publishing a changed replica leaves its text cache cold, so synchronous UI getters walk the document inside the frame callback. Those are the measured targets. A safe fix must preserve exact cursor recovery and publish complete, current materialization; merely changing task scheduling or guessing an anchor is insufficient.

`app-guard-profile-results.json` preserves the mapped samples. These single diagnostic samples identify code paths; they are not new statistical latency results. Shared indexes remain unadopted.

written with gpt-6 in codex

## Current cancellation-cache app comparison

Frozen baseline `17d3a97` includes the guarded terminal-cancellation source cache, deleted-caret fix and coalesced syntax overlay. The candidate changes only atom-index and child-index containers: apply `app-cancellation-index.patch`, then copy `empty-overlay-index.ts` to `src/shared/forkable-index.ts`. It adds no eager materialization or private preparation copies. Both clients use the same native baseline server.

Three matched pairs on the exact 1MiB/512-paragraph fixture, alternating variant order, measured:

| Journey metric                               |   Native | Hybrid index |
| -------------------------------------------- | -------: | -----------: |
| Undo source ready plus two RAF opportunities |  210.8ms |       88.6ms |
| Undo accepted checkpoint                     | 1180.7ms |      957.5ms |
| Largest undo task                            |  25.51ms |      25.07ms |
| Native single-character input dispatch       |   4.16ms |       4.34ms |
| Largest deferred edit task                   |   9.77ms |      10.37ms |
| Edit accepted checkpoint                     | 2436.5ms |     2492.5ms |

Single paired controls also passed on 128KiB/2048 and 1MiB/2048-paragraph fixtures. Undo visibility opportunities decreased 95.8→72.5ms and 263.9→149.7ms. These are native one-character append/undo controls, not multicursor replacement.

Each phase restores the same consistent disposable SQLite seed and browser-profile seed, clears service-worker caches, verifies frozen asset hashes, requires exact literal source, trusted events, no pending/rejected operations, and an accepted snapshot cursor strictly newer than the preceding edit. Traces remain outside Git under `/tmp/alkalye-index-cancel-current`. Compact raw measurements are in `app-cancellation-results.json`.

The candidate remains experimental. The 25ms largest task exceeds the 8.3ms target. Heap samples are readiness samples affected by GC: 1MiB samples generally decreased, but the single 128KiB candidate sample increased. They establish neither peak memory nor retained-memory bounds. The native backend avoids attributing server changes to a client comparison.

129 public integration contracts passed, including Unicode edits, independent forks, held views, checkpoint ordering/restore, causal undo, cooperative interruption/stale copying, passive-session isolation and the current terminal-cancellation cases. Strict types passed. Opus5.5 found no correctness blockers, but noted that persistent additions and copied override Sets grow throughout long sessions. No speculative compaction was added.

written with gpt-6 in codex

### Genuine multicursor control rejects adoption

The native single-character controls above did not cover multicursor cost. A second matched comparison used trusted Ctrl+Shift+L to select all 2048 `TOKEN` occurrences, then native `X` input. Three alternating-order pairs ran both 128KiB and 1MiB fixtures. Every trial proved exactly 2048 edits, exact replacement source, accepted edit, exact undo and a strictly newer accepted undo cursor.

| Actual 2048-selection metric | Native median / max | Hybrid median / max |
| ---------------------------- | ------------------: | ------------------: |
| 128KiB input RunTask         |     27.37 / 27.44ms |     30.10 / 31.78ms |
| 128KiB largest deferred task |     50.93 / 75.57ms |     54.76 / 58.72ms |
| 1MiB input RunTask           |     25.73 / 26.15ms |     32.81 / 33.16ms |
| 1MiB largest deferred task   |     51.14 / 52.12ms |     63.68 / 65.79ms |

**Rejected.** Faster undo does not compensate for slower multicursor editing. Production remains native Maps. The broader control shows why an append-only benchmark could not justify adoption. `verifyEquivalent(nativeFactory, candidateFactory, 256)` extends the public contract to 256 edits; it also passed native checkpoint equivalence, held views, Unicode, independent branches, cancellation and restoration; correctness was not the reason for rejection. No compaction or additional infrastructure was added.

written with gpt-6 in codex
