# Real browser writer cohort

Three-browser pilot and twenty-browser journey pass against production code at `a8cd7dce44597229001f3c8e8431790c4ce228c0`. Each writer has an independent account, persistent browser profile and actual editor. These are untimed correctness runs alongside other correctness jobs.

The owner creates and fills a 2KiB document through the UI, grants writer membership through the public API, and waits for peer cursors. Every browser makes one trusted native insertion of a distinct scalar at the document end. All twenty inputs occurred within the primary three-second observation window, spanning 295ms. This is a finite cohort, not sustained load or a latency benchmark.

Every browser reaches the exact converged source with no pending saves. Its caret remains immediately after its own inserted marker. Each account independently downloads and restores the accepted compact snapshot. The oracle checks the complete original source plus exactly one copy of every marker, not only document length. Loaded JavaScript paths are independently fetched and byte-pinned before the cohort.

All contexts and the managed server are closed. Private profiles and closed SQLite data remain outside the repository, separately preserved after each run. Packaged JSON contains results and resource observations, not authentication material. Process CPU/RSS brackets exclude browser descendants and cannot establish server capacity. No trace, frame-rate, physical 120Hz, offline-reconnect, continuous typing or large-document claim.

The archived driver imports the frozen runtime and browser driver from a private checkout. The first server launch failed before startup because the outside directory was not a Git repository. Initializing its isolated repository fixed process management; no document action was retried. Earlier fixture type/build diagnostics are retained outside.

written with gpt-6 in codex
