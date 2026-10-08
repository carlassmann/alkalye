# Cached terminal insertion cancellation

The app undoes text through cancellation. A known active text operation that inserted exactly one currently visible terminal atom, with no removals, can reuse the existing prepared-text cache publication. The source and raw atom views must match; retained provenance, migration floor, current cancellation activity, exact last atom ID and scalar eligibility must all hold. Legacy/compacted histories, peer descendants, source fences and merged headers use the normal path.

The unchanged parser, identity/visibility preflight and existing operation signature/generation guard remain authoritative. Cache publication occurs only after validation. Sixteen public Replica contracts passed175assertions plus types and read-only Opus review, including cancel/redo chains, prearrived cancels, duplicate concurrent cancels, floor rejection, compacted provenance, atomic malformed/conflicting cases, emoji, empty documents and concurrent root headers.

Three alternating matched pairs used identical disposable durable/browser seeds and the same native backend. Each trusted1MiB/512TOKEN append+Ctrl+Z journey verified exact source, trusted undo and a fresh accepted checkpoint without pending/rejected changes.

| Complete undo observation | Baseline median / max | Candidate median / max |
| ------------------------- | --------------------: | ---------------------: |
| Largest main task         |    180.916 /199.110ms |       31.530 /31.596ms |
| Two-RAF opportunity       |        423.9 /464.4ms |         267.8 /289.1ms |
| Accepted checkpoint       |      2266.6 /2366.0ms |       2056.4 /2058.6ms |

Postjourney approximate Chromium JS heap median839.5→800.4MB, maximum846.5→802.2MB. These are whole-isolate samples, without forced GC or allocation/retention profiling; they do not isolate cache ownership.

A separate instrumented actual journey confirmed12 eligibility attempts, four cache commits and eight noncandidate operations. It is excluded from timing comparisons. Both the instrumented journey and all six timed journeys passed the exact durable/source checks.

`results.json` preserves all paired observations and module provenance; `diagnostic.json` preserves the applicability run. Timeline tracing used no CPU sampling. RAF opportunities are not physical paint or120Hz proof;31.5ms still exceeds an8.33ms task budget. This narrow path helps plain terminal insertion undo; merged frontmatter and other operations retain normal behavior.

Run the public contracts with `bun test tests/replica-terminal-cancel.test.ts`.
