# Worker-native editor menu

Outside experiment; production unchanged. Actual native Editor menu: **10 assertions passed**. Shared Cut/Paste helper also passed the **13 clipboard regression assertions**. Types/build passed. Frozen underlying source `5c47f1357d6d8be3fbdf0c0ec3879991f4aa60d1`; this is not a current-production parity or performance claim.

Menu Copy, Paste, Cut, and source formatting work without a main Replica. Cut starts clipboard.writeText synchronously, waits success, verifies copied selection against a captured worker token, resolves unchanged selection in both local and peer-updated source, then submits native deletion through the FIFO. Denial, stale selected text, and disposal preserve text. A gesture-source guard on main and exact queue-source guard before capture prevent old coordinates being captured against later input. Tokens and scoped rejected promises have bounded ownership.

Journey covers actual menu Copy, Paste durability, text retained until Cut write succeeds, exact successful Cut durability, denied Cut, peer-changed Cut refusal with retained usable basis, Bold formatting, and scope disposal during pending Cut. The original thirteen clipboard checks rerun against the shared helper cover trimmed/repeated/newline deltas, queued local plus unseen peer edits, readonly/composition refusal, repeated denials, durability, and disposal.

Clipboard APIs are controlled deferred promises. Menu opening uses a dispatched contextmenu event followed by actual background-browser clicks. This does not certify operating-system permissions or Safari gesture behavior; Copy still uses its existing forked write. Native ClipboardEvent cut is unchanged but not asserted. Gesture auto-yield race is source-reviewed, not deterministically injected. Peer is a separate worker actor under the same account. Task/comment/asset actions remain gated capability gaps.

Opus5.5 reviews completed without blockers. Initial fixture type narrowing and repeated global eval-declaration failures are preserved; neither required engine changes. No full app cutover, unified Undo, main-tab draft durability, restart-after-disposal, timing, or frame-rate claim.

Exact tested source is preserved as `.ts.txt`, preventing repository checks from treating this outside prototype as production. Reproduce using a disposable copy of the frozen source/tests/dependencies; restore root source filenames, replace copied Editor and SourceTextarea from preserved files, adapt tsconfig base path, use `work run web`, then run `menu-journey.ts` and `journey.ts` against the printed URL in background agent-browser. Never overwrite through source symlinks. `results.json` retains source/bundle hashes and exact evidence.

written with gpt-6 in codex
