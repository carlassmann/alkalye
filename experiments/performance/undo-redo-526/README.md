# Undo and Redo residual diagnostic

Frozen production revision `52670c0`, both browser and Bun backend, with the adopted terminal cancellation cache. One trusted append followed by sampled Undo and Redo, using the retained one MiB wrapped document and authenticated profile. No comparison arm and no speedup claim.

Undo’s largest complete main-thread task is 26.263 ms. CPU samples restricted to that task identify editor `positions` (editor.ts:958) at 15.755 ms self / 15.909 ms inclusive. Viewport rendering contributes 2.335 ms self, SourceTextarea difference 1.914 ms. Editor update is 23.254 ms inclusive; these nested figures are not additive. Cold Replica materialization no longer appears in this task.

Redo’s largest complete main-thread task is 195.885 ms. Within that task, `rawVisibleSteps` (crdt.ts:1111) accounts for 135.342 ms self, with frontmatter projection 26.627 ms inclusive. Cancelling a cancellation uses the general path, so this remains a separate cold-source problem.

Both traces use CPU sampling. Their durations are diagnostic observations, not latency benchmark results. Full trace hashes, main-thread ownership and source mappings are retained. Three-second whole-window samples must not be added to the longest task.

## Native gates and preserved failure

The sampled run verifies accepted Undo text and caret at EOF 1048576, bounded native input 1995 characters, and bottom outer scroll. After Redo, a later 20-second wait fails. Its returned state is the prior Undo state; the failure log alone cannot establish sampled Redo’s final accepted text or selection.

A separate untimed replay corrects that gate’s assumption: existing editor selection tracks the surviving predecessor at 1048576, immediately before the restored x, rather than moving to the new EOF 1048577. This replay independently confirms exact accepted Undo and Redo hashes, local source, native caret, bounded input and bottom viewport. Redo has source 1048577, caret 1048576, native input 1996, viewport end 1048577 and bottom distance 0. The successful replay does not retroactively prove the sampled run’s unknown final state.

Both runs reset the same stopped disposable database/profile snapshots. Browser cache/service worker directories are removed before boot; the served entry bundle SHA is checked. No user database, phone server or production source is modified. Raw traces remain at the recorded absolute paths outside the repository.

These tasks still exceed an 8.33 ms budget. Physical 120 Hz rendering, general Undo/Redo performance, IME and other interaction parity are not established by this diagnostic.

written with gpt-6 in codex
