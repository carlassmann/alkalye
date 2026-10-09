# Reject the small-map adjacency wrapper

This separate prototype keeps a native Map until 4,096 predecessor keys, then promotes to insertion-ordered pages. Public contracts passed, including interrupted promoted forks followed by parent writes and exact retry checkpoint/durable bytes. Opus found no correctness blocker.

Eighteen isolated many-target cost cells passed exact source, wire order, fork independence and both first-write directions. The workload contains 1,000 small documents plus a 128KiB document. Synchronous load regressed from 65.057 to 78.484ms, cooperative load from 191.681 to 211.329ms, and durable checkpoint creation from 18.959 to 22.243ms. Forking improved from 10.432 to 4.587ms. The planned 54-cell continuation was stopped. No native timing or production adoption followed.

These measured regressions remain unexplained. Subsequent diagnostic profiles do not establish wrapper dispatch as the cause. They use warmed, separate fixtures and cannot replace the combined cold comparison. A separate iterator experiment may test checkpoint overhead; it is not a proven loading fix.

Original sources, reviews, failures and results are retained unchanged. The archive map records exact bytes and SHA256. Production remains unchanged by this experiment.

written with gpt-6 in codex
