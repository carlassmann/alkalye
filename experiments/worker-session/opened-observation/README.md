# Worker-opened observation and cleanup

Experiment only; production unchanged. One worker owns the real DocumentSession/IndexedDB, account/blob services and DocumentLive. Main fixture owns account bootstrap, RPC client and its retained draft string; no main Replica or DocumentSession.

25 assertions passed: three account-bootstrap checks and twenty-two seed/resource checks. A single tagged Observe stream runs beside prepared metadata commands and same-token retry; a second observer refuses without starving commands. Interruption releases the observer lease. Normal and failed durable Close both end active observation, release the authority and permit a fresh Open. Properties.present uses the frozen named service and safe-integer RPC schema.

Real IndexedDB adapter failure seams test Open/read and Flush/write failures. The unsaved worker edit fails durability; Close preserves that failure, while main retains the full draft. Reopen reads exactly the prior durable prefix, without silently replaying the unacknowledged suffix. The client owner scope then closes a fresh worker. This asserts scope completion, not OS process-memory or port counters.

Initial fixture failed after seven checks: its first-event Deferred woke for presence before the document event. Readiness now waits specifically for a document event. Failure retained. Initial transplanted types lacked build.ts (server settings imports it); copied the existing build module, then strict types passed for the exact executed source.

The worker pool has one worker and two request leases. A scoped per-open reservation allows one combined document/presence stream. Mutation semaphore is released after observer acquisition, never held through stream lifetime. Close resolves its Deferred before tearing down document resources; owner finalizers signal it before cleanup. Same command Effect remains registered until explicit release, relying on the existing Session.propose prepared action identity; retry does not create a second action.

Core derives from the immutable opened21 runtime (0e13876); only DocumentProperties refreshes from 64172c4. Source and bundle hashes identify this new proof. Older proofs are not aggregated. The copied stream remains atomless, but authoritative text/metadata can be large; no frame, latency, zero-copy or streaming stress claim.

The retained source review preceded the final fixes: task/history validation now precedes registration, Close signals observers before cleanup, and final sources type-check. Its duplicate-command warning is contradicted by Session.propose’s captured prepared Ref and the actual retry gate; its optional-subject warning is contradicted by the required discriminated DocumentMoment subject. A separate final-runtime review remains pending at packaging; it is not claimed as completed here.

No-op lifecycle fixture remains explicit. Continuous actual-editor FIFO/basis/adoption, activity/draft protection, server ACL revocation, task/history methods, protocol/worker crash and main-tab draft durability remain unproved here. FixtureFault/FixtureDraft only adapt the actual journal/session for failure tests; they are not production API. History/task draft routes compile but are not exercised; their editor basis remains unavailable.

written with gpt-6 in codex
