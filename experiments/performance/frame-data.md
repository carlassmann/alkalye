# Data-path frame experiment

Run `bun experiments/performance/frame-data.ts`; add `FRAME_DATA_MIB=1` for the real 1 MiB worker session. Results: `frame-data-results.json`.

This is an isolated experiment, not app architecture. It exercises the existing public `DocumentSession`, real SQLite journal, a real Bun Worker and an Effect bounded Queue. Each worker opens a snapshot, consumes 24 ordered top/middle/end replacements, acknowledges durable saves, is forcibly terminated, then reopens its journal in a fresh worker. Emoji edits respect UTF16 surrogate boundaries. An explicit listener-ready handshake prevents sending work before worker initialization.

The optimistic projection stores 1024-character blocks and returns 160-character windows. Five hundred mixed edits per size are checked against a full reference string. The reference string is only a correctness oracle outside the timed patch section. Block lookup and block-array replacement are linear in block count; this is not the balanced index proposed for production. The worker still calls `session.edit(fullSource)` internally. Edit packets contain changed text and offsets, around 70 JSON bytes rather than a full source or atom list.

The experiment shows that tiny display patches can stay cheap while the existing CRDT persists in another thread. It does not establish browser frame rate: there is no DOM, IndexedDB, syntax renderer or browser composition. An 8 ms main-loop timer measures scheduling delay, not presented frames. Worker relocation improves isolation, not CRDT throughput. A 24-edit burst can drain for seconds on 1 MiB; calling this 120 fps editing would be misleading.

Only one writer is exercised. Sequences enforce ordering within one worker lifetime; there is no idempotent replay protocol, remote rebase, collaborative undo or permission recovery implementation here. The 64-request queue limits count, not bytes. Production needs byte credits, bounded admission and retained unacknowledged transactions. Do not spawn fibers that wait indefinitely to enter a full queue or drop text using a sliding queue.

## Required data architecture

Give the session a replacement-oriented API that resolves revisioned UTF16 positions to CRDT anchors. Preserve document epoch, base revision and client transaction identity. Display optimistic changes immediately, but separately track worker admission, local durability and server acceptance. Remote output must be rebased through every pending local transaction before updating display text or selection; applying bare offsets to the latest text loses edits.

Move from fully materialized visible-atom arrays to an indexed run representation, with subtree UTF16 lengths and newline counts. Update touched insertion runs and removal intervals. Collaborative contribution undo changes visibility intervals and emits the same revisioned display patches. Keep old event/snapshot decoding at the boundary. A main-thread balanced text index should copy touched leaves and ancestor paths, rather than copy per-character arrays or materialize the entire string.

The worker should persist ordered contributions in bounded batches, acknowledging only the actual durable prefix. Its authority includes accepted, locally durable and pending states. Rejected permissions preserve the durable recovery copy; they cannot silently overwrite optimistic text. Retain offset mappings until transactions are acknowledged, use stable CRDT anchors for presence, fence late replies by document epoch, and resynchronize explicitly when a base revision is unavailable.

Use Effect worker RPC/Schema and Scope for worker/listener lifetime, bounded Queue admission, SubscriptionRef for status, and FiberHandle for replaceable derived work. The experiment uses a small native adapter; production should use the installed `effect/rpc/RpcWorker` facilities. Monitor queue bytes, age, durability lag and service rate under sustained writers. Frame responsiveness plus ever-growing backlog is not a successful design.

written with gpt-6 in Codex
