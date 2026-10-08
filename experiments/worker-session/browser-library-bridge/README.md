# Scoped worker document lookup: 23 native correctness gates

Experiment only. Production unchanged. Executed copy: `/tmp/alkalye-browser-worker-open/runtime`, current production core `2ccca63` plus archived worker/editor adapters. Final strict types passed. One background agent-browser journey passed 23 assertions; no performance measurements.

The standalone factory opens the real IndexedDB DocumentSession, existing domain capabilities and real HTTP sync inside one Effect worker. Two scoped RcMap leases share its singleton editor FIFO. Native SourceTextarea input, canonical compact receipts, accepted server source, Undo/Merge, named metadata update and clean settled Close were exercised. Observe transfers bounded metadata/status, not full source/atoms. Main admission epoch changes refuse old staged tokens; this is UI admission testing, not server permission revocation.

The worker checks its canonical result against replay from its own held basis and submitted ranges. The FIFO validates epoch/sequence and before/after lengths. Initial Begin and guarded Merge/Adopt establish source equality. A wrong equal-length fallback is replayed and refused before enqueue. Neither source nor a full-source hash returns with ordinary edit acknowledgements. Worker replay still joins full source; throughput and memory are unmeasured.

Final Opus review **found a production blocker**: an admission refresh may overtake already queued old-epoch edits and permanently fail the queue. Connectivity currently shares that epoch path. This exact executed version is retained as a bounded proof, rejected for production. Subsequent fixes must receive fresh contracts; the 23 assertions do not certify them.

Earlier review found direct editor RPC methods bypassing the singleton FIFO and observer completion/interruption silently retaining writable state. Both were repaired before the passing run. Closing is marked before reverse-scope observer interruption; unexpected stream termination retains the native owner. A log-only/tool-only first review was unusable and is retained separately.

Two fixture failures remain in logs: the server seed explicitly sets title `Worker fixture`, conflicting with the first `Initial` oracle; the metadata helper emits quoted YAML, conflicting with an unquoted substring check. The final fixture uses the exact seed and the existing metadata parser. Trusted click positioned `x` in the frontmatter middle; it was not an EOF journey. Actual server acceptance and Undo restored exact source.

Missing production migration gates: actual BrowserLibrary lookup and background drain ownership, peer merge, separate-owner server ACL revocation, offline independent reopen, abrupt worker death/unknown native suffix retention, main-tab crash durability, all commands/history/comments/assets/whiteboards/local-file adapters, and large native Observe/ACK budgets. Property commands currently share the worker permit alongside the editor FIFO; all-command FIFO migration remains unproved. No main call constructs Replica or DocumentSession, but their implementation code still appears in the non-minified main bundle through shared imports.

Run the archived disposable server via `work run web`, then its actual printed URL:

```sh
WORKER_LIBRARY_URL=http://localhost:PORT/ bun tests/browser-worker-library.ts
bun x tsc --noEmit
```

Server and browser stopped after proof. Source and compiled bundle hashes are in `results.json`; source snapshots are `.ts.txt` to keep experiments outside production compilation.

written with gpt-6 in codex
