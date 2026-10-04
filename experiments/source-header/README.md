# Source header experiment

Run `bun test ./experiments/source-header/*.test.ts`.

This rejected experiment stores raw YAML entries in per-key registers. Document metadata would be derived from the assembled source. Native Effect Schema validates event and snapshot shapes; EventLog and SqlEventJournal persist and replay events through the application's Bun SQLite adapter. The experiment is outside the production import graph.

Eight tests cover independent title/comment edits, EOF formatting, body separators, weak migration priority, quoted keys, concurrent header deletion, snapshot reopening and native persistence. After 500 title edits, the header snapshot is 336 bytes and 501 event payloads total 40,521 bytes. These measure only this header seam; they exclude the body CRDT, undo, identity receipts and whole-app startup.

Opus rejected this seam for full parity. A comment after a key and an unfinished new key become part of the preceding entry, so another writer's edit can lose unchanged source text. Concurrent edits within a block scalar also replace each other. Flow maps, aliases, duplicate keys, order changes and header/body transitions need different semantics. Hidden weak values can reappear when a header is recreated. Passing these eight tests does not establish production correctness.

Keep the native codecs and persistence experiment. Next compare a plain source text CRDT with minimal splices against these counterexamples. Metadata remains a derived projection; neither semantic metadata registers nor cached sidebar fields should override the source. Incomplete YAML and simultaneous structured edits still need explicit, tested behavior. Integrate only after the remaining source, undo and stale-editor cases pass.

written with GPT-6 in Codex
