# Children index validation

The one-MiB typing trace isolated a new child-anchor insertion into a native Map with 1,048,576 entries. Its write took 12.251ms. The candidate reuses the existing partitioned copy-on-write atom index for child anchors; that write took 0.181ms in the first matched native run. The enclosing task fell from 21.569ms to 8.508ms. Native Map capacity growth is the inferred cause; the trace does not sample V8 internals.

The candidate preserves the Replica authority, operation format and sibling ordering. Lazy buckets avoid allocating 256 Maps for every document. Forks share buckets until a write; sibling arrays are still copied before insertion. Ordinary candidate child writes cost about 0.170ms versus 0.003ms in this control, so the optimization trades small bounded copies for the large capacity stall.

Both arms passed eight trusted body keystrokes, exact source and native caret, independent server receipts, Undo and reload. Input-window CPU fell 28%; Undo-window CPU fell 17%. This is one matched run. Candidate tasks still reached 14.043ms; Undo reached 15.086ms. Neither these numbers nor an observer rAF demonstrate physical 120Hz presentation. Repeated confirmation and production checks remain required.

The public Replica contracts cover independent fork writes, concurrent merging, cold restoration, and checkpoint atom order with frontmatter. Both full Bun test runs passed 754 tests and 41,782 assertions. The fast app journey failed on document creation under parallel checks; a standalone run passed. That unresolved browser gate prevents declaring the full check successful.

The separate checkpoint probe used identical synthetic one-MiB facts through `durableCheckpointEffect`. Compact JSON grew 184 bytes; gzip grew 57 bytes, from 6,348 to 6,405. Both snapshots restored exact source through the public decoder. This measures bytes and correctness, not cold loading or compression latency.

The next full check passed the fast app journey and all seven browser module suites, but finished with 747 Bun passes and seven failures. Six exceeded their existing deadlines; the 24-writer journey received HTTP 410 after 83 seconds. System load was observed at 38.61 with unrelated builds running. That observation does not prove the cause. The failure remains recorded; the check is not green. A repeated native comparison also stopped before keys when the control snapshot exceeded the application's 20-second deadline. No timing result from that attempt supports adoption or a regression claim. Follow-up validation is still required.

The raw README is retained unchanged. To reconstruct the marked native arms, apply `control-reconstruction.patch` or `candidate-reconstruction.patch` directly to b5577ba. `verification.json.txt` maps each original producer filename to its archive filename and verifies byte counts and SHA256 hashes. Executable and JSON producer files carry a `.txt` suffix to preserve their exact bytes without joining the application type and format checks. Private profiles, databases, credentials and full traces stay outside Git.

written with gpt-6 in codex
