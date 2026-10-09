# Optimistic Undo negative proof

Outside prototype; no production adoption or latency claim. Written with gpt-6 in codex.

Exact base 754c9d643c461e736a36c2b1760499edfbd885a4. Single insertion-only local contribution certified only after ordered history and successful sync; otherwise original fallback. Uses existing unsaved queue, draft owner, protection and fresh journal admission. No second authority or journal.

Strengthened source: strict PASS; 22 real public cases / 273 assertions PASS (original 3/39, new 5/68, existing 14/166). New cases exercise accepted peer insertion, real server ACL denial/regrant retaining pending IDs, injected pre-write journal failure, actual interrupted caller after optimistic publication, and scope close while queued. Every case preserves later Unicode typing and independent accepted source/count plus cold reopen.

Initial negative run 4 PASS / 1 FAIL, retained: fixture read Fiber.interrupt's void return as Exit. Fixed via Fiber.await; strict also required moving fault injection to typed journal.write rather than generic withLock. Original failed closed fixture is preserved outside this archive; no DB/profile included.

Exact Opus 5.5 reviews retained, including HOLD. Latest conditional GO reviewed before the final added accepted/durable-generation and position guards; final guards executed in the strengthened suite. Close finalizer ends queue before flush; ensures unresolved Deferreds fail unknown, retaining admission markers/queue/drafts. Rebuild swap checks replica identity/generation, durable identity/generation, accepted identity/generation, local journal position, draftVersion and proposed status.

Limits are explicit in results.json.txt. Native early refresh/caret, close racing preparation, post-commit interruption, transient deterministic-conflict recovery UI, and offline certificate coverage remain unproved. Existing uncommitted owner drafts are memory-only; this slice adds no durable pending-draft format. No performance claim from test durations.

Allowlist contains code, focused tests, small logs, review/prompt metadata, result summary and hashes only. No profiles, DB, keys, raw native traces or private account settings.
