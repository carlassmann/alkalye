# Existing rich document reopen and input

Written with gpt-6 in codex. Frozen `5b4d2b7` client/backend and existing durable rich data from the preceding failed import. No third UI import, deadline extension, prototype parser change or newer fused-save code.

First existing-document gate passed. Writable model readiness took 16,257ms. Native source and index both had 1,048,576 UTF-16 units, 11,436 projected links; source hash exactly matched the accepted snapshot at position 61. Pending was zero, busy false, editable true. The original fixture source also matched exactly: no source normalization or data mismatch. This later success cannot identify which conjunct blocked the preceding seed deadline. The initial recovery selector was wrong; its null result proves nothing about recovery.

Trusted middle `x` at offset 524,497 advanced native caret to 524,498, exact accepted source to position 62 and Undo back to the original hash at position 63. Native fragments were 2,915→2,916→2,915 units, with the surviving caret restored. Main canonical source equality, accepted hashes and increasing accepted positions were asserted. The actual visible fragment text was not independently compared against a source slice.

One unsampled three-second trace: input RunTask **17.844ms**; largest later task **14.441ms**, dominated by minor GC. This is a real budget failure for this finite rich typing observation. It is not a physical 120Hz measurement, statistical estimate or fresh current-production result. Main heap was sampled at 1.54GB after input; no process/peak memory claim.

One separate causal CPU profile repeated the same durable fixture and native/accepted/Undo gates. It passed positions 63→64→65. Writable readiness was 2,275ms with retained browser IndexedDB/profile state, so 16.257s→2.275s is **not** a cold-load A/B. The actual recovery element was present and hidden; its text being mounted does not mean recovery was visible.

Sampled input RunTask was 21.155ms, later max 13.841ms. Profiling overhead prevents direct speed comparison with the unsampled trace. Input stack samples:

| Function                                                | Self    | Inclusive |
| ------------------------------------------------------- | ------- | --------- |
| Projector.project (`projection.ts:87`)                  | 5.689ms | 7.753ms   |
| projectTokens (`projection.ts:171`)                     | 1.927ms | 1.927ms   |
| SourceTextarea.projectionFor (`source-textarea.ts:242`) | 1.329ms | 9.596ms   |
| SourceTextarea.sync                                     | 0ms     | 10.275ms  |
| Editor input handler                                    | 0.138ms | 14.773ms  |
| EditorOverlay.update                                    | 1.373ms | 1.816ms   |
| Garbage collector                                       | 1.796ms | —         |

Nested inclusive costs are not additive. This identifies projection rebuilding as the largest concrete input-stack lead, rather than proving every line/shift operation's individual cost. Existing Projector code scans line/fence state and remaps shifted suffix tokens on middle edits; optimize only after a reversible public-module/native experiment. No production changes in this artifact.

The copied reopen script initially had a quoting compile error, corrected before runtime. Executed source snapshots, raw results, independent readiness conjuncts, mapped samples and trace hashes are retained. Raw traces remain in `/tmp/alkalye-rich-current`. Snapshot HTTP uses the same disposable account cookie in process memory, restores through the real shared snapshot implementation outside the browser, and emits only source hashes/positions. No credentials, browser profiles or databases are committed. Own browsers/proxy stopped; original disposable 4461 server restored.
