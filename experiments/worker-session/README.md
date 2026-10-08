# Worker-owned session proof

written with gpt-6 in codex

Experiment only. Production still uses the current main-thread DocumentSession. Seventeen real-browser assertions passed; exact results and tested source hashes are in `results.json`. The outside draft passed TypeScript. Locator-only artifact changes (relative imports and disposable server asset directory) have not been rerun.

One worker owns the actual DocumentSession, IndexedDB journal and HTTP transport. Effect RPC uses the same native browser adapters as the existing stats worker. Main receives source strings/status counts, not atoms, checkpoints or logs. Retained worker atom-array handles let source replacements preserve concurrent peer contributions.

The proof covers stale Unicode/body and frontmatter replacements, native server acceptance, explicit Close and reopen, expired handles without mutation, offline durability and reconnect, and a separate worker opening accepted state. Read-only Opus review is preserved in `opus-review.txt`; its required ownership, Close-defect and applied-but-unsaved error fixes are included.

It supports bounded serial commands only. Eight retained views maximum; Release explicitly frees them. Replace waits for local durability; Sync handles remote acceptance separately. Sync serializes the first proof's commands and can block subsequent commands during network work. Always await Close before disposing the client Scope; its platform finalizer terminates the worker.

Continuous typing is **not proved**: offsets against newly inserted but unacknowledged characters need an exact editor-local atom basis. A merged peer acknowledgement is not that basis. No positional OT, sliding command queue or blind RPC retry is implemented. Interrupted Replace has ambiguous completion; preserve the main draft, Read/reconcile, and distinguish Rejected from Unsaved. Full recovery, authentication refresh, library activity, media capabilities and file-system documents remain outside this slice. Worker termination/interruption branches and performance need further public runtime proof.

To reproduce, run the server through `work` from a disposable Git directory. Point its `web` command to the absolute `server.ts` path in this directory with `bun`; run `work run web`, then `work logs web` for the full local URL. Open that URL using background agent-browser with a unique session and the unchanged `AGENT_BROWSER_DEFAULT_TIMEOUT=20000`. Wait for `window.workerSessionDone`; inspect `window.workerSessionResults` and `window.workerSessionFailure`. Close the browser session and run `work down`. The server removes its disposable backend and assets on shutdown.
