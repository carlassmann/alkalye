# Guarded worker editor handoff — standalone textarea correctness slice

written with gpt-6 in codex

Outside arm of the 46-assertion queued worker correctness proof. Production unchanged. Latest outside source passed types/build and 57 real-browser assertions. It has no performance verification or actual EditorElement integration proof.

MergeCandidate flushes and forks the authoritative session while retaining the old editor basis. It returns one candidate identifier, merged source and atom-identity-mapped selection endpoints. Adopt requires the exact old epoch and submitted sequence. A new merge replaces an abandoned candidate; foreground old-basis edits invalidate its candidate. Missing deleted selection anchors refuse a handoff, preserving the old basis. Expanded CRDT atoms represent immutable code points, not mutable compact runs; boundaries use left affinity. Multicursor selection mapping remains unimplemented.

The main FIFO adapter accepts a candidate only if submitted sequence/source and selection/composition generation remain unchanged. Native acceptance returns boolean. Selection read, acceptance, FIFO Adopt enqueue and epoch/source switch execute within one synchronous Effect.try; native beforeinput cannot interleave. The native callback must not synchronously reenter replace. Unexpected reentry retains native hinted draft and blocks its suffix for recovery. Refusal releases the candidate without changing active epoch. New input queued afterward follows Adopt and uses the new epoch. No atom graph crosses RPC; no positional OT.

Adopt failure reconciles worker Read epoch before resuming; unresolved outcomes block dependent suffix while preserving optimistic source. Scope close settles outstanding handoffs, and unacknowledged adoption is labeled ambiguous. Abrupt worker death, actual RPC interruption and uncertain Read remain separate runtime gates. Source-only callbacks still need real EditorElement/native composition verification.

Prepared fixture: eight queued edits including editing newly inserted atoms; unseen peer update; new input after MergeCandidate RPC starts; selection and composition changes during the request; explicit native refusal; successful caret mapping; following input through FIFO Adopt; exact final accepted source. Existing serial/offline/recovery/multi-account revocation journey is retained. No latency or FPS claim.

The first runtime fixture used a Deferred notification inside native acceptance; Effect resumed its waiting input fiber synchronously, triggering the intended reentry guard. The corrected fixture notifies through queueMicrotask after atomic acceptance. The failed run is preserved; final exact source and bundle hashes are in results.json. Hint source checking and busy/native-source guards were added after the read-only review, then passed final types/runtime.
