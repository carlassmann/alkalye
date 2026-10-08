# Checkpoint operation ownership experiment

One-line outside candidate: after unchanged operation ambiguity validation, return when the operation already has matching target/kind. This avoids replacing an equal private Map value per atom. Duplicate set, mixed-kind, cross-target and atom identity checks remain. No Schema bypass, new cache or production change.

Strict types passed.28 public checkpoint/hydration/loading tests1711 assertions passed, including new real Replica restoreCheckpoint/fromCheckpointEffect ownership cases, existing v1/v2/v3, Unicode/fork isolation and interrupted hydration. Remote Opus32926 PASS source; its original test critique was corrected before execution (typed public restoreCheckpoint, distinct-field duplicate set, mixed-kind clock, shifted cross-target anchors, error messages). Tests/review not speed proof.

Actual2KiB→128KiB cold library switch,3 alternating paired arms. Frozen1b630c8 production source; fixed native1b backend both arms, baseline client vs exact one-line client candidate. Each cell restores identical disposable backend and clones identical profile, then deletes only cloned document journals before opening small2. Fresh lookup/passive-MISS shape is intentional; no warmed cache comparison. Exact native route/source/editability and independent HTTP accepted source hashes passed all6 cells. No writes/imports. Entry bundle digests verified. Server/browser sessions stopped.

| Metric                   | Baseline median/max | Candidate median/max |
| ------------------------ | ------------------- | -------------------- |
| Presentation opportunity | 615.342 /615.859ms  | 598.645 /617.380ms   |
| Largest full3s task      | 19.763 /19.947ms    | 18.393 /18.554ms     |
| GC union                 | 28.834 /30.011ms    | 33.239 /38.505ms     |

Readiness median improves roughly one frame; max does not improve. Largest-task difference is small and GC worsens. Both remain above8.33ms. No whole-wall cause, FPS or production-adoption claim. Cold HTTP snapshot/persist latency is not individually measured. No CPU samples or diagnostic phase wrappers in these matched timing cells. Previous sampled first-open attribution remains separately in first-open-phases.

Full3s traces are outside repo, hashes retained. Compact exact receipts/source/task metrics and executed candidate source/test/runner retained. Private manifest/API key/profile/server-account identifiers omitted. Initial orchestration failed before any browser because work config parent lacked Git initialization; fixed disposable parent only, failure retained. Commands: bunx tsc --noEmit; bun test tests/checkpoint-owner.test.ts tests/checkpoint.test.ts tests/checkpoint-hydration.test.ts tests/replica-loading.test.ts; frozen builds; bun /tmp/alkalye-checkpoint-owner/measure.ts. Work-managed server at fixed disposable4473, background agent-browser stable timeout20000.

written with gpt-6 in codex
