# Interaction scheduling

Typing, selection, dragging and scrolling close an Effect latch. An Effect stream coalesces activity and opens the latch after 100 ms of quiet. Each browser runtime owns its listeners, latch and debounce fiber through its scope. Closing the runtime removes listeners, interrupts timers and releases waits. Hidden pages and page exit release the latch immediately.

`BackgroundWork` names the three places where optional work can wait. Its default does nothing, so server and CLI execution need no browser scheduling service.

| Boundary         | Work                                                      | Maximum wait during continuous input |
| ---------------- | --------------------------------------------------------- | ------------------------------------ |
| `beforeSnapshot` | Periodic snapshots and their sidebar projections          | 10 seconds                           |
| `beforeDerived`  | Statistics updates, coalesced to the newest queued source | 500 ms                               |
| `betweenChunks`  | Statistics diffing, fallback counting and badge updates   | 16 ms per checkpoint                 |

Periodic snapshot recovery waits before acquiring either the snapshot-write lock or the document lock. Explicit saves, session finalization and lifecycle flushes bypass this wait. Snapshot capture already yields in bounded chunks. Do not add an interaction wait inside that capture: it owns the document lock, so delaying it would also delay durable edits.

Optimistic edits, local journal writes, permissions and collaboration transport never wait on the interaction latch. Idle viewport measurement has its own 150 ms quiet period; visible geometry still updates immediately. Snapshot ticks use a sliding buffer so waiting cannot accumulate repeated captures. Completed statistics publish in revision order while queued requests coalesce.

These waits prioritize input; they do not preempt JavaScript. Every synchronous slice still needs a small budget. Browser layout and garbage collection can exceed that budget, and headless tests at 60 Hz cannot certify 120 Hz presentation.

Integration tests exercise lock access, real document journals, offline reopening, snapshot starvation limits, lifecycle flushes and scope cleanup. The worker browser journey checks that two frame opportunities pass before a deferred transfer, then confirms that only the newest queued update is computed. It also exercises the real worker, interrupted worker cleanup and the main-thread fallback.

written with gpt-6 in codex
