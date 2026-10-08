# Actual editor with the worker-opened bundle

Experiment only; production unchanged. Sixteen checks passed: three account-bootstrap checks plus thirteen native/bundle checks. This is one new executed bundle, not an aggregate of earlier editor, activity, asset or observation proofs.

One worker-opened real DocumentSession owns CRDT/journal/HTTP and domain services. The extracted worker editor branch receives that same session. Main has the actual EditorElement, one FIFO adapter, activity/protection forwarding, RPC/account bootstrap and DOM recovery owner. Main creates no Replica or DocumentSession. The server fixture alone uses a read-only Replica to validate the real server snapshot oracle.

With opened Observe active, eight trusted characters drained, a trusted selection replaced newly inserted text, and the exact native and worker sources matched real server snapshots at positions ten and eleven. Trusted native Undo restored the prior source and was accepted by the server. No caret, viewport, frame or performance claim.

A fault wrapper on the real IndexedDB journal refused writes. Actual native edits froze readonly, retaining five admitted pending edits in both the editor and a separate readonly recovery textarea. beforeunload was protected before disposal. Durable Close remained a failure; the recovery DOM survived editor and worker disposal, and activity refused a clean-close acknowledgement. Unlike the earlier observation fixture, recovery assertions read the actual native editor and recovery owner, not duplicate global strings. Typing RECOVERY raced the authority failure: only RECOV entered before readonly; remaining keys were refused. Full admitted source is preserved, not all attempted keys.

This proves write refusal, not cancellation of an RPC/save fiber. Abrupt death, main-tab crash durability, fresh native reopen of that refused suffix, and full production mount remain gates. The fixture ends its main scope after the proof; it makes no persistence claim for the recovery textarea after tab removal.

Core refreshed from 52670c0. The integrated72 EditorElement/SourceTextarea patch was consciously rebased onto those current components: Editor applied cleanly, SourceTextarea had one offset-only hunk. The existing lazy connectivity injection remains copied/adapted and hashed. New per-Open epochs prevent stale queue matches; permission refusal happens before basis mutation. One mutation semaphore, one FIFO and one combined Observe lease remain. Actual activity replaces the no-op lifecycle layer.

Initial type attempts retained: unrelated copied tests missed experiment imports, then extracted handlers needed Rpc.Payload/ExtractTag annotations. The corrected tsconfig explicitly checks outside *.ts alongside current src and the real account fixture. Final strict types and fixture build passed. One agent-browser eval initially used bare await; corrected to an async expression before the server-oracle check.

Task/history/whiteboard and full domain/editor command parity are unproved. Test-only FixtureFault/FixtureDraft cannot ship in a production RPC group. Required activity channels, observed metadata DTOs and full-source acknowledgements still need a 1MiB message/input budget proof. Server ACL revocation, native clipboard permissions, IME/touch and multicursor behavior are not part of this run. Runtime Opus review completed. It confirms ownership, epochs and receipt ordering. Cutover gaps remain: post-disposal protection was not asserted; failed Close without a prior native recovery owner can drop worker-only drafts; initial writable admission is a fixture writer hint; definite permission refusal is conservatively labeled unknown. These are not production-ready lifecycle or ACL guarantees.

written with gpt-6 in codex
