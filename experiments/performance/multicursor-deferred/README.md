# Deferred multicursor task attribution

Frozen rewrite `aad445b`, separate diagnostic after the fresh main comparison. One first trial, then three repeated trials of the existing public 1,298-selection replacement journey, using V8 CPU sampling. Full-source restoration between trials is excluded from the replacement interval, but may still cause later asynchronous work. Diagnostic timings must not replace unsampled benchmark values.

First trial's largest deferred task: 91.0 ms. Repeated second trial reproduced a **1642.0 ms task at +1670.5 ms** after trusted input. Third trial's largest task: 125.5 ms. Source-exact replacement/restoration and pending-zero checks passed; these checks do not independently prove projection/snapshot idleness.

Source-mapped CPU samples in the 1642 ms task:

| Stack                                                      | Approximate inclusive ms | Approximate self ms |
| ---------------------------------------------------------- | -----------------------: | ------------------: |
| IndexedDB transaction `s.oncomplete` → Effect continuation |                   1514.5 |                 0.0 |
| `applyChanges` → `Replica.applyTogether`                   |                    683.2 |                 0.0 |
| `validateChanges` → `Replica.validate`                     |                    514.6 |                 0.2 |
| `Replica.prepare`, shared across those stacks              |                   1080.2 |                27.1 |
| `parseOperation`                                           |                    715.3 |               380.3 |
| `validateIdentities`                                       |                    333.8 |               194.6 |
| Garbage collector                                          |                     98.8 |                98.8 |

Inclusive rows overlap; **do not add them**. Source mapping identifies synchronous operation normalization, Schema decoding, identity checking, visibility preparation and indexing resumed by the Effect fiber. The callback label does not establish that IndexedDB cloning caused the stall. GC is a minority of sampled work.

The much larger second trial is compatible with a previous whole-source restore's late replay/acceptance. CPU samples contain no action IDs or arguments, so that ownership remains a hypothesis. A clean control must either avoid whole-source restoration or wait for independently observed accepted journal/projection/snapshot progress before the next trial. Preserve the original mixed-journey evidence.

A minimal outside candidate parses and privately freezes batch facts once inside `Replica.applyTogether`, then prepares each replica's identities and visibility before any publication. It preserves normal untrusted single-apply decoding and exposes no trust flag. This could remove duplicate normalization during application; the separate validation pass remains. Public contracts must cover caller/exposed-history mutation, forks, duplicate members, final-replica conflict, Unicode, replay and causal undo. No candidate adopted here.

Opus 5.5 reviewed the sources read-only: attribution remains suspected; parse-once is coherent with ownership tests; it cannot alone meet 8.33 ms because even one large preparation remains expensive. A subsequent cooperative preparation must keep work private, check every replica's generation/clock before publishing, retry stale preparation, and preserve all-or-nothing behavior and interruption safety.

`large-profile.json` contains source-mapped frames, approximate sample weights and task boundaries. Raw traces remain in `/tmp/alkalye-fresh-matrix`; their SHA-256 digests are retained. No production changes or new frame-rate claim.

written with gpt-6 in codex

## Parse-once A/B: rejected

Four no-sampler arms, n=3 each, identical stopped-backend/profile snapshots restored before each arm. Order: baseline pending-only, candidate clean, baseline clean, candidate pending-only. Within each arm, history advances through replacements and full-source restorations. Each arm uses its frozen source tree's own backend, same origin, fresh copied profile with SW/HTTP/code caches removed. One initial setup used an incorrect absolute server-script path, was aborted and excluded entirely.

Both arms wait for an initial accepted projection cache at the latest journal position. The **clean** condition also waits after each full-source restoration: cache transaction complete, cache position equals latest positions cursor, pending/rejected empty, exact source and UI pending zero. The pending-only condition preserves the original source-exact/UI-pending-zero gate. This is a stronger accepted-cache control, not proof that every optional background fiber is idle.

| Gate and code          | Enclosing input median / max ms | Largest input + 3 s task median / max ms |
| ---------------------- | ------------------------------: | ---------------------------------------: |
| Pending-only baseline  |                 41.077 / 47.143 |                       115.415 / 1610.534 |
| Pending-only candidate |                 40.087 / 47.316 |                       118.914 / 1480.695 |
| Clean baseline         |                 40.115 / 47.986 |                        114.076 / 120.471 |
| Clean candidate        |                 40.470 / 47.366 |                        114.066 / 116.408 |

All replacements were exact. Clean restoration gates passed all trials. Some replacement observations still had pending actions after 3 s; their raw states remain recorded. The large pending-only tail's disappearance with stronger previous-restoration readiness establishes an **association with pending restoration work**, not action-level attribution from CPU samples. Bulk source restoration remains a supported real workload, but it should not be called isolated multicursor cost.

The candidate leaves clean median task work effectively unchanged and does not improve input consistently. Its lower pending-only maximum is insufficient evidence to adopt shared frozen facts. **No production change adopted.** The clean approximately 114 ms deferred task still exceeds the 8.33 ms budget substantially.

Candidate public ownership/atomicity/Unicode/replay/undo contracts plus existing batch/terminal contracts: 44 pass, 405 assertions; types pass. `candidate-contracts.test.ts` is for the rejected candidate, not an additional production suite. `rejected-candidate.patch`, scoped harness, raw samples and task summaries preserve the experiment. No sampler overhead in this A/B; sampled attribution remains separate above.
