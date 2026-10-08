# Sampled sustained worker attribution

One diagnostic human-plus-peer run, separate from the unsampled source-view-string comparison. Frozen baseline CRDT `09430839d4093aef3644e2991a6161c3f30e338cc63632a80224e590787818f2`; candidate cache absent. Same corrected actual EditorElement/worker prototype, 1 MiB multiline source, 72 trusted native keys at requested 100 ms cadence, four peer prefixes. This fixture uses explicit HTTP DocumentSession.sync and shared IndexedDB, without WebSocket or long-poll notifications.

Editor worker URL: `http://localhost:49738/worker.js?role=editor`. Peer worker URL: `http://localhost:49738/worker.js?role=peer`. Test-only user-timing marks distinguish queued prepare, prepared, saved and materialized phases. External Bun source maps map sampled function declarations to original files. Native timeline categories plus V8 CPU sampling enabled; diagnostic costs are not comparative timings. Full trace remains outside Git; SHA and path retained.

| Measured scope                       | Sampled attribution                                                              |
| ------------------------------------ | -------------------------------------------------------------------------------- |
| Primary queued input                 | submitEdit → view.text → Replica.text: about 12.38 s inclusive across the window |
| Nested primary source reconstruction | rawVisible: about 10.32 s inclusive; rawVisibleSteps about 9.86 s                |
| Primary prepareReplacements          | about 0.94 s inclusive across the window                                         |
| Primary snapshot continuation        | about 1.29 s inclusive; compactCheckpoint about 0.87 s, checkpoint about 0.42 s  |
| Largest primary task                 | 437.973 ms: queued edit 6 prepare → prepared                                     |
| Largest peer task                    | 392.327 ms, separate peer Replace command                                        |
| Another primary task                 | 257.518 ms: snapshot compaction/checkpoint plus about 105 ms sampled GC          |

Inclusive values overlap; do not add them. Self samples identify rawVisibleSteps, visibility clock/active/hidden walks and atom-array mapping as the largest primary costs. The longest primary task contains about 200 ms inclusive prepareReplacements and 217 ms inclusive submitEdit/text. Other long tasks are snapshot/GC work, so worker maxima alone cannot identify command ownership.

submitEdit reads view.text both while eagerly constructing its unchanged result and when returning a successful edit. The sampled function ancestry does not distinguish these two call sites. Source reconstruction is established; the precise cache-miss reason still needs a bounded private diagnostic. A missing authoritative prepared cache for a divergent worker basis is a source hypothesis, not proven here. Snapshot work is a real secondary blocker; this run does not support treating it as the dominant human backlog cause.

All 72 trusted keys/inputs and exact editor/worker source, four peer markers, signed public snapshot hash, receipt progression, zero pending/rejected/unsaved and offline primary reopen checks passed. Final snapshot/reopen run after the timing window. Types passed. Server stopped and browser context closed. No production changes, no 120 Hz claim, no independent-storage or 20-writer claim.

Reproduce from the retained corrected runtime plus diagnostic source snapshots; run `bun sustained.ts 'http://localhost:49738/?size=1048576' output.json human-peer` against a fresh managed backend. Source map assets must match the sampled emitted worker. `profile.py` retains the exact original trace/map paths and computes per-profile self/inclusive samples and top-task phase associations.

written with gpt-6 in codex
