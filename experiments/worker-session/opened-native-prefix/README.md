# Native prefix and journal-await interruption

Experiment only; production unchanged. Nineteen assertions passed with the actual EditorElement, active worker-opened Observe and one worker-owned real DocumentSession/IndexedDB/HTTP authority. No main Replica or second Session.

Six trusted native characters, `PREFIX`, completed FIFO acknowledgements and matched the real server at position seven. A test-only Effect Context.Reference marks only the native ReplaceQueued caller. The journal adapter holds that caller before the underlying write. Exactly one marked held write, fourteen, was observed. Nine more trusted characters, `INTERRUPT`, entered the actual native editor.

Closing its FIFO scope interrupted the client RPC effect and the marked journal await. The signals distinguish `held:14`, `interrupted:14` and later `write-failed:15`; we do not misattribute the latter refusal to the former write. Write fifteen may be a background write; it is not independently tied to Close. Write fourteen belongs to the marked handler interruption tree, not necessarily its direct write. The held write never entered the underlying journal write. This proves interruption at a journal await, not cancellation during or after a physical IndexedDB transaction.

The actual native recovery textarea retained all nine suffix characters, readonly, with a typed AppliedUnknown outcome. Six prefix dispatches plus one interrupted dispatch were observed; remaining eight queued edits stayed blocked. No additional ReplaceQueued was dispatched after closure. Close reported SessionFailure. A new independent worker scope reopened offline, with API traffic blocked, and recovered exactly the committed native prefix with zero `/api/*` requests after interruption plus injected refusal of all later writes. Interruption alone would not guarantee exclusion of an already applied suffix. Its projection excluded the suffix and never replaced the actual native recovery owner.

After editor and worker disposal, beforeunload remained prevented and clean-close acknowledgement was refused by the fixture-owned recovery predicate. This is real DOM retention, not a production recovery component or persistence across tab death. The whole fixture scope eventually removes the recovery textarea.

Reconstruct from e0a182f opened-native snapshots, replacing the five `.txt` files here. Core intentionally stays 52670c0; this does not silently inherit newer production changes. Source/bundle hashes and exact prefix/draft are recorded. Strict types and the real browser passed. Earlier narrowed interruption16 evidence stays immutable; its missing storage-origin and write-attribution gates are supplied by this separate run, not retroactively claimed.

Read-only source reviews required native caller marking, exactly one held write, a terminal per-write outcome and explicit prefix/suffix inequality. Runtime review completed without semantic blockers; its wording corrections above distinguish marked handler writes, later refusals and interruption-plus-refusal. Test-only channels/RPCs and seed/oracle routes cannot ship. After-commit response loss, main-tab durability, reader admission, worker-only Close recovery, 1MiB Observe/full ACK budget and full application cutover remain gates.

written with gpt-6 in codex
