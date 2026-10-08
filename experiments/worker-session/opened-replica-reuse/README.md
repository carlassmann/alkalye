# Reuse the already validated opened replica

Outside reversible candidate. Frozen `52670c0` core in both real worker arms; both provide the previously tested native MessageChannel scheduler. No production adoption here. One fresh baseline then one fresh candidate; traces enabled, no CPU sampling. Same real account/HTTP backend, 1 MiB Unicode source and actual worker-backed EditorElement. This is not a full production app benchmark or a 120 Hz claim.

| Public boundary                 |   Baseline | Reuse candidate |
| ------------------------------- | ---------: | --------------: |
| Cold Open RPC                   | 4,245.7 ms |      2,923.9 ms |
| Begin editor basis              |   162.0 ms |        152.6 ms |
| Offline independent-worker Open | 1,661.4 ms |      1,665.2 ms |
| Flush                           |     0.6 ms |          0.7 ms |
| Close                           |     2.1 ms |          2.0 ms |
| Worker scope disposal           |     0.2 ms |          0.3 ms |

Cold Open falls 31.1% in this single ordered pair. Setup seed creation (5,679.7 / 5,464.1 ms) is excluded. All nine account, exact native/FIFO source, server acceptance and offline reopening assertions pass in each arm. Eight trusted tail characters; accepted cursor 2, exact source 986,907 UTF-16 units. Zero offline API requests, no readiness deadlines.

The source change makes private `check(opened)` return its fresh restored Replica only while initializing. Replay uses that exact Replica instead of restoring the same snapshot again. Initial pre-write validation remains, every semantic check remains, and validation callers discard the private result with `Effect.asVoid`. There is no shared hash memo, trusted-action flag or public mutable capability.

Trace evidence identifies the removed phase: baseline's published-engine restore costs 1,202.0 ms and is absent in the candidate. Candidate still performs pre-write opened validation (1,202.5 ms) and replay validation (1,112.4 ms), then materializes and forks that validated Replica before publishing it. These are inclusive phases and cannot be summed blindly. Offline reopening uses durable cached state, hence no material change in that measured boundary.

## Public correctness proof

Real SQLite journal and public CLI DocumentSession layers; no restore counters or helper-level assertions. Eight contracts, both default and cooperative modes:

- Initial snapshot, options.author attribution, exact Unicode edit, durable save, Undo and independent offline reopen.
- Wrong-document and corrupt snapshots fail without poisoning subsequent valid opening.
- A racing second opened record cannot replace the first accepted source or cursor.
- Interrupting after a real opened journal write leaves independent replay recoverable without a network snapshot.

Baseline and candidate strict types pass; each runs eight tests, twenty assertions. Tests use a public DocumentJournal adapter solely to hold the replay read of an actual persisted row for interruption. Read-only Opus 5.5 finds no correctness blockers: replay is gated, no state changes between check and publication, ownership remains private and interrupted forks publish nothing. Existing passive isolation and deep CLI suites remain relevant to adoption.

## Preserved harness failures and limits

Initial commands targeted the original runtime cwd rather than the newly copied test runtime. The copied runtime lacked its frozen build module. The first test draft used Deferred instance properties instead of Effect 4's Deferred.await function; four happy/invalid cases passed, four control cases failed before exercising their intended boundaries. Explicitly including the test in tsconfig exposed missing required transport in the database-name call. All failures remain in the evidence; the final same contracts pass on baseline and candidate.

Candidate source/digests, both result arrays, driver, patch, public contracts and terminal review retained here. Current emitted candidate hashes were recorded; baseline instrumented source hash is retained, but baseline emitted asset hashes were not captured before rebuilding. Do not claim equal asset bytes from equal resource sizes. Large raw traces and disposable profiles remain in `/tmp/alkalye-worker-cold-open-diagnostic/reuse-{baseline,candidate}`; no credentials or database copies committed.

Scheduler cancellation/channel finalizer runtime proof is still a separate production gate; this experiment does not claim it. Cold opening remains seconds, not instant. Whole-window task budgets and repeated validation are unresolved. No production recommendation beyond consciously reviewing this narrow reuse.

Written with gpt-6 in codex.
