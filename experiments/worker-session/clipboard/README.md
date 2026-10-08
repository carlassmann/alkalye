# Worker-native clipboard capability

Outside experiment, production unchanged. Latest actual Editor journey: **13 assertions passed**, types/build passed. Frozen copied CRDT/cache source: `5c47f1357d6d8be3fbdf0c0ec3879991f4aa60d1`, distinct from later production `4401f54`. No performance or complete app cutover claim.

Worker owns one real DocumentSession. Main receives opaque clipboard tokens and selected text. Worker checks the selected text in editor-local and authoritative peer-updated source at resolve and commit. Native deltas can move across repeated text: the worker reconstructs the requested result, verifies unchanged text outside the captured span, then applies one canonical replacement at that anchored span. No atom graph crosses to main.

The actual native Editor starts clipboard read synchronously, preserves smartPaste and existing native refusal guards, and submits through the scoped FIFO. Failed post-paint edits retain the full optimistic draft and dependent suffix. Tokens are consumed once, releases use FIFO, and shutdown cleanup is bounded.

Proof covers common-prefix trimming, repeated-character caret, newline boundaries, local edits and unseen peer insertion during deferred clipboard read, changed selected text refusal, retained-anchor rebase, readonly/composition refusal, nine denied reads followed by valid exact HTTP durability, and disposal while a clipboard promise remains pending. Clipboard reads are deterministic deferred promises; this does not prove browser permission behavior. Peer is a separate worker actor under the same account.

`journey-peer.log` preserves the fixture failure: it attempted to adopt a merge with a selection anchored inside peer-deleted text. Worker refused. The corrected fixture selects a retained anchor first; no engine change. Prior seven-assertion run is preserved separately.

Opus5.5 final read-only review found no remaining blocker for this bounded proof. The peer race between Resolve and ReplaceQueued, pointer drag, and multicursor refusal remain source-reviewed, not deterministic runtime assertions here. Context-menu paste remains worker-gated. Undo adapter, main-tab draft durability, other atom-dependent editor/app commands, and full production mount remain separate gates.

Source files use `.ts.txt` to prevent repository checks treating this outside experiment as production. They are exact tested copies, including the copied Editor and SourceTextarea. To reproduce, copy the frozen repository source/tests/dependencies into a disposable folder, restore root sources without `.txt`, replace `src/client/components/editor.ts` and `src/client/source-textarea.ts` with the preserved copies, adapt the preserved tsconfig base path, then use `work run web` and background `bun journey.ts <printed URL>`. No writes through source symlinks. Source and tested bundle hashes are in `results.json`.

written with gpt-6 in codex
