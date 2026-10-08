# Original main: one-time SDK creation

Untimed gate passed on frozen main `a749728a8f9a1cb984c980a5ea2daf984d60ae68`: public `createPersonalDocument` created one 2,048-unit document, the SDK awaited durable sync, a new in-memory SDK process read the exact source from the server, and the existing account's browser displayed it unchanged. SHA-256: `2273364cd6f408d0ed16b26d0508aa43c39894cf3dc347b86eb996afbe87a4f2`.

The pending marker was written before creation; the assigned document ID was privately persisted before waiting for sync. No second creation or Welcome mutation occurred. Private credentials, assigned IDs, profiles, source files and databases are excluded.

The first attempt failed in `startWorker`: account unavailable from peers. Both creation markers were absent, so no create had been issued. The corrected attempt reopened the existing browser profile read-only, verified received socket traffic, then kept it connected during creation and the independent read. This proves acceptance with that publication condition; it does not prove account durability while every browser is closed. The failed attempt is retained with its account ID redacted.

Both SDK processes exited zero. Browser source equality and digest matched the reader. Owned sync/static servers and browser contexts were stopped. These are fixture/oracle gates, not interaction performance measurements or a main/rewrite comparison.

Archived sources use private files under `/tmp/alkalye-main-sdk-proof`; replay must inspect markers and never repeat an uncertain creation. `proof.js` and installed alias configuration are in the preceding `main-sdk-reader` archive. This proof uses the original model and installed Jazz worker APIs, without changing original source.

written with gpt-6 in codex
