# Current production Undo residual

One separately sampled actual production `2ccca63` rich mid-document insertion Undo diagnostic. No timing comparison. Exact native source, accepted HTTP snapshot, advancing cursor, restored caret and bounded native textarea all pass. Prior coherent browser/database seeds are reused, reset independently for this diagnostic. Actual production copied into the disposable runtime; Effect 4.0.0. Only Undo's three-second window enables V8 CPU sampling.

Largest main task: 23.635 ms, beginning 179.839 ms after the trusted Undo mark. Initiating key task: 0.680 ms. The sampled main self time within that largest task accounts for about 23.797 ms; sampling approximation can exceed the task duration. Inclusive ancestry overlaps and is not additive.

| Mapped cost                  | Self ms | Inclusive ms |
| ---------------------------- | ------: | -----------: |
| SourceTextarea.projectionFor |   4.171 |        6.118 |
| EditorViewport.render        |   2.373 |        4.912 |
| SourceTextarea.apply         |   1.602 |        6.740 |
| EditorViewport.paint         |   1.514 |        2.539 |
| EditorOverlay.update         |   1.157 |        1.932 |
| Garbage collection           |   1.071 |        1.071 |

Editor.update accounts for 15.185 ms inclusive; SourceTextarea.render/reconcile accounts for 12.858 ms inclusive. CRDT rawVisible and the complete editor deleted-anchor scan are no longer sampled in this largest task. Two app summary-map callbacks each account for about 1.3 ms self. They are application work, not an attribution to Effect or IndexedDB.

The peer/statistics worker is idle/program-only in the same target interval. No retained allocation owner is established by CPU samples. This is one diagnostic, not a physical 120 fps test.

Source clue, unimplemented: projectionFor retains only its most recent source projection, so Undo to the previously known rich source rebuilds its projection. A bounded previous projection reuse experiment would require exact source/document/mode/active-selection validity and public geometry contracts. Other render/index/summary work remains; reducing one call alone does not establish the frame budget.

Preflight stopped the known managed allocation fixture on port 4461. Diagnostic driver 87421 completed and closed its browser/server. The same allocation predecessor was restored afterward, PID 24151. Phone process untouched. Full raw trace stays in `/tmp/alkalye-rich-undo-residual/candidate-0-undo.trace.json`; SHA256 is recorded in sampled-analysis.json.

written with gpt-6 in codex
