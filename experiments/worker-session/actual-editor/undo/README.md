# Native worker Undo/Redo — unshipped

Eleven actual EditorElement assertions passed; types passed. No timing measurement or production adoption. The follow-up review identifies two remaining recovery blockers and an interruption race.

## Slice

UndoQueued enters the existing scoped FIFO after local replacements. The worker calls existing DocumentSession.undo/redo; no source-restore undo engine or main Atom[] graph. A bounded64-receipt cache retains request/epoch/sequence/redo plus outcome. Same-payload retry returns the original outcome; old evicted requests fail epoch/next-sequence checks before mutation. The old editor basis remains until existing MergeCandidate/Adopt publishes canonical source. Deleted anchors map to the globally nearest surviving old predecessor; all ranges share a single worker scan, then the current editor restores merged ranges. Command freeze is separate from permission editability.

Known no-op UndoUnavailable unfreezes. Applied outcomes require candidate adoption. Unknown outcomes preserve the draft read-only. This is a prototype, not a complete production recovery contract.

## Actual proof

Trusted native no-op undo, append emoji→undo with deleted caret, redo, multicursor edit→undo with ranges retained, fresh same-subject peer edit invalidating old redo, later local undo/redo retaining the previously merged prefix, exact local Flush/Read, actual same-document reload and scope disposal passed. The fixture uses the existing production EditorElement/SourceTextarea/overlay/native input with the unshipped pending bridge. Main-thread input has no Replica import or transferred atoms.

The first journey incorrectly expected redo after a new same-subject peer edit. Existing history correctly invalidated that redo; the editor stayed writable with the prefix intact. Failure preserved. The corrected journey tests that no-op explicitly. This is not a different-account concurrent-peer proof.

## Remaining blockers

1. Selection movement during a pending candidate request can refuse adoption. Its resume event is ignored while the request runs, so input can stay frozen until another selection change. Add bounded candidate-only retry; never repeat Undo.
2. Fatal failure currently writes permissionEditable. A later host permission refresh can enable a dead queue. Add sticky failure freeze and reject queue.replace when closed/failed, before a native draft can be accepted.
3. Complete the UndoRequest Deferred before deleting its retained pending entry, under an interruption-safe publication step. In-flight close must report AppliedUnknown.

Repeated Ctrl+Z while a command is active is dropped, matching the current host's undoWaiting guard. Postponed undo during composition is intended to act after its committed edit; physical IME remains unverified.

Follow-up review is in opus-followup.log. OS IME/drag, lost replies,64-receipt eviction, in-flight close, revocation, accepted server checkpoint and total worker memory remain untested. Full-app single-writer library/session integration and lifecycle forwarding remain separate; comments/media/clipboard facades have not been swapped.

## Reproduce

Prepare a real disposable repository copy following the parent actual-editor README, apply its prototype.patch, then undo.patch. Copy worker handoff sources to the disposable root as before; copy these fixture text files to matching .ts names. Server-seeded fixture and corrected bounded CSS are inherited. Run bun server.ts, then bun undo-journey.ts URL. Keep agent-browser background with stable default timeout20000. Do not apply this patch to production.

Source and compiled browser/worker SHA256 hashes are in tested-hashes.txt. The journey label was corrected after the passing run to say previously merged rather than concurrent; assertions and compiled source did not change.

written with gpt-6 in codex
