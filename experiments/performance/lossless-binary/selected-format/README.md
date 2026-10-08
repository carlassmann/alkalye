# Conditional lossless persistence proof

Outside experiment only. No production adoption or normal-cost claim.

Normal records retain legacy event tags and binary encodings. Domain-specific typed predicates select versioned JSON event tags for unpaired UTF-16 units. The Unicode-mode native regex ignores valid surrogate pairs. No generic recursive scanner or validation bypass is used. Explicit history readers try the legacy framed codec first, then the JSON framed codec.

Workspace name and document excerpt projections receive nullable JSON companion columns. Exceptional strings use the companion; normal writes clear it. Readers use `COALESCE(companion,json_quote(legacy))` and Effect Schema JSON decoding. Document metadata, preferences and links already use JSON. Migration follows existing column-presence checks.

Strict source/fixture types passed. Two real DocumentSession/SQLite/server contracts, 58 assertions, passed in 1.084 seconds. They cover the retained failing middle insertion sequence with both lone surrogate directions, both snapshot modes, discussion, sync, saved snapshot, reopen, append and Undo. Public workspace history/snapshot/library names, document excerpt and title remain exact. Both normal and exceptional server event tags occur; normal committed-action payloads decode and re-encode with the unchanged legacy codec to identical bytes. This is an encoding oracle, not a historical old-database migration test or performance benchmark.

Initial strict types failed because Bun assertion generics distinguished Uint8Array backing buffer types. The fixture compares independent `.slice()` copies; the retained failure is not a product defect. No uncertain runtime actions were repeated.

Opus 5.5 completed a read-only review using Read/Grep/Glob, with Bash/Edit/Write denied. It found no omitted unrestricted string fields and approved the predicate/SQL design, but withheld production approval. The initial CLI invocation consumed the positional prompt as a variadic deny option and exited before a review; the corrected invocation completed. Its report predates legacy-first decoder ordering and migration column guards.

Remaining gates: populated pre-migration database and old event-byte fixtures; exceptional withdrawal reservations and rejected journal paths; schema evolution field coverage; deliberate old-reader failure; normal full-app time/allocation/byte costs. The existing excerpt cut can split a valid emoji; this separate behavior is not repaired here.

Rollout requires a conscious reader-first update or coordinated cutover. Older tabs cannot read new DocumentRecordedJson entries; old server rollback cannot decode new exceptional formats. Older scalar writers can leave JSON companion values stale. Already-lossy historical records cannot recover original units from their stored bytes.

Source snapshots are exploratory `.ts.txt` files with outside-relative imports. They are not application TypeScript modules. `source-sha256.txt` records the exact tested draft. Normal byte equality does not establish zero overhead or full legacy deployment compatibility.
