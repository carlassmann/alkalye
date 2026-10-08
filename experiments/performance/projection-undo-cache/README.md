# Two-source projection cache

Adopted after public SourceTextarea contracts and six matched real-app trials. Baseline and candidate use frozen `2ccca63`; only SourceTextarea differs. Both use the same Bun backend. Each arm restores the same stopped data/profile seed, clears browser cache/service-worker directories, verifies the entry SHA and exact local/accepted source, then types at the rich 1 MiB body midpoint, saves, performs native Undo, and moves the caret with ArrowRight. Each phase retains its complete main-thread RunTask/Layout/Paint/GC window through three seconds. No CPU sampling during timings.

The owner retains two distinct-source projection records and one warm Projector. Restoring the prior record requires exact source, document ID/title key, mode, rendered icon prefix and caret endpoints. Same-source refresh keeps the previous distinct source. Public Projector freshness is unchanged; SourceTextarea exposes borrowed read-only state. Index, viewport and paint publication remain unchanged. Dispose releases cache records and token context.

Largest Undo RunTask median/max falls from 20.881/21.054 to 14.729/16.039 ms. The next ArrowRight median/max rises from 4.094/4.651 to 5.882/6.034 ms: the Projector still holds the edited source and rebuilds once on changed selection. Input medians are 18.606/17.832 ms, but the first paired trial regresses 15.978 to 18.121 ms. GC placement confounds a typing gain claim. Undo union busy time is 1129.501/1139.405 ms; GC and heap show no consistent improvement. This reduces an Undo peak, without proving 120 fps or less total work.

`crlf-contracts.log` records 313 public assertions plus trusted native input. It checks fresh projection equivalence, source/index preservation, native LF caret, previous borrowed output preservation, post-restore inclusive link boundaries, same-array retitles, raw/hold transitions and third-source eviction. CRLF checks compare the frozen baseline and an explicit canonical rounding oracle: interior requested 52 resolves to source 53, native 29; EOF 87 remains source 87. The original 259-assertion run skipped CRLF caret checks; its inherited baseline-defect description was withdrawn. No CRLF failure was observed here.

`browser-editor-prettification.ts.txt` adds a production journey regression: trusted insert, Saved, native Ctrl+Z, restored source/caret, ArrowRight, then caret expansion of the restored collapsed link. Root runs this addition in its full check. The isolated fixture uses public reconcile for restore; the six app cells use actual native Undo.

Hits can miss after grouped typing, remote reconciliation or a different restored caret. At most two projection graphs are retained, plus existing Projector context; this is a count bound, not a measured peak-memory guarantee. Sampled main heap is not total process/worker memory. Deep mutation of borrowed projections remains unsupported.

`results.json` contains all six accepted/source/caret/viewport cells. `analysis.json` contains phase summaries and inclusive, non-additive largest-task children. `hashes.json` identifies exact source and all 18 raw traces retained under `/tmp/alkalye-source-undo-projection/app`. Entry hashes are observed per arm in results; loaded script URLs are retained in traces. These are source-built disposable fixtures, not user data. Effect is the installed pinned 4.0.0.

Replay: archive `2ccca63` into separate baseline/runtime directories; install the candidate snapshot as runtime `src/client/source-textarea.ts`; link the pinned dependencies; build both. Restore the coherent rich seed identified by `measure.ts.txt`, use a separate work state, then run its six-cell runner and `analyze.py`. The retained runner includes an absolute root that must be changed for another checkout.

The first setup command failed before execution because its requested workdir did not exist; no cells or timings were produced. The first type command used nonexistent `types`; corrected `check:types` passed. Both errors preceded the measured arms. All test/browser/server jobs stopped; the original disposable allocation server was restored.

written with gpt-6 in codex
