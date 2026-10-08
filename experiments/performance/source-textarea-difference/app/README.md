# Full-app SourceTextarea difference comparison

Written with gpt-6 in codex. Experiment proof; parent owns production adoption.

Frozen production `d26c0a8` versus only the two private block-comparison loops from the parent experiment. Candidate formatted before build; executed source hash is in `results.json`. Same native backend for both client arms. Each of three alternating pairs restored identical disposable SQLite data and browser profiles. A second browser session cleared its document cache and independently verified accepted source hashes after Undo and Redo.

Actual 1MiB document: trusted EOF `x`, Undo, Redo. Every cell passed exact native canonical and accepted source, durable pending-zero admission, source caret at the surviving predecessor, bounded native fragment and EOF viewport gates. Redo deliberately retains predecessor caret rather than requiring caret after restored `x`. Both changed client chunks appear in the retained traces; entry bundle hash checked against disk each cell. No worker cutover or main-engine removal is involved.

Every operation captured all main-thread RunTask events intersecting a three-second keydown-marked window, including GC. No CPU sampling. Refresh callback at generated `app.js:1653:476` maps in both arms to `document-app.ts:2654`, the scheduled refresh. Nested callback/RAF/enclosing durations are not additive. This comparison establishes refresh improvement, not a full-window or physical 120Hz claim.

| Metric, median (max)          | Before            | After             |
| ----------------------------- | ----------------- | ----------------- |
| Undo refresh enclosing task   | 9.818 (10.088)ms  | 7.208 (7.679)ms   |
| Undo refresh callback         | 8.088 (8.358)ms   | 6.040 (6.133)ms   |
| Redo refresh enclosing task   | 8.384 (8.860)ms   | 7.690 (8.661)ms   |
| Redo refresh callback         | 6.927 (7.082)ms   | 5.984 (6.702)ms   |
| Undo full-window largest task | 14.159 (14.297)ms | 14.547 (14.708)ms |
| Redo full-window largest task | 13.759 (14.040)ms | 13.616 (17.859)ms |

Undo refresh tasks fell below 8.33ms in all three candidate cells; one Redo task remains above it. Later minor GC dominates the complete windows; candidate Redo also includes a 17.859ms major-GC task. No overall frame-budget success. Main heap samples are retained; they are not process/worker memory or measured peak. Single-character input was an exactness setup gate, not a timed interaction claim.

Opus source review is frozen in the parent directory: identical algorithm outputs, no semantic blocker, rope/subslice allocation requires runtime proof. Public native SourceTextarea contracts already passed 25 scenarios; this app proof adds exact accepted Undo/Redo and viewport behavior. Candidate strict types passed. Initial `work` start failed because its copied fixture directory lacked a Git root; corrected before measured cells. That failure is preserved separately. All six final cells passed. Own browsers/proxy closed; original disposable 4461 process restored.

Reproduction uses `cell.ts.txt` and `measure.ts.txt` restored to `.ts` in a disposable copied root, current project browser driver, `/tmp/alkalye-terminal-header/data-seed`, `/tmp/alkalye-production-allocation-oct8/profile-seed`, and the long source fixture. Build both frozen client variants. `work` serves current native backend against restored seed, swapping only `assets-active`; background agent-browser uses stable 20000ms timeout. Raw traces remain outside Git under `/tmp/alkalye-difference-app`, with SHA-256 in results. `analyze.py.txt` contains initial task extraction; results also preserve the later RAF/refresh callback extraction and exact source-map coordinates.
