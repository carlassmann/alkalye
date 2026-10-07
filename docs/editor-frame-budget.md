# Editor architecture for 120 Hz

Status: proposed replacement, with isolated runtime experiments and an Opus 5.5 architecture review. The app still uses the existing editor. An experiment below the budget does not certify the complete app at 120 fps.

120 Hz gives the entire browser pipeline 8.33 ms per frame. Target at most 3 ms of application main-thread work at p95 and 5 ms at p99, leaving room for style, layout, paint and presentation. Also track missed frames during sustained interactions; percentiles alone can hide repeated stutter. Measure input latency separately: an edit can become visible before its durable or remote acknowledgement.

## Ownership

| Owner               | Responsibilities                                                                 | Excluded from the input path                                                            |
| ------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Main thread         | Input, selection, composition, indexed display text, visible decorations and DOM | Full source serialization, CRDT reconstruction, storage, network, full Markdown parsing |
| Document worker     | Authoritative document session, CRDT, journal, sync, undo, recovery              | DOM and browser layout                                                                  |
| Derived-work worker | Syntax checkpoints, search, outline, statistics, preview compilation             | Authoritative document mutations                                                        |

The display text is an optimistic projection, not a second document authority. The worker owns accepted, locally durable and pending state. Frontmatter remains the metadata source of truth.

## Bounded editor work

First measure a bare full-document textarea with the app's fonts and wrapping. If its layout and paint fit the budget, retain native document editing and virtualize the overlay. Otherwise replace the full-document textarea with a viewport renderer and a bounded native editing surface. Render visible visual rows plus small overscan. Keep a composition region mounted until composition ends. Browser input still supplies IME, mobile keyboard, spelling and native selection behavior; custom rendering must preserve their geometry.

A balanced text index stores bounded text leaves, subtree UTF-16 lengths and newline counts. Local replacement updates the touched leaves and their ancestors. Selection, clipboard and commands use document offsets; they do not depend on which rows are mounted. Materialize the full string only for explicit exports or worker-side consumers.

Logical lines are insufficient as the virtualization boundary: one paragraph can be a megabyte. Bound visual fragments and native input characters too. Keep a measured height index with estimates outside the viewport; preserve a source-position scroll anchor when estimates change. Width, font and zoom changes invalidate measurements incrementally.

Decorations keep source offsets and projection mappings per fragment. Repaint changed visible fragments only. Cache parser state at chunk boundaries; recompute until state stabilizes. Unfinished parsing must leave readable text, then add decorations without replacing the editing surface. Multicursor edits form one transaction, not a loop of full-document replacements.

