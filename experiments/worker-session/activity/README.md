# Scoped worker activity and lifecycle prototype

Outside production. Extends the single existing EditorElement/worker authority proof at ../integrated (commit 1e449fa). No second session or main Replica.

The worker reuses makeBackgroundWork. A unique scoped BroadcastChannel forwards native activity and synthetic pagehide separately from the mutation FIFO. Existing idle debounce and bounded admission remain. Activity and cooperativeWork flags are independent. This cannot preempt an already running opaque snapshot task.

Worker protection publishes changed dirty state. A lightweight Protection RPC returns flags/counters only, no source/atoms/handles. Main receipt order/uncertainty guards prevent stale clean acknowledgement from clearing newer failure. Dirty replies remain conservative. Recovery queries occur only for uncertain protection, with scoped FiberSet/coalescing. Clean Close requires native admission frozen and no pending/failure, then existing durable Close acknowledgement. Abrupt disposal retains draft protection, while channels and activity listeners close.

17 actual native browser assertions passed with cooperativeWork false, then the same 17 passed with true. Types passed. Gates cover trusted keys reaching the channel, periodic snapshot admission waiting during activity, native save clearing protection without another RPC, stale acknowledgement/new uncertainty, synthetic pagehide, exact local journal, graceful Close, real BroadcastChannel release, dirty in-flight abrupt disposal and late activity after close. The broader integrated 72 suite was not rerun in this adapter arm.

A separate real SQLite DocumentSession test blocked journal persistence, interrupted the saved fiber, emitted lifecycle.hidden and awaited durable cache completion. The unmodified baseline already reported protection false and reopened exact source: 6 assertions passed. The initially expected bug failed, preserved in journal-baseline.log. No shared drafts.update patch was applied. This runtime result supersedes the review's hypothesized missing update.

No latency, 120Hz, physical unload durability, physical IME/mobile or accessibility claim. Flush checks local durability. Abrupt dirty teardown intentionally retains beforeunload protection under the pending-draft owner; it is not a clean resource reset.

Replay: copy integrated proof runtime, replace these .ts.txt snapshots after removing .txt. Build/run its server.ts, then activity-journey.ts with printed URL and again with ?cooperative=1. Background agent-browser uses a stable 20000 ms timeout. Journal proof uses an unchanged source copy and real SQLite; run journal-proof.ts with --clean. Source/bundle hashes in results.json describe executed files. Sources are .ts.txt so workspace checks do not compile disposable imports.

written with gpt-6 in codex
