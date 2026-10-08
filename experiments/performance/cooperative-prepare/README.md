# Undo proposal warming experiment

Rejected for production. Three paired synthetic 1 MiB browser journeys, frozen at f9508ce, passed exact source and accepted journal checks. The candidate privately stages undo proposals and warms source before atomic publication. Ordinary edits keep the native path.

| Median                     |    Native | Candidate |
| -------------------------- | --------: | --------: |
| Largest undo task          |  188.4 ms |   25.4 ms |
| Undo frame opportunity     |  368.1 ms | 1313.5 ms |
| Undo accepted cache        | 1491.6 ms | 2547.7 ms |
| Sampled heap after undo    |    619 MB |   1051 MB |
| Trusted character dispatch |   4.58 ms |   4.61 ms |
| Largest deferred edit task |   9.71 ms |  10.32 ms |

The smaller tasks do not compensate for slower readiness and more memory. Opus found repeated staging: journal replay decodes a different Recording object, so the identity guard discards the earlier private preparation and copies full maps again. Known proposal validation also stages without publication. These are source findings, not sampled attribution of the regression.

`candidate.patch` applies to f9508ce. `results.json` preserves each sample and its limits. Raw traces and disposable profiles remain outside Git in `/tmp/alkalye-undo-warm-current`. The same native backend served both clients. This does not measure candidate server performance. Heap values are readiness samples, not peaks; the single-character control does not establish sustained typing throughput. Background frame opportunities do not establish 120 Hz presentation.

Candidate-cwd public module integration: 36 tests, 278 assertions; strict TypeScript passes. Read-only Opus 5.5 review found no semantic blockers. Generation/clock checks guard all private publication; stale work restarts the full permission/causality preflight. Undo-only routing remains an experiment; general incoming cold batches still need a solution.

Next bounded test: reuse preparation only for an equal immutable proposed action under the existing generation/clock guards; avoid staging already-known proposals. Recheck full session/public contracts and repeat the same browser journey before adoption.

written with gpt-6 in codex


## Semantic action reuse: rejected

A separate three-pair experiment kept frozen f9508ce and the same native backend. The candidate adds structural `equalAction` reuse, requires identical captured durable/current replicas, retains atomic generation/clock guards, and leaves known proposal validation native. It passed 36 public session/module tests (278 assertions), strict TypeScript, and a read-only Opus review.

| Median | Native | Reuse candidate |
|---|---:|---:|
| First frame opportunity | 330.9 ms | 1346.7 ms |
| Second frame opportunity | 351.6 ms | 1368.0 ms |
| Undo accepted cache | 1650.6 ms | 2653.5 ms |
| Largest undo task | 164.4 ms | 29.9 ms |
| Sampled heap after undo | 625 MB | 1103 MB |
| Trusted character dispatch | 5.07 ms | 4.53 ms |
| Largest deferred edit task | 10.21 ms | 9.55 ms |

All six journeys passed exact source, trusted undo, strictly newer accepted journal cursor, and zero pending/rejected checks. Task size improved, but latency and memory still regressed badly. Do not adopt.

`reuse.patch` applies after `candidate.patch`; `reuse-results.json` preserves all samples. Raw traces remain in `/tmp/alkalye-undo-warm-reuse`. Slot-hit and preparation counts were not instrumented, so the result does not establish whether structural reuse occurred. Inspect and measure slot invalidation before attributing the regression or changing index representation. Single-character controls do not establish sustained typing throughput; heap samples are not peaks.

written with gpt-6 in codex
