# Terminal cancellation with merged frontmatter

Candidate extends the existing validated terminal insertion cancellation cache to canonical source whose merged frontmatter differs from its raw atoms. It verifies provenance and both final atom identities, then removes that atom from each view using independent offsets. Validation, permission checks, generation/signature preflight and immutable publication remain unchanged. Header-only and structural fence changes use the general path.

Root approved the production slice after native caret/viewport proof and review. Final repository checks remain with the parent agent. Redo, which cancels a cancellation, continues through the general path.

## Evidence

126 public Replica, frontmatter and checkpoint cases pass, with 1915 assertions and strict types. The added 13 cases exercise merged metadata, peer body edits, Unicode, cancellation chains, repeated delivery, redo, malformed atomic publication and independent checkpoint reconstruction. The full frontmatter suite includes invalid aliases following an undone anchor. Read-only Opus review found no blockers.

Six actual-app cells alternate baseline and candidate, three each. Browser baseline bf51704 and candidate differ only in `prepareTerminalCancellation`; both use the same unchanged native Bun backend 0e13876. Each cell restores identical stopped database and authenticated profile snapshots. The one MiB wrapped document has retained metadata/history; it is not a newly seeded helper fixture. Each trusted append and Undo is checked locally and in a separate browser whose document journal was cleared, confirming accepted source hashes.

| Main thread trace measure             | Baseline median | Candidate median |
| ------------------------------------- | --------------: | ---------------: |
| Trusted append enclosing task         |        6.493 ms |         6.573 ms |
| Append largest deferred task          |       18.183 ms |        18.083 ms |
| Undo largest complete task            |      203.502 ms |        25.744 ms |
| Undo three-second busy interval union |     1421.434 ms |       893.123 ms |

Undo largest maxima are 224.540 and 27.220 ms. Undo still has 21–22 tasks above 8.33 ms in each three-second window. This does not establish 120 fps. Timing excludes CPU sampling. Nested trace events are not added to their containing task.

Sampled main JavaScript heap after append has medians 697.4 and 694.6 MB, maxima 1269.1 and 721.7 MB. These samples neither measure total browser memory nor prove a consistent allocation reduction.

## Separate diagnostic

One sampled baseline Undo identifies cold `Replica.text` materialization within the 188.942 ms refresh animation-frame task. Restricted samples attribute 153.207 ms inclusive to `text`, 111.995 ms self to `rawVisibleSteps`, and 17.193 ms self to editor anchor resolution. This is diagnostic attribution, not a timing comparison. Whole-window compaction samples belong to separate tasks and are not added to the refresh task.

The diagnostic uses unchanged baseline browser/backend code and exact accepted append/Undo gates. Raw traces remain outside the repository; their hashes and extraction outputs preserve provenance.

written with gpt-6 in codex

## Native cache and caret gate

A separate instrumented run confirms validated dual-view cache publication. After accepted Undo, source selection start and end both equal 1048576; the viewport ends at projected EOF, the native fragment contains 1995 characters, and the outer scroll is at the bottom. Four publication events occur across staged/apply paths; this proves applicability, not a once-per-action callback count. The source and entry bundle hashes for this diagnostic differ from the uninstrumented timing arm and are recorded separately.

Raw trace files remain at the absolute paths in `provenance.json`; SHA-256 hashes record their exact bytes. Timing results include complete enclosing RunTask spans and their three-second aftermath, not just input listener durations. Main-thread sampled attribution is restricted to the longest diagnostic task; the original extractor’s absent-flag `sampled:false` label is omitted from the compact report because the runner explicitly enabled CPU sampling and the raw trace contains CPU Profile events.
