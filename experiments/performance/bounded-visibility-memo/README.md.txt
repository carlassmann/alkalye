# Bounded operation visibility memo: sampled native pilot

Outside frozen 6b worker/app slice, one ordinary 1 MiB fixture trial per arm. One last fastpath-true operation string replaces repeated clock/canceller checks; existing cancellation graph cache remains. New cancellations and restore clear the memo; forks copy its value. No unbounded true-operation map. Production adoption remains pending independent validation on current production lineage.

Scoped types and 62 public tests / 24,997 assertions pass: TextVisibility/Replica cancellation, out-of-order and duplicate facts, fork/restore/floor, malformed inputs, Unicode/CRLF, plus 14 real SQLite replacement/peer/Undo/Redo cases. The SQLite test file was checked present before invocation. The same cases transferred to production's existing causal-text suite also pass. Earlier unbounded variant is HOLD; its initial missing fixture and absent SQLite path are preserved outside this archive, never claimed as this final coverage.

Both native arms passed first/second RAF logical source, projected source, native fragment, overlay text, exact caret and bounded viewport checks, all selection directions/ranges, and independent authenticated server edit/Undo acceptance. Same closed pristine seed cloned separately; fixed baseline server in both arms; source/worker assets differ only in the memo. Browser/managed server closed before parsing. No uncertain mutation repeated.

| Captured 3 s phase | Main task max baseline/candidate | Worker task max baseline/candidate | Worker clipped task union baseline/candidate |
| --- | --- | --- | --- |
| Selection | 1.170 / 0.919 ms | 134.288 / 130.469 ms | 136.809 / 132.864 ms |
| Ordinary edit | 6.396 / 6.753 ms | 165.221 / 125.296 ms | 746.545 / 698.603 ms |
| Undo | 7.413 / 7.323 ms | 153.374 / 143.229 ms | 631.875 / 632.108 ms |

Within the largest ordinary-edit worker task, sampled visibility.active self is 35.808 / 10.591 ms; opened materialize/read unique-frame inclusive is 155.796 / 117.894 ms. Baseline clock self is 15.724 ms; candidate has no samples on its distinct clock frame, which does not prove zero calls. Inclusive samples deduplicate recursive frame identity; nested totals are not additive. Selection/Undo largest-task profiles contain only two samples and support no function attribution. Whole-window task maxima and unions come from timeline events, independent of sampler density.

First/second RAF after trusted beforeinput: baseline 10.6 / 28.2 ms, candidate 7.0 / 18.0 ms; all six agreement predicates true. This finite sampled n1 pair does not establish a reliable latency gain, physical paint or 120 Hz. Existing native editing already displays optimistic text before worker acknowledgment. Main peaks did not improve. Undo worker total work did not improve. Worker tasks remain far beyond 8.33 ms.

GC events are reported separately in profile-analysis.json and overlap parent RunTasks. Main JS heap samples are not total browser/worker RSS; no consistent heap improvement claimed. The old save badge can precede the current receipt, so localSaved is excluded from sanitized results; API acceptance elapsed includes driver/trace waits and is not precise local journal latency.

Pins are pre-input no-cache network re-fetches of observed .js URLs plus explicit worker entry, compared with emitted bytes. This is not proof of execution coverage or original-response capture. Raw traces, profiles, SQLite, keys and private configuration remain outside Git; trace/source/emitted hashes retained. Initial parser used the wrong Undo filename and failed before analysis; corrected parser/result retained. Interrupted first review has no verdict; completed review metadata resolves claude-opus-5-5 and finds no source blocker, with remover-heavy alternation requiring measurement.

Written with gpt-6 in codex.
