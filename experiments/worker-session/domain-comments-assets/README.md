Untimed correctness only. Outside prototype; no production/UI enablement.

Latest verified coverage:

- Metadata recovery after a durable mutation: 19 assertions.
- Independent accepted comment resolution and Undo: 23 assertions.
- Staged comment submission/replies: 37 assertions.
- Comment submission interrupted after durable mutation: 16 assertions.
- Asset attachment, upload, duplicate receipt and accepted Undo: 18 assertions.
- Asset attachment interrupted after durable mutation: 18 assertions.

Counts include fixture bootstrap checks. Each journey uses actual WorkerRPC, IndexedDB, transport and scoped resources. These are module proofs, not full application parity. Recorded logs use `.log.txt` so Git retains them. Sources from independently executed stages remain separate.

The notes below preserve earlier failed fixtures and their original coverage limits. Later accepted-state and unknown-outcome checks supersede those limits where stated.

Metadata seed-only confirmed HTTP409 Actor identity is not authorized on the second distinct document. Public API binds actors to one document. Subsequent independent fresh fixtures use account-prefixed per-document actors. Original seed failure had no retained status/body; new seed diagnosis confirms the helper defect, not an original wire capture.

Metadata post-mutation unknown: strict passed; first independent journey failed the SQLite oracle because the fixture reopened online:false and Synchronize intentionally did nothing. Failed closed state retained. Corrected new documents use Connectivity(true) before synchronization; 19 assertions passed including bootstrap, unknown durable retention/reload/no replay, exact source, wrong-token/digest refusal, resource release. Earlier before-invoke proof is separate retained evidence.

Comments known path: strict passed; 19 assertions including bootstrap. Real WorkerRPC, browser IndexedDB, Bun SQLite: exact Unicode anchor range, independent worker peer insertion, shifted range, resolve, intentionally discarded applied reply recovered, duplicate command same action, pending exact clear, actual Undo restores unresolved while peer text/body survive, scope reopen, admission revoke before invocation. Discarding a reply in the caller is not a network-loss simulation. SQLite thread fields and post-reopen action counts were not independently asserted; same-action duplicate receipt was asserted.

Comments unknown: strict passed; 14 assertions including bootstrap. Real caller interruption at durable STARTED before invocation; unknown cannot clear; scoped reopen never executes it again; exact source/flag; readonly retained draft with STARTED comment and NeverDispatched metadata tail; empty reconciliation cannot thaw. Both worker scopes terminate. This proves pre-invoke comment unknown, not comment mutation-before-receipt interruption.

Requested main/worker JS paths were re-fetched before invocation and compared by SHA256 to the fixture build response. Individual digest inventory was not retained in these fixture result files. Source hashes here identify preserved source bytes; no retrospective executed-bundle provenance claim.

Failed strict unused-import logs preserved. All browser/server processes closed; closed DB/profile snapshots retained outside this archive. Private profiles, database files, account settings and credentials omitted. No timings, frame-rate claim, or production parity claim. Submission/replies/uploads, main app comments UI and full assets parity remain unproved.

Later independent accepted oracle: strict passed; 23 assertions including bootstrap. Server helper fetches actual backend snapshot and public SQLite-backed history; installed schemas decode both. Exact resolved flag, peer text/body, one resolve action after duplicate request, accepted Undo exact flag/body/source and one inverse asserted. Original earlier proof limitations remain historical.

Staged submit/reply: strict passed after preserved syntax/Effect union errors. 37 assertions including bootstrap: pure Unicode capture, no comment action during capture, empty body refused before STARTED, serializable composer/body declaration digest, admitted staged command, discarded applied reply recovery, same-action duplicate receipt, independent SQLite one comment/reply/action, peer range shift, accepted resolve/Undo and scope reload, revoked composer refusal and old epoch cannot be promoted by regrant. No main app comments UI enabled. Post-mutation submit interruption and assets remain unproved.

Latest coverage (supersedes historical remaining-work statements above): accepted comment resolve oracle 23 assertions; staged submit/reply known path 37; submit after-durable unknown 16; asset known 18; asset after-durable unknown 18. All are untimed public WorkerRPC/storage/transport integration proofs. Separate frozen sources and logs for the latter three are in submit-and-assets/. Their source-hashes.json records preserved source bytes, not retroactive execution pins.

Actual app comments UI remains unproved. The later UI draft passed strict/build, then its native journey timed out before opening the composer or recording the submit attempt marker. No comment was invoked. The empty panel omitted Add controls despite the native textarea remaining writable; permission versus transient queue-freeze diagnosis is pending. That failed UI draft and its subsequent diagnostic changes are separate from every frozen module proof here. Assets UI remains unimplemented. No UI source, private settings, credentials, profiles or database snapshots are included in this deep-module archive.

Automatic blob cleanup, media rendering, full host feature parity, cross-tab ownership and production worker cutover remain unproved. Known outcomes never justify clearing other unresolved tails; unknown commands are retained without replay. No performance or physical frame-rate claim.
