# Rejected terminal-removal cache experiment

The outside candidate turns a validated one-atom terminal text removal into the existing PreparedTextEdit cache path. It requires warm raw/canonical-identical atoms and source, excludes legacy atoms, checks the exact removed suffix ID and rejects prearrived cancellations or newly completed source fences. Existing parse/identity/visibility validation and signature/generation cache publication remain mandatory.

Eighteen public Replica contracts passed126assertions, strict types and read-only Opus review. Tests compare warm source/atoms with checkpoint rebuilds, covering Unicode, repeat apply, redo/cancellation, peers, malformed identity, atomic rejection, legacy multichar/empty atoms and concurrent source headers. Three adversarial tests reproduced wrong cached results before the final guards.

The actual app trial showed no benefit. Three alternating pairs used the same native backend, cloned durable seed and browser profile, trusted appendX and trusted undo. All six trials preserved exact source, trusted input, empty pending/rejected lists and a fresh accepted checkpoint.

| Complete undo observation | Baseline median / max | Candidate median / max |
| ------------------------- | --------------------: | ---------------------: |
| Largest main task         |    184.708 /190.434ms |     184.379 /192.503ms |
| Two-RAF opportunity       |        397.5 /445.7ms |         403.1 /435.9ms |
| Accepted checkpoint       |      2240.7 /2373.7ms |       2246.0 /2413.6ms |

The current app’s `compensatingChanges` uses `staged.cancel(...)`, not a terminal text-removal inverse. This candidate excludes cancel operations, so the intended cache seam does not address the measured app undo. No production code was adopted. Header support was not expanded after this result.

`results.json` preserves all six samples, exact readiness and asset provenance. Timeline tracing was enabled without CPU sampling. RAF opportunities do not prove paint or120Hz rendering; tasks remained far above8.33ms.

`candidate.patch` is the unshipped source change. To reproduce contracts, apply it in an isolated copy, then run `bun test experiments/performance/terminal-removal/contracts.test.ts`. These exploratory contracts are not registered in the production suite.
