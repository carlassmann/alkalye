# Certified terminal Undo cursor position

Production candidate uses a private certificate written only after the existing validated terminal cancellation cache publishes new immutable source atoms. It records the exact old/new view pair, removed terminal ID and new UTF-16 EOF. Editor anchor resolution reads that certificate and checks its offset against current source length; all unmatched view pairs and IDs retain the exhaustive fallback. The producer also checks the frozen atom and unchanged final predecessor. Generic arrays and duplicate IDs cannot populate the private certificate.

Nested WeakMaps keep both view identities weakly keyed. There is no public setter, new identity index, source-prefix inference, or change to atom/view contents. The shared atom-sequence module is unchanged.

## Native proof

Strict types and 20 public Editor contracts pass: 16 existing cases plus real Replica terminal ASCII/emoji Undo, selected range and empty header body. Existing cases cover duplicate/reordered survivors, large deletion, legacy widths, unknown identities and missing anchors. The empty-header case can use the general path; a caption reading “certified” in the original run log does not establish eligibility. Snapshot captions were subsequently corrected without changing the scenarios.

Read-only Opus review finds no blocker, tracing raw and canonical ID uniqueness through the validated atom index and nonoverlapping frontmatter projection. Its optional broader hardening of the existing public operations Map is outside this slice.

A separate instrumented actual-app run proves applicability: public readonly lookup for old 1048577/new 1048576 atoms returns 1048576, and the Editor emits one verified-use event with matching source length. Accepted Undo SHA, EOF selection, bounded 1995-character native fragment, viewport EOF and bottom scroll all pass. Diagnostic source/build hashes differ from the timing candidate. The gate did not directly fetch the served bundle hash; its candidate-only events establish that code was present.

## Matched actual-app measurements

Three baseline/candidate pairs alternate order, with identical stopped database/profile resets. Baseline browser and unchanged backend are frozen 52670c0; candidate browser changes only the private certificate and Editor lookup. Timings contain no CPU sampling or eligibility instrumentation. Every cell verifies entry bundle SHA, trusted append, local and independent accepted append/Undo hashes, EOF selection and bounded viewport.

| Main thread measure                   | Baseline median | Candidate median |
| ------------------------------------- | --------------: | ---------------: |
| Undo largest complete task            |       25.607 ms |        13.449 ms |
| Undo refresh callback                 |       24.171 ms |         7.458 ms |
| Complete task containing that refresh |       25.607 ms |         9.023 ms |
| Undo three-second busy interval union |      896.755 ms |       885.949 ms |
| Trusted append enclosing task         |        6.550 ms |         6.572 ms |

Undo largest maxima are 26.233 and 14.046 ms. Candidate’s largest tasks are deferred MinorGC, 12.8–13.8 ms, rather than the refresh. The refresh task itself ranges 8.724–9.083 ms, still beyond 8.33 ms. Counts of complete tasks over 8.33 ms remain 21–23 in both arms. No 120 fps, physical 120 Hz, broad Undo/Redo, general cursor or GC-frequency claim follows.

Refresh FunctionCall maps to document-app.ts:2654 in both builds. Its callback and containing task are separately reported; nested trace durations are not additive. Main-thread phase markers bound the three-second interval; RunTask busy time uses the union of intervals.

Main JavaScript heap samples after append have medians 723.9 and 692.2 MB. They are not total browser memory or proof of causal allocation reduction. Largest deferred append tasks remain about 19–21 ms. Source and caret semantics improve without resolving those separate stalls.

Raw traces remain at the absolute paths in provenance.json, with exact SHA-256 hashes. Source snapshots are evidence, not executable repository modules.

written with gpt-6 in codex
