# Production 1 MiB input and GC diagnostic

Frozen production `0e13876ece5b33dfb7eb5722f7f710f1afa223bb`, real isolated Bun backend. One trusted tail `x` in a 1 MiB long paragraph, then three seconds of aftermath. A separate sampled diagnostic repeats the action after exact accepted Undo. Both arms passed exact initial/local source, independent accepted edit, local Undo, idle save badge, and independent accepted Undo. No original-version comparison here.

| Arm                         | Enclosing input RunTask | Largest subsequent main task | End-of-window sampled JS heap |
| --------------------------- | ----------------------: | ---------------------------: | ----------------------------: |
| Unsampled, n=1              |                7.249 ms |                    20.755 ms |                      695.7 MB |
| CPU sampled diagnostic, n=1 |                7.582 ms |                    20.147 ms |                      748.1 MB |

The diagnostic is attribution evidence, not comparative latency. Headless frame opportunities are approximately 60 Hz; this does not prove physical 120 fps. Deferred tasks exceed 8.33 ms.

## Direct evidence

The unsampled largest main task begins 602.6 ms after the trusted key event. It contains a 20.272 ms MajorGC, with V8's recorded heap changing from 1,317,781,256 to 562,613,156 bytes. The sampled largest task similarly contains 19.775 ms MajorGC. Both are main-isolate events inside an Effect scheduler MessageChannel continuation. The continuation label does not establish allocation ownership.

Within the sampled input-to-three-second window, main-profile self samples include `compactAtomSteps` 181.2 ms, `rawVisibleSteps` 128.8 ms, and `checkpointSteps` 30.1 ms. `compactCheckpointSteps` has 30.8 ms self and 219.0 ms inclusive samples. Inclusive values overlap and must not be added. GC accounts for 468.4 ms of CPU samples across the window, including work outside the longest stop-the-world task.

Profile ownership uses the Profile start event's thread, not the separate sampling thread attached to ProfileChunk. Main code maps to `src/shared/model.ts`, `crdt.ts`, and `checkpoint.ts`. The separate `/document-worker.js` profile maps to `document-stats.ts` with roughly 4 ms of sampled work; it is a stats derivation worker, not an authoritative document session. The service worker is separate again.

The next narrow investigation is checkpoint compaction's per-atom allocation and cold visibility traversal. Samples support these expensive call paths; they do not prove which objects caused GC, retained allocation ownership, or how much a change would save. Installed agent-browser exposes no documented HeapProfiler allocation sampling command. No production change follows from this run.

## Method and limits

The actual production build and copied disposable backend use managed `work` in `/tmp/alkalye-production-allocation-oct8`. The previous owned rewrite process was stopped before copying its data. Trial profiles remove service-worker, HTTP, and code caches. Independent observers delete only document journals before loading, preserve authentication, and compare complete source hashes. No live-user data or original OOM backend is used.

History advanced through prior validated benchmark edits; this is an existing-document workload, not a fresh import. CPU profiling starts after document readiness, then two frame opportunities precede the sampled input. `afterHandler` is only a capture-listener microtask timestamp, not native handler duration. Whole enclosing RunTask durations are authoritative. The three-second window is finite and does not establish continuous input latency or bounded backlog.

`metadata.json` retains emitted SHA-256 digests; observations retain loaded resource URLs and decoded sizes. This is not an executing module-memory proof or a bundle closure. Heap samples are approximate isolate observations, not retained-heap measurements.

`measure.ts.txt` is an executable snapshot kept outside the app TypeScript build. Its absolute disposable paths require adjustment. `analyze.py` extracts top-level tasks and CPU samples; `map.py` applies emitted source maps. Full traces remain outside Git under `/tmp/alkalye-production-allocation-oct8`. `analysis.json` retains the top 35 self-sampled frames per profile; no nested duration sums are used.
