# Initial index handoff: not adopted

Frozen c922a8d. Outside candidate hands SourceTextarea's initial TextIndex to EditorViewport, which forks its immutable root into a separate mutable handle. String callers keep the existing constructor. The handed index's value supplies initial acknowledgment; no unchecked source/index pair.

Corrected native fixture passed 7 gates and 123 public assertions: raw/projected URLs, CRLF/mixed CR runs/cross-leaf newline, emoji selections, trusted typing, stale-source reconciliation, command Undo and composition defer/reconcile. Undo is a trusted keyboard command invoking public reconcile, not browser-history Undo. Composition uses programmatic DOM events, not physical IME. Initial Meta+z and Control+z browser-history waits failed; then programmatic composition lacked sync after leaving hold mode. All failures retained. Strict passed after acknowledgment correction, before the later fixture-only corrections.

ONE frozen-baseline actual cold 2 KiB→128 KiB application switch passed exact route, native source/readability and independent HTTP receipt gates. Constructor-only UserTiming spans: first TextIndex 0.200 ms, duplicate viewport TextIndex 0.099 ms, EditorViewport 2.099 ms, SourceTextarea 2.299 ms. Nested spans overlap. This is an instrumented attribution diagnostic, not a speed comparison, full mount attribution, 1 MiB result or FPS proof. The earlier small correctness fixture may have overlapped preparation; no comparative timing claim is made. Duplicate construction is too small to justify adoption or an A/B.

Sources are snapshots. Runtime was /tmp/alkalye-initial-index-fork; managed servers and disposable browser contexts closed. Large trace/profile/private manifests remain outside Git. Candidate and fixture source hashes are recorded in results.json. Baseline diagnostic source snapshots retain the exact constructor marks.

written with gpt-6 in codex