Accessibility is a shipping gate, not an afterthought. Verify screen-reader reading and editing across viewport boundaries, selection announcements, keyboard navigation, dictation, spellcheck, mobile selection handles and drag autoscroll. A hidden input alone is insufficient. EditContext can be evaluated as an optional input adapter; [limited browser support](https://developer.mozilla.org/en-US/docs/Web/API/EditContext_API) prevents making it mandatory.

## Editing protocol

1. Input creates a transaction: document epoch, base revision, client sequence, ordered replacements and selection. Apply it immediately to the indexed display projection.
2. Send the transaction to the worker. Send changed text and positions, never a full-document string per keystroke.
3. The worker resolves positions against the stated revision, creates CRDT contributions and persists them through the existing journal. It acknowledges the client sequence and separately reports server acceptance.
4. Worker output contains revisioned patches, transformed selections, durability and recovery state. Apply patches atomically at a frame boundary; visible patches have priority over derived services.

Remote patches and pending local edits must be rebased against the same ordered revision history. Bare offsets against the latest worker source are incorrect. A transaction's coordinates refer to the last worker revision applied by the client plus its earlier pending local sequences. The worker transforms it through unseen remote changes before resolving CRDT anchors; the client transforms remote patches through its pending edits. Equal-position insertion order must match CRDT order. Transform selections and composition regions too. Retain position mappings until all relevant transactions are acknowledged; use stable CRDT anchors for presence and undo. Reject unknown epochs or unavailable base revisions and explicitly resynchronize while preserving pending text for rebase or recovery. Validate offsets before applying them. Pass replacements directly into the CRDT; diffing full strings can change which repeated character owns an edit.

Keep the existing contribution-based collaborative undo. Worker-side undo produces the same revisioned patch protocol. Permission rejection preserves a durable recovery copy and pending actions; it must not silently erase optimistic text. Changing documents fences late responses by epoch.

Worker acknowledgements distinguish receipt, local durability and server acceptance. Persist the client transaction ID → action IDs mapping atomically with its journal actions, so retry after a lost acknowledgement cannot duplicate text. Restart replays locally durable actions and resends unacknowledged transaction IDs idempotently. Text awaiting admission, worker processing or durable acknowledgement exists only in memory; moving to a worker increases that crash-loss window. Bound its bytes and measure its age; do not describe it as saved or rely on pagehide to flush it. Test a killed worker explicitly. Preserve strict IndexedDB transaction durability and existing Web Locks/BroadcastChannel coordination across tabs. File permission prompts stay on the main thread because they require user activation.

The current client reads replicas synchronously throughout assets, discussions, themes and document tools. Replace these reads with narrow revisioned projections; do not clone the complete replica back to the main thread. Migrate one document session as a vertical slice before switching all consumers. Editing coordinates remain UTF-16, but normal caret operations respect grapheme boundaries; test surrogate pairs, combining marks and RTL explicitly.

## Scheduling and overload

Use Effect's Schema and worker RPC, with small native Worker platform adapters. Scope owns ports, listeners, worker termination and document sessions. Use SubscriptionRef for followed state, FiberHandle for replaceable derived work and existing HttpClient/Schedule transport behavior.

Document transactions are lossless and ordered. Use byte-based admission credits, returned on durable acknowledgement; do not use a sliding queue for edits or spawn an unbounded number of fibers waiting to enqueue. While credits are exhausted, retain and compose pending local replacements without losing their undo grouping. Expose overload before memory grows without limit and block cancellable input at a hard limit. IME input can be non-cancellable: finish and retain active composition rather than dropping text. Group journal commits without conflating undo units. Split large actions within existing protocol limits while retaining their logical undo group. Large paste admission and durability may take longer than a frame; keep the UI responsive and show honest pending state.

Presence positions can coalesce to the latest value per writer. Laser trails, edits and history events cannot. Process remote edits in ordered bounded batches; combine their visual patch notifications without deleting document actions. Compute visible cursor geometry once per frame, regardless of writer count.

One dirty-frame scheduler batches DOM reads before writes across editor, sidebars and overlays. Idle screens request no frames. Animate transforms and opacity where possible; changing sidebar width triggers bounded viewport remeasurement rather than whole-document layout. Lazy whiteboard and preview islands keep their own expensive computation away from editor input. Performance acceptance includes menus, sidebar transitions, presentations and whiteboard interactions, not typing alone.

Moving today's O(n) CRDT into a worker prevents UI stalls but does not solve throughput. Replace full visible-atom array copies with indexed runs and patch-oriented session APIs. Keep snapshot and event compatibility at the boundary. Benchmark worker service rate and queue age under sustained writers, not just a finite burst.

No full snapshot cloning per edit. Hydrate compact snapshots in the worker, publish enough text for the first viewport, and transfer remaining indexed chunks progressively. A revision barrier reconciles edits made while loading. Whole-document commands such as find, select-all and jump-to-end request the required chunks and show loading until available; never silently act only on mounted text. Storage and synchronization remain local-first; neither typing nor opening cached text waits for the server.

## Runtime evidence

The isolated [viewport experiment](../experiments/performance/viewport-editor/) compares bounded input with a bare native textarea. In the final traced middle edit of a 1 MiB wrapped paragraph, the bare input dispatch took 20.51 ms, layout totaled 6.938 ms and paint totaled 0.759 ms. Bounded input's largest dispatch was 0.997 ms, layout totaled 0.273 ms and paint totaled 0.134 ms. These categories can overlap; do not sum them as frame time. This supports bounding the native editing surface. It does not prove 120 fps or preserve all app features. The experiment uses fixed monospace geometry and does not implement production indexing, native cross-viewport selection or accessibility.

The [data experiment](../experiments/performance/frame-data.md) applied 500 small projection patches at each size. Patch/window work measured approximately 0.004 ms p95 at 128 KiB and 0.005 ms at 1 MiB in Bun. Its flat chunk array demonstrates avoiding full-source character work; it is not the proposed balanced index or a browser measurement.

The same experiment ran the existing real DocumentSession and SQLite journal in a Bun worker. Durable edit p95 was 102 ms at 128 KiB and 1,470 ms at 1 MiB. A 24-edit burst drained in 1.47 s and 19.60 s respectively. Reopening after forcibly killing the worker immediately after a durable acknowledgement preserved the edits. This rejects worker relocation as a complete solution: incremental CRDT updates and persistence throughput must improve too. Browser IndexedDB, sustained collaboration, idempotent retry and permission recovery are not established by this experiment.

## Cutover gates

Build one vertical slice: cached snapshot → viewport → native edit → worker → durable journal → patch acknowledgement. Then add a second peer, remote overlapping edits, offline reload and permission rejection. Keep the old editor available in the experiment until the slice passes.

Integration tests cover revision ordering, rebase, indexed replacements, durable replay, interrupted scopes, worker failure, recovery and convergence through public module boundaries. App journeys cover IME, emoji/RTL, cross-viewport selection, clipboard, wrapping, undo, multicursor, comments and prettified assets.

Performance fixtures: 2 KiB, 128 KiB and 1 MiB prose, Markdown, code and a single long paragraph; append/top/middle edits; fast scrolling; resize; 512 cursors; sustained 24 writers. Track p50/p95/p99 main-thread work, input-to-presentation, dropped frames, worker queue age and durable/remote latency. Test actual 120 Hz desktop and phone displays. Headless browser results establish relative costs, not presented frame rate.

Use full browser traces for sub-frame attribution. Animation-frame callback duration excludes input handlers and browser rendering; time to a callback is not time to presentation. Long Animation Frame events only flag frames above 50 ms and Event Timing has coarse resolution; neither establishes the 8.33 ms target.

Do not promote the prototype until the native input and accessibility gates pass. If bounded textarea composition cannot preserve parity, test a viewport contenteditable adapter against the same document and worker interfaces; do not weaken the product requirements to fit the prototype.

written with gpt-6 in codex
