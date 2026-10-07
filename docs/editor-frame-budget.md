# Editor architecture and frame budget

The production editor now uses indexed replacements and a bounded native textarea. BrowserLibrary remains the document authority. The worker computes document statistics. The earlier authoritative document worker remains an experiment.

A 120 Hz display gives the browser 8.33 ms per frame, including input handlers, style, layout and paint. Our target is at most 3 ms of application main-thread work at p95 and 5 ms at p99. These are acceptance targets, not a claim that the app sustains 120 fps.

## One document authority

BrowserLibrary opens the existing DocumentSession. That session owns CRDT actions, IndexedDB persistence, collaborative undo, transport, presence and recovery. Cached documents open without waiting for the server. Local durability and server acceptance remain separate states.

Native input produces exact ordered replacements against the captured atom base. `DocumentSession.replace` resolves the removed characters and insertion anchors to CRDT IDs. This matters when a collaborator inserts text before a pending edit, and when repeated characters make a full-string diff ambiguous. A multicursor transaction creates one action and one undo unit.

The visible atom sequence uses Effect's persistent `Chunk`. Replacing a small region shares unchanged sequence structure instead of copying every atom. An array-compatible read-only view keeps existing consumers working. Persistence and wire snapshots retain their existing formats.

A balanced text index stores UTF-16 length, code-point count and newline summaries in bounded leaves. Edits update the affected leaves and ancestors. Browser selections use UTF-16 offsets; CRDT atoms use Unicode code points. The index maps between them without scanning the entire prefix. Replacements reject boundaries that split a surrogate pair.

This improves the common local edit path. Hydration, historical projections, exceptional rebases and whole-document exports can still perform work proportional to document size. The change does not make every document operation constant-time.

## Native input with bounded layout

`EditorViewport` maintains document offsets independently of the mounted textarea fragment. It mounts visible text with overscan, including fragments of long paragraphs. Native measurement supplies wrapping and height; estimates cover unmeasured blocks. Resize and font changes trigger remeasurement while preserving the source-position scroll anchor. Native input, measurement and overlay share an explicit line height quantized to 1/64 px. Copying a computed decimal line height from a ratio otherwise accumulated pixel drift across hundreds of rows.

`SourceTextarea` maps the displayed projection back to Markdown source. The syntax overlay paints the mounted fragment. Formatting, cursor highlighting and prettified assets therefore use the same source coordinates as commands and collaboration.

Selection, copy and cut operate on the complete document. The mounted fragment is not the clipboard boundary. Composition keeps its native input mounted until it finishes; deferred rendering waits for the final composition text. Full document input remains an editor preference for users who need native access to the complete textarea. Coarse-pointer devices also use complete native input to preserve mobile selection handles. Pointer dragging and selections across windows can temporarily mount the whole document. These paths accept the full-document layout cost; the bounded desktop measurements do not apply to them.

The browser still provides text entry, selection and composition. Virtualization changes what native accessibility and mobile selection can see. Automated composition and narrow-viewport tests do not certify physical phone IMEs, screen readers, dictation or native selection handles.

## Scoped derived worker

The statistics badge starts a worker lazily when document content is known and the badge is enabled. The worker receives the initial source once, then revisioned replacement messages. It keeps a disposable text mirror for word, sentence and task counts; it never writes document actions or synchronizes documents.

Effect RPC validates messages. An Effect scope owns the worker, listeners and pending requests. A sliding queue keeps the newest statistics request because intermediate counts can be discarded. Document actions continue through the existing lossless journal.

Replies carry revisions. The badge accepts increasing revisions, retains its current counts while work is pending and hides until initial counts are available. Clearing the document or disconnecting the element closes the scope and releases the old source. A failed worker closes its child scope and switches to idle browser counting without a retry loop. The service worker caches the worker bundle for offline use.

The bridge currently computes replacement prefix and suffix on the main thread in its asynchronous consumer. This scan is still O(n), and idle fallback still counts on the main thread. Neither belongs to a second sync authority.

## Evidence and remaining checks

The isolated [viewport experiment](../experiments/performance/viewport-editor/) measured a middle edit in a 1 MiB wrapped paragraph. Bare textarea input dispatch took 20.51 ms, with 6.938 ms of layout and 0.759 ms of paint. Bounded input's largest dispatch was 0.997 ms, with 0.273 ms of layout and 0.134 ms of paint. These categories can overlap. The experiment supports bounding native layout; it does not measure production input-to-presentation latency.

The [data experiment](../experiments/performance/frame-data.md) showed why moving the previous session unchanged into a worker was insufficient. Durable edits reached 1,470 ms p95 at 1 MiB, and a 24-edit burst took 19.60 seconds to drain. That experiment predates the indexed replacement path and is not a benchmark of the cutover.

Current checks exercise public boundaries:

- Replacement integration tests cover captured bases, concurrent writers, Unicode offsets, undo, persistence and rejected ranges.
- The production viewport journey checks bounded input, top/middle/end edits, durable reload, complete-document copy, narrow viewport editing and composition.
- The worker journey verifies small replacement transfers, coalesced revisions, scope termination, real cached worker replies offline and permanent fallback after worker failure.
- Authenticated HTTP tests load a 1 MiB compact snapshot and edit the restored document. Compact snapshots remain bounded; documents beyond the compact atom limit can still use the larger legacy representation.

Record complete browser traces for actual frame budgets. Input-handler duration excludes later rendering, and an animation-frame callback is not presentation. Acceptance still needs real 120 Hz desktop and phone displays, sustained concurrent writers, large paste, scrolling, sidebar transitions and assistive-technology testing. Synthetic composition events and headless timings establish useful contracts, not those certifications.

written with gpt-6 in codex
