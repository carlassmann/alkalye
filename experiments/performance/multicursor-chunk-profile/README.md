# Multicursor Chunk attribution

Two diagnostic production 1b630c8 journeys, 512 and 2048 cursors, through the existing native EditorElement. Exact replacement count, source, caret and independent accepted edit/Undo gates passed. Sampling is separate from earlier uninstrumented observations; these durations are not speed comparisons.

The 2048 beforeinput interval took 34.895 ms: DocumentSession.replace sampled 26.766 ms inclusive; CRDT.apply 14.505 ms, prepareReplacements 7.666 ms. Effect Chunk.drop appears in an overlapping 8.862 ms subtree. Inclusive values overlap and cannot be summed. TextIndex was not a leading sampled callee. At 512, viewport.render sampled 2.440 ms self and 4.136 ms inclusive.

Source maps locate replace at document-session.ts:544, apply at crdt.ts:210, prepareReplacements at crdt.ts:965, and viewport.render at editor-viewport.ts:356. The Chunk.drop frame maps to installed Effect Chunk.js:656. These locations belong to the frozen runtime, not subsequent source edits.

ProfileChunk events use a sampler thread. The analyzer links them to the main-thread Profile by process and profile ID. An initial thread-only filter produced empty summaries; corrected before interpretation. Raw traces stay in /tmp/alkalye-focused-interaction/sampled-multicursor-results; their hashes are retained. Main browser callbacks and worker profiles are separated.

Runner snapshot restores to .ts inside the copied 1b fixture. Private manifests, account profiles and bearer keys are omitted. Existing focused controls document fixture construction and independent acceptance gates. Both disposable browser sessions and the own 4473 server were closed. No production edits or physical frame-rate claim.

Correction: the 8.862 ms Chunk.drop value above is recursion-weighted, counting the same frame multiple times per sample. Unique-stack inclusive time is 1.226 ms, self 0.466 ms. The bottleneck magnitude inference is withdrawn; see ../multicursor-forward-chunk for corrected analyzer and matched HOLD evidence.
