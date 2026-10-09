# Persistent atom-index cost gate — rejected

Outside Effect 4 HashMap atomIndex experiment. Production unchanged. Immutable roots shared at fork; frozen entry wrappers. Other maps, checkpoints, validation and wire format unchanged. Pure production delta excludes diagnostic field marks; measured baseline and candidate both retained identical field instrumentation.

All 18 public Replica samples passed exact source and sampled atomTarget equality. Three alternating trials per arm/mode, one Bun process, 1,048,576 UTF16 source units, 1198368 UTF8 bytes and 973,680 visible atoms. This is not a 1MiB UTF8 fixture; earlier native ASCII trials are separate lineage. Source SHA256: 150a08eedea2f9227c8ed9d17139fd8e877f3bce0198831298d4cd0a13ba5948.

| Median ms | Native Map | Persistent HashMap |
| --- | ---: | ---: |
| Large operation apply | 936.086 | 1929.224 |
| Synchronous checkpoint restore | 736.835 | 1722.656 |
| Cooperative checkpoint restore | 2191.272 | 3194.684 |
| 10,240 hot atomTarget lookups after sync restore | 0.311 | 2.556 |

Reject this per-atom persistent-set implementation before native comparison. Faster fork alone does not justify doubled cold load and slower reads. Native timing remains UNRUN. Whole-fork O(1) is not established; children still copies.

Memory brackets include the shared fixture and process allocator history. Heap deltas rose in all mode medians; RSS reached about 3.04GB across the single sequence and is order/allocator-confounded. No retained-object ownership or per-replica memory claim. Cold text timing is separate in raw rows; no overlapping costs summed.

Public correctness: initial strict/public 41 tests/588 assertions passed; expanded harness had two failures (wrong atomTarget API name and assumed pending fork), preserved outside. Corrected broader suites passed 62 tests/807 assertions; final realistic fork test allows either completed independent clone or pending interruption/stale rejection, 3 tests/17 assertions passed. Actual branch was pending-rejected. No requirement that a fast fork must remain pending.

Opus 5.5 source review found no semantic blocker; explicitly warned about cold insertion/hash/Option allocation costs. This gate confirms regression, without attributing exclusive cost to any one mechanism. No browser/display/120Hz claim.

written with gpt-6 in codex
