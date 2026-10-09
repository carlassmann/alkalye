# Twenty-writer server diagnostic

One instrumented real public integration: 20 distinct signed writers, 10 WebSocket + 10 HTTP-poll peers, 20 independently persisted SQLite DocumentSessions, 8KiB document. Three presence-only rounds; three edit-only rounds; three combined rounds. 120 online edits, four offline writers/reconnection, independent reader rejection/final snapshot, closed-poll410. 699 assertions PASS. All owned server scopes closed.

SQL counters wrap installed Effect Statement.CurrentTransformer on live session/role authorization only, return the unchanged statement, and preserve all ACL checks. Delivery counts precede actual peer.send. Poll delivery independently revalidates queued presence; counts include this necessary privacy work. No stale authorization cache.

Presence-only1140 deliveries/14352 role statements; edit-only1200 advanced/9360 role statements; combined1200 advanced+1140 presence/21956 role statements. HTTP commit p95~221ms/max300ms across120 operations, instrumented n1. Timings include instrumentation; aggregated authorization durations overlap and are not CPU. Original test explicitly syncs sessions twice per round: not BrowserLibrary wakeup/phone capacity. Presence phase includes session opening before the edit phase. No25Hz sustained saturation or memory-capacity claim.

Initial strict failure (undefined round from source generator) retained; fixed before any runtime mutation. Corrected/final strict PASS. No production candidate/adoption here. Scoped advanced filtering remains rejected/HOLD.

Next source-backed attribution: poll take() repeats sender currentPresence validation for each queued cursor; broadcast() already authorizes recipient and role. Batching/coalescing is only a hypothesis until sustained latest-state/departure/revocation tests and actual phase attribution. Preserve sender/recipient ACL checks.

written with gpt-6 in codex
