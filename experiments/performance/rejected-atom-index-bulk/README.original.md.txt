# Local transient atom-index cost gate — rejected

Outside Effect 4 atomIndex experiment; production unchanged. Local beginMutation/endMutation batches, never editable index in Replica. Immutable shared fork roots, frozen entry wrappers. Existing owner/children/duplicate/legacy order retained. Cooperative restore seals every batch before yielding; each copy occurs immediately before its indexing step. Other indices/wire/permissions unchanged.

104 public tests /1403 assertions and strict passed, including real SQLite accepted1/512 replacement UndoRedo/peer/frontmatter/scope and public checkpoint/fork independence. Private hydration actually interrupted; stale fork actually rejected. Initial runtime missing build.ts and incorrect cost interface edit|null return failures preserved. No data mutation runtime rerun: costs use independent in-memory replicas.

18 alternating public cost samples, n3 per arm/mode. Pure Native Map root e61d7819… vs pure bulk d0709273…; neither arm has field diagnostic markers. Source fixture1,048,576 UTF16 units,1,198,368 UTF8 bytes,973,680 atoms; sourceSHA150a08… verified in every row. Fork exact source/atomTarget and both-way future edit independence passed in every sample.

| Median ms | Native Map | Local bulk HashMap |
| --- | ---: | ---: |
| Large operation apply | 912.384 | 1402.712 |
| Sync checkpoint restore | 732.444 | 1437.705 |
| Cooperative checkpoint restore | 2112.997 | 2947.093 |
| 10,240 hot lookups after sync restore | 0.322 | 2.468 |
| forkEffect after sync restore | 194.226 | 112.239 |
| forkEffect after cooperative restore | 178.857 | 92.754 |

Reject broad adoption: faster fork accompanied by substantial cold-load/read regressions. Native browser comparison UNRUN. Original naive persistent-set run retained separately; do not causally compare its instrumented timings against this pure-source experiment. Children remain O(n); whole-fork O(1) unproven.

Heap/RSS brackets cover one process with retained seed/previous allocator state; some heap deltas negative from GC. No per-object allocation/retention or exclusive-memory ownership claim. Fork timing and cold-text timing are separate spans, not additive frame-budget proof. No production/physical display/120Hz claim.

Opus final source/patch review found no blocker, but cited wrong Effect3.22.2 cache for editable set. Retained caveat. Independently inspected installed pinnedEffect4.0.0 internal/hashMap.ts:1001–1018, which mutates editable root/size and returns self. Existing read-path hashing/Option cost unchanged; no exclusive cause claim.

written with gpt-6 in codex
