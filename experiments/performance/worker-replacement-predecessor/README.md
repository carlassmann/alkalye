# Replacement receipt plus requested-anchor predecessor mapper

Experimental stable-copy WorkerRPC/actual EditorElement; not full production worker parity. Control has the published replacement receipt CRDT (SHA e61d7819…); candidate differs only in requested-anchor mapping with the original full fallback. Six source files pinned. Twelve fresh native cells: n=3 per 1/512-range arm, independently copied pristine closed backend/profile per cell; arm order reversed in repetition 1. Every cell passed exact native source, all ranges/directions, primary caret and independent accepted edit/Undo snapshot gates. No uncertain action repeated. No profiler samples.

Undo medians (ms):

| Metric                           | Receipt 1 | Combined 1 | Receipt 512 | Combined 512 |
| -------------------------------- | --------: | ---------: | ----------: | -----------: |
| Worker largest RunTask           |    96.464 |     17.026 |     116.431 |       28.715 |
| Worker clipped task union, 3s    |  1176.271 |    874.130 |     709.363 |      631.931 |
| Source observer opportunity      |     346.7 |      267.3 |       377.6 |        291.1 |
| Local saved observer opportunity |    1326.3 |     1215.9 |      1294.5 |       1287.2 |
| Main largest RunTask             |     6.228 |      6.323 |       4.479 |        4.675 |
| Main clipped task union, 3s      |   189.057 |    192.425 |     169.430 |      188.440 |

Candidate worker tails remain 23.595/29.235ms, above 8.33ms. Saved 512 tail worsened 1338.6→1383.4ms. Main Undo tails are 6.636→6.325ms and 4.650→4.785ms. Source observer opportunities are not paint/display latency. Main task values include nested GC; GC spans are unowned, not additive. Typing worker peaks remain around 160–165ms; this is an Undo mapping improvement, not a whole-product or 120Hz result. Full selection/typing/Undo metrics are in `native-series-summary.json`.

Direct marked mapper spans: receipt 1 roughly 70–92ms; combined first span 9–16ms with subsequent tiny spans. Receipt 512 113–118ms; combined 28ms. The exact captured helper lacks per-path counters: no claim about fast/fallback/identity hit counts. The earlier message promising those counters was incorrect. O(k) allocations still permit O(n) scans; missing predecessor chains retain the complete original fallback. Opus found no semantic blocker, warned that multi-character canceled runs can pay extra scans before fallback, and did not establish hash/JIT causality.

Public RPC strict plus 54 assertions per arm passed: Unicode intra-atom offsets, all 512 directions, remote insertion/deletion, long missing predecessor chain, stale epochs, accepted Undo/Redo/adoption, and dedicated 1/512 TOKEN→x replacement Undo with independent snapshots. Frontmatter control passed. Empty-atom/lone-surrogate controls fail actor authorization before mapping in both arms and remain unproved. An initial expanded fixture incorrectly called Begin on an existing basis; both failures are retained. Corrected tests use separate public documents/new worker scopes. Series strict initially rejected a Bun stderr alias and mutable assignment from a readonly decoded array; corrected before native keys.

Raw traces, private credentials, profiles and databases remain outside Git. Trace hashes/sizes and every arm's fetched resource digests are retained. Fetched digest equality is not execution coverage. Whole task/phase markers establish actual worker work. CPU scopes/servers/browser contexts and parser terminated before release.

The retained combined-arm trial 0 traces now have a common-clock attribution in `undo-global-timeline.json`. The parser uses Chrome trace timestamps for both threads; worker-local and main-local performance clocks are never subtracted. For 1/512 ranges, the owned replica fork occupies 108.305/108.042ms, with 108.252/107.995ms of worker task union inside that interval. Flush is 0.020/0.036ms; mapping is 9.885/27.805ms; final observer delivery is 9.260/5.621ms. Before the first Merge, worker task union is 118.976/122.375ms across 130.385/131.577ms elapsed. That earlier interval has no detailed Undo phase marks, so its entire duration cannot be attributed to proposal construction. These are two retained diagnostic cells, not another repetition or a new benchmark. Overlapping task maxima may extend beyond a phase; clipped unions describe work inside it. The measured worker work rules out main queue delay as the dominant cause in these cells.

Written with gpt-6 in codex.
