# Small Undo timeline diagnostic

One marked actual c922 production-app Undo, after accepted native input on the known 2 KiB document. Strict/build, 34 loaded/fetched emitted-JS pins, exact independent seed/edit/Undo receipts, native Meta+z and restored caret all passed. Own server/context closed. No production changes.

| Boundary after trusted z       | Elapsed |
| ------------------------------ | ------: |
| Proposal gate / flush complete |  0.2 ms |
| Pre-proposal replay complete   | 12.0 ms |
| Undo prepared                  | 15.3 ms |
| Durable proposal complete      | 20.4 ms |
| App refresh frame              | 28.7 ms |
| Source model assigned          | 29.4 ms |
| Viewport render returned       | 30.6 ms |
| Probe source-ready rAF         | 45.3 ms |

The probe rAF ran at 28.633 ms before the app refresh at 28.725 ms. Restoration occurred later within that frame; the probe observed it on its next frame. Its 45.3 ms opportunity includes 15.9 ms after model assignment and 14.7 ms after viewport render returned. These boundaries are neither compositor paint nor a 120 Hz measurement. The original unmarked n1 50.647 ms remains separate in `../main-current-undo-cwd-c922`; this diagnostic is not a timing comparison.

Real application feedback still waited for asynchronous durable work, then 8.3 ms for the refresh frame. The 11.8 ms replay interval is elapsed wall time, not exclusive CPU attribution. Initial enclosing Undo task was 0.561 ms; largest full 3s task 2.955 ms. No CPU sampler was used. Marking adds overhead; histories advanced and there is no repeated control here.

`editor:source-assigned` is recorded at SourceTextarea.current assignment, before viewport.render. `editor:viewport-rendered` records that call returning. Exact public native source/caret and independent receipt gates verify the final state. The existing probe order is preserved; no earlier optimistic state or journal bypass. Source hashes in metadata describe exact uninstrumented c922 inputs; timeline.patch is the sole application delta. Requested/fetched resource hashes verify emitted bytes, not module execution coverage.

Raw traces remain outside Git, listed with hashes/sizes in trace-manifest.json. Private account/profile/DB/manifest remain outside. The legacy proposed source-only plan has now been exercised through the archived exact runner. The initial work start command was rejected before creating a process; installed work run web then started only PID28523.

Small next experiment: refresh through the existing public editor path after durable Undo completion, retaining all revision/library/presence scheduling. This targets application frame wait, not probe observation delay; it is unimplemented and unmeasured here.

written with gpt-6 in codex
