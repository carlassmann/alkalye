# Immediate Undo: public boundaries

Outside prototype. Strict checks and 22 public tests / 273 assertions passed.
Real SQLite/session scopes cover peer edits, server permission denial and
regrant, write failure, interrupted publication and queued close. No native
latency claim or production adoption.

The certificate currently requires a successfully synchronized insertion.
Offline and pending edits use the existing fallback. Close during preparation
and interruption after commit remain unproved. See results.json.txt and the
unchanged producer explanation in README.md.txt.

Producer bytes are preserved. The full Session is reconstructed from Git plus
candidate.patch.txt; archive-verification.json.txt records hashes and
deduplicated files.

written with gpt-6 in codex
