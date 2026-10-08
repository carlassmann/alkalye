# Actual worker multicursor failure

Experimental actual app route. Production unchanged. Frozen worker route source derives from 72dd6f5 with DocumentSession snapshot reuse fdbc7946; the original route passed eight small-document native gates. Full feature parity remains incomplete.

The first 1 MiB, 512-selection attempt failed document readiness before input. A later instrumented reopen of that retained fixture succeeded in about two seconds. Its successful reopen does not explain the original timeout.

The uninstrumented retry selected 512 ranges, accepted trusted `x`, and displayed the exact replacement. It then became read-only. A subsequent independent API read matched the retained draft and confirmed ledger basis: 1,046,566 UTF-16 units, SHA e42499f5ec1a310b6224f059eb4dd3a42fb6fb2dfda854322a2557a283879310. The ledger acknowledged sequence 1 with no pending entries. Undo, burst input and 2048 selections were never reached.

The incomplete three-second observations show main-thread task peaks of 2.050 ms for selection and 7.255 ms after replacement. A non-main thread reached 190.251 ms; its worker attribution remains provisional. These are single observations, with no matched baseline or completed editing journey. The 15.993 ms “local-saved” marker sampled a stale badge before RPC completion and is not a durability measurement.

A separate cloned backend/profile retained all original evidence. Its fresh 512 fixture initially failed readiness. A diagnostic reopen used a cached, uninstrumented app and showed “Update available”; its graph check failed. Clearing clone-only code and service-worker caches produced a correctly instrumented, writable reopen with 33 verified script bodies. This cache mismatch does not establish the cause of either earlier readiness timeout.

The next trusted replacement on that previously unedited clone captured WorkerDocumentFailure `SessionFailure`, category `failure`, at `merge-candidate`, with sequence 1 already acknowledged. The editor retained the exact replacement and reported “Could not save on this device.” The worker maps underlying errors into SessionFailure, so its original cause is not yet identified. No timeout or generation guard was relaxed.

Script pins compare network re-fetches of observed URLs and the worker entry against the built graph before input. They do not capture the original response bytes. Source hashes recorded afterward are explicitly retrospective. Original traces remain at paths and hashes in provenance.json. Account-bearing settings keys and page body text are excluded from this package.

written with gpt-6 in codex
