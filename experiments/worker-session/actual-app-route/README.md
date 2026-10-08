# Actual worker app route: correctness prototype

Outside copy `/tmp/alkalye-worker-app-route`; actual BrowserLibrary documents RcMap, actual document-app route, existing EditorElement/native textarea, one worker DocumentSession. Dev flag `?worker=1`. Production unchanged. No latency, memory, physical 120 Hz, or full feature parity claim.

Base `72dd6f5`; refreshed DocumentSession snapshot-reuse source SHA `fdbc79466a33698c583c33e4d9d10410bfccaecd33bc324080da491a248c6ef8`. Installed Effect 4.0.0. Current source snapshots are the final eight-gate journey variant, including the revision-based idle merge gate added after the earlier append proof. `source-hashes.json` records their exact bytes. Initial reviews cover earlier variants; none certifies the final source as production ready.

## Executed proof

Strict verification terminal 29610: pass. Actual browser journey terminal 13417: eight gates pass:

- Independent public API: A equals known 2,048-character fixture plus previously accepted native `x`.
- Trusted Undo restores A to the exact independently accepted original.
- Actual library button opens fresh B, created once through the public API.
- Birth-only B: native Undo changes neither source nor writable state.
- Native `y` after no-op Undo: exact selection end and independently accepted source.
- Native Undo restores B's own known source durably.
- Actual library button remounts A after B without a second main session.
- Full flagged reload restores exact durable A, writable and visible.

Earlier terminal 3752 separately proved actual trusted beforeinput/input append, exact caret 2,049, and independent server acceptance. Earlier failures 90673, 47478, and 37573 are retained: same connected editor/textarea, but computed visibility hidden and focus stayed BODY. The worker opening branch skipped existing `finishOpening()`, leaving app `aria-busy` styles active. Calling that existing lifecycle function fixed the actual integration; repeated refocusing did not mask it.

Own browser closed and server 51349 stopped after the final journey. Source A was restored through native Undo, not an API reset. Fresh B's assigned ID is recorded; no arbitrary repeated Undo exhausted existing history.

## Replay and provenance

Create a real disposable copy of base 72dd6f5. Materialize `source/**/*.ts.txt` as their original `.ts` paths, plus root source snapshots. Use Bun and the installed pinned dependencies. Start `bun server-app.ts`; this rebuilds the actual app and worker bundle on disposable port 4473. Provide a separate authenticated fixture profile and public API oracle config; the original private config/key/database/profile are deliberately excluded. Adapt fixture paths and IDs before replay. Run `bun run check:types`, then the native journey. Preserve journals between append and Undo; clear only copied service-worker and HTTP/code caches before boot.

Observed resource URLs are recorded. Server dist hashes were captured **after** each completed proof, not from the browser's loaded bytes. No retrospective loaded-byte hash claim. `raw/*.json.txt` preserves original evidence bytes; formatted JSON contains the same data. Paths to private oracle files appear in replay source, but credential contents are absent.

## Remaining release blockers

Opus reviews retained their HOLD outcomes. Subsequent source fixes address basis-rebase ordering, no-op Undo state publication, stored-recovery leave, and idempotent save/sync marker reopening. Those recovery faults, offline/ACL/concurrent-writer cases, interrupted storage, corrupt-ledger export, and multi-receipt reload still need public runtime proof.

Native edits have a scoped durable FIFO ledger with exact intent digest/receipt checks. Undo/domain commands still lack a complete durable pre-dispatch intent ledger. Unknown outcomes must remain retained; length alone cannot establish command agreement. Journal/receipt publication is not atomic. Physical unload before IndexedDB commit remains unproved. Full accepted-source copies may cause allocation costs.

Same-account second-tab ownership uses bounded rejection, an explicit dev-only parity gap. Atom-dependent comments, presence, history, drawing, attachments, theme controls, and other full-app consumers are not migrated. Permission/offline notices and lifecycle scopes require broader tests. This is one authority architecture prototype, not an approved production cutover.
