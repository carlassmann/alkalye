# Original multicursor save did not complete within the gate

This is a failed correctness prerequisite, not a timing comparison or proof of
permanent corruption. No timed capture was started for this case.

The frozen original was `a749728a8f9a1cb984c980a5ea2daf984d60ae68`.
A generated 1MiB document contained 512 instances of `TOKEN`. The native
select-all-occurrences command selected all 512. Trusted typing produced the
expected local source: 1,046,025 characters, compared with 1,048,585 before editing.

The save-event gate expired. No Undo, retry or reset followed. An independent
Jazz reader subsequently observed 1,026,585 characters. Root independently
verified that this body equals the seed with `[211055, 233055)` removed exactly:
22,000 characters, 49 lines, and no inserted replacements.

The original source collapses a changed envelope larger than 4,000 graphemes into
one replacement patch. Its synchronous patch writer deletes backwards in chunks
of 2,000 before inserting the replacement. The observed body matches eleven such
deletions. This suggests an interrupted save, but the actual invoked path and
cause are unproved. Browser shutdown timing was not recorded; the test may have
stopped a save still in progress.

The original also has a synchronous save branch without the document-saved event.
Therefore an absent event alone cannot establish a failed save. Subsequent gates
require independent exact server content, native content and selection; the event
is diagnostic only. The 128KiB and 1MiB ordinary typing/Undo gates subsequently
passed on both versions. This 512-selection case stays excluded from comparative
timings until a fresh fixture completes its full durability gate.

Raw summaries and source excerpts are retained with source hashes in
`archive-pins.json.txt`. `root-shape-verification.json.txt` records the independent
exact-deletion check. The generated fixture, accepted body, browser profiles,
credentials and database are deliberately excluded. The agent preserved the failed
runtime state outside the repository for further diagnosis.

written with gpt-6 in codex
