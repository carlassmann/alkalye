# Native worker Undo recovery prototype

Outside production. Uses the existing EditorElement, real worker RPC, real DocumentSession and local IndexedDB journal. Extends the unshipped Undo prototype in ../undo.

Three fixes: sticky authority failure survives permission refresh; refused selection handoff retries fresh mapping without repeating Undo; receipt completion and request removal publish atomically in a bounded uninterruptible section.

Controlled transport faults drop a reply after the real worker completes it, or hold a completed reply with Effect Deferred. No fake mutation engine. The queue retries the same Undo request ID once. The worker retains 64 receipts; an evicted request fails its old sequence check without mutation.

13 native/public queue assertions passed, then the original 11 Undo/Redo assertions passed. Types passed. Fault gates cover lost Undo reply, stale selection during handoff, lost Adopt reply, 66 later requests and eviction, uncertain outcome with repeated permission refresh, native scope close, and explicit AppliedUnknown receipt completion during close. The previous merged peer prefix remains covered by the original same-account fixture.

The first run timed out reopening the disposed same URL. Preserved in recovery-navigation-failure.log. Fresh isolated browser sessions per scenario passed. No performance, different-account peer, physical IME, clipboard, accessibility or server acceptance claim. Flush checks the local journal only. Full-app worker ownership and feature parity remain unimplemented.

Source and bundle hashes in results.json refer to the executed outside files, before artifact formatting. editor-worker.patch applies to the recorded production head. Snapshot sources use .ts.txt names so workspace checks do not compile the disposable fixture. Remove the .txt suffix when copying them into the outside runtime. Run server.ts, then recovery-journey.ts and undo-journey.ts with the printed URL. Both use background agent-browser with a stable 20000 ms default timeout.

written with gpt-6 in codex
