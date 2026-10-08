# Source review disposition

Opus review completed, exit zero, read-only tools. No runtime verification of these new archives yet.

- Bundle blockers addressed in source: reachable dynamic whiteboard entry, hyphenated hashes, exact single-entry requirement, inline HTML module imports, no retained-output totals. Lazy tldraw CSS comes from references in the reachable app graph (original main Vite mapDeps uses root-relative `_astro/...css`; rewrite uses `/tldraw/tldraw.css`). Validate emitted paths during the next runtime gate.
- Original save event exists in pinned main `src/app/features/documents/screens/doc-screen.tsx:1213`, `{detail:{documentId,content}}`; the review searched the rewrite instead. Preserve the completion gate.
- Rewrite handles `(metaKey || ctrlKey) && key==='z'` directly and calls domain Undo; it does not rely solely on browser native undo commands. Actual production 2 KiB smoke already passed Undo.
- Rewrite `documentActor` uses fresh 32-byte cryptographic nonce for each opened session, rather than a persistent author-only operation sequence. Retain normal per-trial operation/cursor acceptance checks. Original cloned Jazz profiles still require pre-boot session-key clearing.
- Loaded assets must include all `.js` resource paths, not just `initiatorType==='script'`; coordinate this existing runner change with its renderer owner before runtime.
- Fixture generators must produce LF-only content for CodeMirror comparison. Count/hash emitted bytes rather than infer escaping. CRLF capability testing remains a separate contract.
- Public refers to the model API, not anonymous document permissions. Fresh oracle reads use the same authenticated account in an independent SDK process; no public group grant is intended.

written with gpt-6 in codex

Undo extension review terminal, read-only. Source corrections (unrun): modified `z` anchors Undo timing instead of the modifier key; fresh empty output prevents stale trace reuse; started flag and partial observation preserve failed Undo evidence; original SDK sessions are checked for uniqueness and only digests are reported; incoming message counts bracket each trace. Backend history remains advancing, with prior declared and this-run accepted pairs recorded. Incoming counts are diagnostic, not proof of quiescent catch-up. Per-trial authentication-bearing profile copies are removed after closing. Next runtime gate is a paired 2 KiB Undo smoke, not the n3 matrix.
