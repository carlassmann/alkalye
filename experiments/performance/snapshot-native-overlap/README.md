# Snapshot input preemption: native mechanism miss

One fresh control/candidate pair; eight trusted native keys, nominal100ms cadence, then one trusted Undo. Actual production754c9d6 with identical markers; candidate only two snapshot modules. Both arms passed loaded-byte, complete source/native caret, independent seed, post-capture immutable prime history, final accepted edit/Undo and reload gates. Prime was excluded from the measured first event. The first burst key occurred inside actual compaction in both arms; ensuring recorded a terminal compact-end even if interrupted.

| 3s window                  |    Control |  Candidate |
| -------------------------- | ---------: | ---------: |
| Input max main RunTask     |   13.526ms |   16.857ms |
| Input main task union      | 2224.097ms | 2467.723ms |
| Input largest main GC span |   12.558ms |   13.697ms |
| Undo max main RunTask      |   12.719ms |   13.764ms |
| Undo main task union       |  595.120ms |  696.876ms |
| Undo largest main GC span  |   12.066ms |   12.966ms |

Final eight-key source/caret rAF opportunity727.9→760.8ms; this includes the intentionally paced sequence, not single-key latency or displayed paint. Last-key→opportunity8.5→6.9ms in this pair. Undo source/caret opportunity34.6→37.7ms. All main task durations include nested GC; GC spans are separately reported, non-additive, and do not establish retained allocation ownership. No physical120Hz claim.

Candidate emitted ZERO capture-interrupted marks. Both arms performed multiple whole-document captures during the paced burst. Source audit identifies a competing forced path: BrowserLibrary automatic synchronize()/drain calls session.save after session.sync; public save bypasses automatic snapshot-input race. No origin-specific marker was captured, so exact origin remains unproved. HOLD adoption; no n3 on a mechanism miss.

Prime acceptance was verified AFTER timing by an independent Replica preloaded from an authenticated public snapshot before keys, then public history after the frozen position. The reader performed no HTTP/restore work during the timed window. Its prime source hash/position/action digest was retained. Control history page held9 actions; candidate held8 at read time. Independent final source receipts then verified all eight keys plus prime at position44, and Undo at45. Never claim the intermediate reader saw all final contributions before timing ended.

Preserved earlier failures: short commit SHA rejected before keys; full-source prime eval ENOBUFS after one prime mutation; active-compaction wait timed out before burst keys; attempted replay guard rejected before setup. None is a performance result. No uncertain mutation was retried. Each corrected attempt used fresh copied seed/profile/database.

Clean six-case real-storage preemption proof6/101 and active checkpoint interruption proof1/20 are archived separately at d9fed83. They demonstrate capability behavior; this native pair did not exercise interruption. Sources reconstruct from Git754 + control-markers.patch + candidate-vs-control.patch; per-arm source/build/served assets retained. Raw traces remain outside Git, with SHA256/bytes in pipeline-analysis. No cookie/config/profile/database/key material is allowlisted.

written with gpt-6 in codex

Raw producer prose is preserved in `README.md.txt`. Producer JSON uses `.json.txt` so formatting checks do not change signed bytes. `archive-verification.json` records the independent archive checks.
