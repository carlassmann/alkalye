# Rejected unchanged-input paint guard

Multicursor input calls `SourceTextarea.replace`, which renders the new text, then dispatches an input event. `SourceTextarea.input` sees no further native edits and calls `EditorViewport.acknowledge`, painting again. A tentative outside-workspace prototype skipped that second paint when source, native value and native selection matched the last paint. No production code changed; no runtime or timing experiment ran.

Opus 5.5 rejected the guard on source review. The first paint chooses visible block indices before refining estimates. Refinement can change block heights and scroll position. The second paint recomputes the visible window from those new measurements. Matching DOM and source therefore does not prove that the second paint is redundant: skipping it can leave a short or stale visible fragment after a windowed multicursor edit.

A stronger guard would need settled paint revisions and viewport snapshots, plus composition and selection checks. That adds state and layout reads without evidence of a useful gain. It was not implemented. The next permissible experiment would measure the second paint without skipping it and assert that window, fragment, selection and DOM remain unchanged whenever a candidate guard claims a no-op.

The existing 25.6 ms median is a prior 1 MiB replacement across 2,048 cursors, not an ordinary single-caret typing measurement. Its earlier sampled path attributed most synchronous work to `DocumentSession.replace` and optimistic `Replica.apply`. Repeated overlay updates sort and serialize selections, but no current profile establishes their share. No performance improvement is claimed.

written with gpt-6 in codex
