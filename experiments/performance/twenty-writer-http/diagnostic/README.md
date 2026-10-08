# Separate sampled server diagnostic

Application `78e89af`, fresh disposable dataset, same twenty authenticated writers and sixty multi-character append actions as the unsampled measurement. Separate native Bun server process PID 43119; driver process does not receive the sampling profiler. Requested JavaScriptCore sampling interval: 100 microseconds.

The driver/server exchange local start/ready/stop files. Sampling starts after authentication, invitations and all actions are prepared; stops after all sixty receipts. Diagnostic timings **are not comparative latency evidence**: 2,599 ms journey; request median 304 ms, p95 558 ms, max 594 ms. All sixty accepted, contiguous positions and exact markers; public snapshot/history cursor 61.

The human-readable profiler lists 10,965 samples; raw stack data contains 10,967 entries. Self sample counts: `rawVisibleSteps` 5,048 (~46%), `sourceHeadersSteps` 2,222 (~20%), `sourceAtomsSteps` 225 (~2%). Inclusive `text` count 9,158 overlaps these children: do not sum inclusive counts.

Every mapped self `rawVisibleSteps` sample calls `Replica.text` from `projectDocument` in `src/server/workspace-projection.ts:418`, while deriving `documentMetadata`. This is source materialization in summary projection. It is not attribution to an IndexedDB callback, transport or SQLite wait. The single-scalar terminal peer cache cannot cover the multi-character operations; interleaved causal branches also challenge exact-tail eligibility. A larger terminal cache remains a hypothesis until matched public correctness and unchanged-workload timing prove it.

Raw 25 MB stack data remains outside Git at `/tmp/alkalye-20-writer-frozen/diagnostic/stacks.json`; its SHA-256 is retained in `summary.json`. Source IDs and sample counts in the compact summary preserve attribution. `sampled-server.txt` and the driver patch retain the exact diagnostic instrumentation, including frozen absolute imports and handshake paths. These are evidence, not production architecture. Two pre-execution setup attempts (server readiness and generator syntax) emitted no measured requests; only the successful diagnostic contributes results.

written with gpt-6 in codex
