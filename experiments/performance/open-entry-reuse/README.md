# Single-use opened journal entry reuse

Outside-runtime experiment, frozen production `72dd6f5`. Same native backend for both client arms. Candidate changes only the private DocumentSession opened-entry path. Root owns production adoption.

Earlier sampled `first-open-replay` proved the same 134,956-byte snapshot was restored in the EventLog write handler and again during durable replay. This candidate restores from privately copied encoded journal bytes, retaining that private Replica for one matching durable row. Reuse requires exact entry identity/bytes, unchanged empty projection, replica identities/generations, cursors, document and subject. Failure, interruption, reset, competing row, empty replay and scope close discard it. Changed bytes still receive full snapshot validation. No object-identity cache, trusted format or second authority.

The row snapshot captures immutable ID string/event/primary key and detached bytes before decoding; those same captured values drive comparisons and replay receipts. It avoids extra Schema.Class validation and mutable branded-ID aliases. Other recording kinds retain existing validation/proposing order.

## Actual cold browser comparison

Three alternating pairs, disposable database/profile restored per cell. The fixture deletes document journal IndexedDB databases before opening the small document. Then trusted navigation switches from 2 KiB to 128 KiB. Every cell verifies route/editability, full native source digest and independent accepted HTTP source. Entry and source-map-identified DocumentSession chunks are required to be requested and match frozen SHA-256. No diagnostic marks, hashes or CPU sampling in performance bundles. Trace windows include all main-thread tasks/GC for three seconds.

| Metric                   | Baseline median / max | Candidate median / max |
| ------------------------ | --------------------- | ---------------------- |
| Presentation opportunity | 646.489 / 661.012 ms  | 529.380 / 533.519 ms   |
| Largest main task        | 19.406 / 19.589 ms    | 19.144 / 20.336 ms     |
| GC union                 | 35.101 / 36.251 ms    | 19.838 / 22.091 ms     |
| Layout union             | 32.299 / 33.625 ms    | 33.853 / 37.018 ms     |

All six gates passed. Readiness and GC improved; worst task regressed. No 120fps, physical frame-rate, whole-app or server performance claim. Cold means journal/passive miss under this fixture, not cold OS/network caches.

## Activation and correctness

Separate one-cell diagnostic adds restore-site phase marks only. Exactly one target restore occurs during record validation; zero replay/other restore marks occur. Exact native 131,072-character source and independent HTTP receipt passed. Diagnostic timing is excluded from the comparison.

Strict types passed before and after final formatting. Final public corpus: **30 tests, 122 assertions, zero failures** across five deep modules. New eight cases cover caller mutation after EventLog encoding, failure/interruption after validation but before journal insertion, and differing payload bytes with identical row ID. Getter fixture changes bytes between reads; fixture guards confirm corruption/failure hooks actually execute. Existing cases cover overlapping/racing opens, postcommit interruption, offline reopen, exact edited/undo state, passive-session isolation, recovery and durable checkpoints.

Precommit cases prove durable publication behavior; they do not inspect private slot cleanup. Error injection uses Effect.exit because the existing EventLog path may surface non-SQL errors as defects. Actual transaction/physical disk guarantees are unchanged.

Claude CLI `claude-opus-5-5`, tools disabled: initial handle8813 and final59803 both terminal0, no reuse-logic blockers. Initial review identified constructor-validation defects and fixture error handling; corrected before final execution. Reviews are source-only, not runtime certification. Final test additions ensure fixture hooks execute; no implementation-count assertions were added.

## Failures and provenance

Initial work launch lacked an outside Git root; no browser ran. Subsequent setup attempts over-pinned lazy chunks, then omitted modulepreload resources through the old script-only filter. No timed sample came from those failures. Corrected resource inventory matches known `0e412da` behavior. All requested JavaScript resource paths count, with unchanged loaded-path/hash oracles. Cold journal deletion is an explicit fixture-only modification. Count-copy setup also initially rejected an absent working directory and followed broken helper symlinks; corrected before the count build/run.

Original logs, failed setup results, corrected runner/source snapshots, patch, complete six results, compact task/activation summaries and exact hashes are retained. Large traces remain in `/tmp` with SHA-256 provenance. Private account/config/profile/database files are omitted. Snapshot `.ts.txt` files preserve executed bytes; they are not production modules. All managed servers/browser scopes closed.

written with gpt-6 in codex
