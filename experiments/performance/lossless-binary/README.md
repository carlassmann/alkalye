# Lossless binary boundary investigation

A retained baseline DocumentSession integration inserts `Fragment😀\n`, then `Lone\uD800\n` into the middle of a document. The second insertion sync fails with `Operation identity is immutable`, in both snapshot modes. Effect 4's installed SchemaBinary string writer calls `TextEncoder.encodeInto`; unpaired UTF-16 units become `U+FFFD`. Local optimistic operations retain the original unit while journal/server decoded replay changes it. Existing JSON snapshots escape and retain these units; atom compaction already prevents their merging. No user-source exclusion or replacement is an acceptable repair.

The rejected draft uses `SchemaBinary.toCodec(Schema.Union([Schema.fromJsonString(domain), domain]))`. This can preserve old tagged Recording variants but breaks legacy plain-struct CommittedAction and WorkspaceFact frames: adding a root union changes their wire discriminator. The byte contract explicitly retains this rejection.

The bounded alternate proof uses independent codecs: `Schema.Union([SchemaBinary.toCodec(Schema.fromJsonString(domain)), SchemaBinary.toCodec(domain)])`. Eight contracts, 24 assertions passed; strict TypeScript passed. It reads existing plain/emoji legacy bytes, reads new exact high/low surrogate values, rejects malformed/truncated frames, and exercises real EventLog writes into SQLite with separate legacy and JSON event tags. This is a codec/journal boundary proof, not a fixed production DocumentSession or server.

Opus 5.5 recommends versioned event tags, preserving existing schema/handler registrations and using independent codecs at explicit persisted-byte reads. DocumentWithdrawn also carries actions and must be covered. Already-lossy old records cannot be reconstructed from their bytes. Stale applications cannot decode new formats; recovery/cutover behavior needs a conscious decision. The review admitted one read-only Bash diff despite the requested Read/Grep/Glob restriction; it ran no builds/tests and made no writes.

Always writing JSON remains an unmeasured performance tradeoff. It repeats object keys and escapes snapshot strings again; normal production latency, task and byte-size measurements are required before adoption. Domain-specific well-formed-text checks may retain ordinary binary writes, but no custom recursive schema scanner or encoding bypass is proposed here.

No production change was adopted. `compatibility.test.ts.txt` is an executable outside-workspace snapshot with absolute imports requiring adjustment; it is excluded from the application TypeScript build. `rejected-domain-union.patch` is rejected evidence, not a patch to apply. The original full DocumentSession failed fixture was not copied before its later Unicode-valid correction; the sequence and log are retained separately under `/tmp/alkalye-compact-pieces`. No exact reproduction-file SHA is claimed.

## Full outside draft

`versioned-json-tags.patch` keeps legacy events and adds JSON events for DocumentRecorded, DocumentChanged, WorkspaceChanged and DocumentWithdrawn. Explicit committed-action and workspace-fact readers use separate framed codecs. The exploratory server handlers duplicate behavior; refactor before any conscious production adoption. Nothing is adopted.

Strict source types passed. The exact failed document sequence now passes both snapshot modes: two contracts, 30 assertions, including sync, discussion, saved snapshot, reopen and Undo. `document-session-pass.log.txt` retains the result. The executed document-only source was subsequently extended; no exact earlier test-source SHA is claimed.

The workspace extension exposes a separate genuine failure. Its public history retains the exact high-surrogate name, while `workspaceSnapshot.name` returns three replacement characters instead of one unpaired UTF-16 unit. Both modes fail. Raw SQL TEXT projection writes and reads workspace names; the authoritative JSON event does not repair that scalar projection. `workspace-projection-failure.log.txt` and `full-session.test.ts.txt` retain the failing oracle. This prevents claiming a complete UTF-16 repair.

Two harness failures are also retained: a test filter required an explicit `./` path, and the initial workspace history assertion used `.change` instead of `.fact.change`. The corrected typed assertion passes the history check and then fails at the real snapshot boundary. No further runtime or performance adoption followed.
