# Compaction expected-ID comparison: HOLD

N1 actual production matched pilot, frozen 18dbb7679877bb366fd4f1702f4b051f6157ca1b, CRDT4a/TextVisibilityf7. ONLY model.compactAtomSteps expected-ID concatenation changes: identical slice/Number/String/padStart8 semantics, exact length plus native startsWith/endsWith. No prefix cache, digit math, string-piece assembly, worker cutover or schema changes.

Both arms passed all exact trusted native source/fragment/caret, Saved revision, independent read-only API accepted edit+Undo (same log advancing positions28→36→37), restored source/caret and online reload gates. Fresh per-arm copies of the same retained accepted account/history DB/profile. Requested JS SHA matched immutable built output before keys; request inventory is not execution coverage. No CPU sampling or forced GC in these comparison windows. Own browser/server scopes closed after each cell.

| 1MiB, n1 | Control | Candidate |
| --- | ---: | ---: |
| Input beforeinput→exact native frame opportunity, ms | 10.5 | 10.9 |
| Input full main RunTask maximum, ms | 10.748 | 11.397 |
| Input main busy union over3s, ms | 718.367 | 795.169 |
| Input largest main GC event span, ms | 10.134 | 2.830 |
| Undo z→exact native frame opportunity, ms | 28.9 | 28.0 |
| Undo full main RunTask maximum, ms | 10.052 | 7.864 |
| Undo main busy union over3s, ms | 652.075 | 782.120 |
| Undo largest main GC event span, ms | 9.582 | 3.197 |

GC pauses improved in this pilot, but busy work increased10.7% after input and19.9% after Undo. Input's largest task remains the initiating native event; candidate11.397ms. Undo's candidate peak7.864ms is an update callback, while baseline10.052ms is largely9.582ms minor GC. These are inclusive nested spans, never additive. HOLD: no adoption, no n3 expansion or broad responsiveness claim. Frame opportunity is the observer rAF satisfying exact source/native/caret, not model assignment, paint or physical refresh. Correctness agreement gates are separate; this pilot does not record an independent non-rAF assignment timestamp.

Fixture:1,048,576 UTF16 units /1,048,576 UTF8 bytes /20,767 real newlines; SHA0ba3f77995fce57ab0142bbb058e5413468afd515c1b2592079091656a89091b. Middle single-character input; no sustained interaction, many-document load or full product parity claim. Independent API polls happen after trace windows; receipt observations are not server latency.

Both control and candidate public gates:29tests/4,983 assertions, scoped types clean. Exact operation wire parity covers empty/short/malformed IDs, NaN/Infinity/exponents/hex/negative/rollover, different same-length prefix, overlapping prefix/suffix, Unicode/lone surrogates, structural flags and2M run limit. Public durable checkpoint bytes/cold reconstruction match baseline; realSQLite independently decoded cache bytes match baseline compaction in the same synchronous/cooperative mode, followed by exact discussion/cancellation reopening. Existing public ownership/interruption/generation gates passed. Opus requested claude-opus-5-5, terminal0, no semantic blocker; identified prefix/overlap test gaps were corrected. Resolved response model ID is not returned by plaintext output, so not independently claimed.

Failures retained: initial strict scope included omitted exploratory fixture imports/build and inferred boolean flags; corrected scoped includes/build and typed Atom[] fixed it. Strengthened SQLite byte oracle initially compared synchronous visibility key order with cooperative checkpoint output; corrected to compare SAME capture mode, no normalization or production change. Native strict first invocation used control cwd before runtime handoff and lacked tsconfig.journey.json; corrected cwd passed before any keys. No uncertain action retried.

Archive excludes DB, profiles, credentials/key, private manifests and raw traces. production-analysis.json retains all4 raw trace SHA/bytes and numeric results; public-cell-witnesses.json keeps probe events/frame samples, actual selections, asset pins and scope closure. Source snapshots are.txt and remain experimental. Native driver/pilot/parser snapshots reflect executed sources. WITNESSES.json is the archive allowlist.

written with gpt-6 in codex
