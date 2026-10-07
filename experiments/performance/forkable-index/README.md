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
