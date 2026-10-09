# Production children-index comparison

HOLD. Actual production 1 MiB typing feedback stayed unchanged; Undo feedback worsened. The earlier experimental Worker improvement did not transfer to this production journey.

Frozen root 85a6e15f2665e6ee4092dc9d66f88c5e7aae56b8. Control CRDT 4a0aa7553a0de7fbfc2d8eb9a6332313b04bcf0dc68e558de6add25ea6e71b7d; candidate 6bcad274fcac66bf8ec36e0bd06aebd6de569b99879936427204f8d23df78605. Only private children adjacency changes; production SourceTextarea, Effect/session/UI/server/CSS identical. No TextVisibility memo or experimental Worker cutover.

Twelve fresh cells, alternating arms, n=3 per fixture/arm. Each cell copies the same frozen accepted DB/profile; previous account/history retained equally. Four earlier untimed correctness cells also passed. Twenty-four separate three-second input/Undo windows; no CPU sampling. Strict types and both builds passed. Own browser/server scopes closed after every cell.

| Fixture | Action | Arm | Exact native frame opportunity median / max (ms) | Main RunTask median-max / worst (ms) | Main busy union median / max (ms) |
| --- | --- | --- | --- | --- | --- |
| small2 | input | control | 14.900 / 15.100 | 3.246 / 3.368 | 70.221 / 70.628 |
| small2 | input | ordinal | 14.800 / 15.400 | 3.253 / 3.341 | 71.336 / 72.070 |
| small2 | undo | control | 24.000 / 24.200 | 2.311 / 2.473 | 70.895 / 71.294 |
| small2 | undo | ordinal | 20.800 / 29.800 | 2.413 / 2.442 | 71.143 / 75.249 |
| rich1m | input | control | 10.700 / 10.800 | 11.065 / 11.161 | 843.007 / 852.982 |
| rich1m | input | ordinal | 10.700 / 10.700 | 11.138 / 11.220 | 833.532 / 843.903 |
| rich1m | undo | control | 22.600 / 28.400 | 10.986 / 11.952 | 778.045 / 794.102 |
| rich1m | undo | ordinal | 29.100 / 30.100 | 11.052 / 12.783 | 763.691 / 797.253 |

Input starts at trusted beforeinput x; Undo starts at trusted keydown z. Opportunity means first observer rAF satisfying exact source, projected native fragment and caret agreement. It is not model-assignment time, paint, or physical display latency. Full RunTask maxima include nested GC and enclosing tasks overlapping the marked window; union clips tasks to the actual marked window. Main ownership is the thread containing interaction:start. Largest GC span is separate, overlaps tasks, and is not additive or retained-allocation attribution.

All twelve cells: native trusted edit, exact source/native fragment/caret, changed Saved revision, independent read-only public API exact edit receipt, platform-native Undo, exact restored source/caret, independent Undo receipt, online reload exact source. Receipts advance strictly on the same per-cell log; seed and Undo SHA match. API reads run after the trace windows, so their observations are not server latency measurements. Byte pins cover requested JS matching frozen dist, not execution coverage.

Fixtures: small2 = 2,048 UTF-16 units / 2,048 UTF-8 bytes / 121 real newlines, SHA 67d8d2729652850c75b382019b36a8694b723e9ede736649636d89daede2d995. rich1m = 1,048,576 UTF-16 units / 1,048,576 UTF-8 bytes / 20,767 real newlines, SHA 0ba3f77995fce57ab0142bbb058e5413468afd515c1b2592079091656a89091b. Mid-body single character insertion; no sustained typing, collaboration capacity or full product parity claim.

Retained prior module costs: candidate snapshot/durable and many-small-target load regressions remain. This app result does not erase them. Candidate is held, production unchanged.

Setup failures occurred before keys: wrong editor source path / wrong strict cwd; agent-browser session name exceeded socket path. Corrected only setup, preserved logs and prior pins. No uncertain mutation retried. The original gate-plan was unrun when written; final witnesses supersede its status.

Archive excludes credentials, capability key, profiles, DB, private manifests and raw traces. production-analysis.json retains SHA/bytes for all 24 raw traces outside Git, all numeric results, sanitized receipt epoch hashes/positions and fixture hashes. public-cell-witnesses.json retains probe events/frame samples, native selections, scope closure and per-cell asset pins. Archived TypeScript is .txt to avoid becoming executable production tests.

written with gpt-6 in codex
