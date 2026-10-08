# Controlled legacy checkpoint maintenance

Outside e7cc136 prototype; not adopted. Adds owner-only WorkspaceStore.compactStoredCheckpoint, no HTTP route or background job. No phone or production data migrated.

One read transaction captures head, tip and tail. A fresh private session validates the complete durable state. The original checkpoint is restored and compacted cooperatively, then restored again and compared before writing. The write transaction rechecks current owner permission and swaps only matching document/log/position/version/raw-state. History, tail, cursor, version, notices and live caches stay unchanged. Tagged outcomes distinguish Compacted, AlreadyCompact, Stale, NoHead and Unsupported. Scope interruption before publication retains original bytes; native JSON/deep comparison remain opaque work.

Strict types passed. Six real SQLite/public WorkspaceStore tests passed: 32 assertions, 2.44 s. Exact commands from reconstructed runtime:

```sh
bun run check:types
bun test tests/checkpoint-maintenance.test.ts
```

- Legacy v2 + recovery tail: Unicode source/history/cursor retained, repeated maintenance AlreadyCompact, fresh-scope Undo/retry matches an independent unmaintained store replaying the same public creation/note actions.
- Malformed head and missing recovery tail: typed DocumentConflict, original bytes unchanged.
- Concurrent 64 KiB Unicode checkpoint rewrite: explicit Stale, newer version100/source/history retained.
- Reader denied; interrupted maintenance has interrupted Exit and unchanged durable bytes/fresh reopen.
- Document created in creator-owned workspace, publicly moved into inherited-owner workspace, then moved out concurrently: explicit PermissionDenied and original head bytes.

Initial 3/6 failures preserved: undefined metadata assumption, tiny race maintenance winning, incorrect direct ownership assumption. First corrected run proved Stale but exposed empty-string Undo canonicalization and document ownership surviving the mistaken move. Final fixture uses independent public Undo oracle and genuine inherited ownership. No assertions weakened. Race outcomes are observed, not a deterministic platform barrier; concurrent revocation does not isolate whether read or write recheck denies. No inside-commit cancellation/physical transaction interruption proof. No performance/120fps claim, full-app migration, all-checkpoint format guarantee or automatic maintenance policy.

Opus initial HOLD corrected: PermissionDenied tags, absent-tip refusal, roundtrip equality, tagged outcomes and existing cooperative helpers. Followup found no mandatory blockers by source review only; latest fixture corrections were executed afterward. No blanket stress/repeat suite run.

Patch applies to e7cc136 src/server/document-store.ts. results.json hashes identify exact executed source/test bytes; .ts.txt snapshots may be archive-formatted later without semantic changes. Prior failed test snapshots and raw logs retained.

written with gpt-6 in codex
