# Worker-opened document bundle

Experiment only. Production remains unchanged.

One worker owns the real IndexedDB DocumentSession, BrowserAccount, DocumentBlobs, DocumentLive and existing Properties/Discussion/Assets services. The main fixture only owns account bootstrap and the Effect Worker RPC client. There is no second main DocumentSession or Replica.

The executed journey passed 21 assertions: three account bootstrap checks and eighteen seed/bundle checks. It verifies exact Unicode source, frontmatter metadata, atomless automatic DTOs, second-Open refusal, prepared metadata action identity on retry, admission rechecks, body preservation, presentation conversion, real HTTP live polling, offline metadata durability, Close refusal and exact offline scope reopen. Types passed for the executed source.

The proxy cannot upgrade WebSockets, so DocumentLive exercised its existing polling fallback. Its transport/state machine is unchanged; only online state and online-restored events are injected. The lazy browser default never reads window at module import.

Initial source assertions failed before metadata tests: Open returns before background synchronization; fixture provisioning also replaces a differing frontmatter title through the existing newDocument helper. The final fixture waits for actual source readiness and uses the seed title. These failures remain recorded.

This is not the production BrowserLibrary replacement. Streaming Observe and continuous queued editing were not tested here. Whiteboard, task, history/recovery ports and the local-file adapter are incomplete. The real activity/draft protection adapter is not integrated: this runtime uses the explicit no-op lifecycle fixture layer. Permission denial proves a worker-local admission hint, not server ACL revocation. Offline Close completed, but server watch removal during blocked networking was not separately measured.

The earlier separate asset proof used File RPC encoding with JSON/base64. This minimal RPCGroup exposes no file methods; its drafted attachment/restore/read methods are unreachable and unproved here. This run makes no attachment size/performance or zero-copy transport claim. No editor basis/adoption or previously separate clipboard, Undo, comments and asset proofs are aggregated into these 21 assertions.

Terminal Opus review found no contradiction of these assertions, but identified untested hardening gaps: failed Open cleanup, failed Flush shutdown, online-restored transition filtering, unknown-error masking, sync-status interleaving, forwarding account/role/deletion changes, and protocol/worker death handling. Initial source-only review read intermediate drafts; the final runtime review is authoritative for the executed sources. Corrected Open publication, transition filtering and unknown-error handling are drafted separately under `next/`, untyped and unexecuted; they do not inherit the 21-gate proof.

`results.json` pins the actual source and built bundles by SHA256. The source-only interfaces adjacent to the runtime are drafts; the runtime files and hashes identify the executed proof.

written with gpt-6 in codex
