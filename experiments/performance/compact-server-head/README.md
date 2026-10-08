# Compact durable server checkpoints

Candidate: one c922a8d writer line stores `compactCheckpoint(replacement.checkpoint())` instead of expanded `replacement.checkpoint()`. Full restore/owner/alias/causal validation, tail checks, ACL, fingerprint/cache and transaction semantics unchanged. No head pass-through, read shortcut or migration.

Three alternating pairs: fresh document SQLite arms, identical captured public creation/action IDs and operation payloads, same seeded account/master key/browser profile, same c922 client asset closure. Public WorkspaceStore writes use the existing authenticated identity seam; these are deep-module writer timings, **not HTTP write timings**. Writer scopes close before fresh server scopes open. Each arm verifies exact source, clock, public history IDs and expanded checkpoint hash. Real native route/source/editability plus independently authenticated HTTP source receipts pass in all six cold 2 KiB → 128 KiB cells.

Accepted history omits original proposal guards. Fixture DTOs are explicitly decoded with DocumentActionSchema; ordinary guards match public buildAction's empty guards, access guards reconstructed from preceding validated register state. Exact proposal DTOs are shared across arms. No casts or skipped server validation. Fresh log UUID epochs differ normally; do not claim identical epochs.

| Median, n3 each                     |      Expanded v2 |    Compact v3 |
| ----------------------------------- | ---------------: | ------------: |
| Cold ready                          |       481.932 ms |    400.769 ms |
| Snapshot TTFB                       |       242.400 ms |    157.000 ms |
| Rich public creation                |       421.100 ms |    361.917 ms |
| Rich durable UTF-8 head             | 32,116,142 bytes | 134,818 bytes |
| Main enclosing task maximum in cell |        17.996 ms |     18.304 ms |
| Main GC interval union              |        21.791 ms |     20.050 ms |

Task statistics cover CrRendererMain only, intersection with interaction:start → interaction:end (~3 s), using entire enclosing task durations. GC intervals clipped and unioned on that thread. Readiness maximum 500.056 → 401.401 ms; enclosing task worst 18.068 → 18.473 ms. **No main-task/120fps improvement claim.** Heap values are start/end points, not peaks. Full compact JSON holds all six raw cell metrics, write/commit timings and state/source hashes; large traces/private account/config/captured actions stay outside Git. No CPU sampler or diagnostic marks in performance assets.

Strict passes. Three new SQLite contracts plus existing revision/API/blob integration: 37 PASS, 0 FAIL, 319 assertions. Unicode deletion/Undo, comments, 100-action checkpoint rewrite/history, exact retry/reopen, legacy v2 read and corrupt v3 refusal covered. Initial two fixture failures retained: bare buildAction lacked committed beforeimages; expected body omitted newDocument title frontmatter. Corrected tests use guarded public store.action/applyAction and explicitly asserted canonical frontmatter+body. Provision strict failures (missing guards, one syntax typo) also retained.

Opus source review: no blockers; flagged added compaction/write cost and interval/legacy proof requirements. Executed writer latency improved here; this does not generalize to arbitrary documents or migration. Production checkpoint interval is 100. New/re-written heads benefit; existing v2 heads remain expanded until a normal later checkpoint. No existing phone data changed by this experiment.

written with gpt-6 in codex
