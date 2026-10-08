# Worker cold opening: existing native scheduler

Outside prototype, frozen production core `52670c0`. No production adoption. One incomplete default-scheduler control and one corrected native-scheduler run; diagnostics include tracing, not CPU sampling. Fixture: real HTTP account, signed workspace/document, 1,048,576 UTF-8 bytes / 986,899 UTF-16 units, actual worker DocumentSession and EditorElement. This is not the complete app UI or a physical 120 Hz test.

| Boundary                           | Default control                         | Native scheduler   |
| ---------------------------------- | --------------------------------------- | ------------------ |
| Cold Open RPC                      | Not complete at 20 s readiness deadline | 4,418.2 ms         |
| First opened-snapshot validation   | Still running at trace stop             | 1,300.2 ms         |
| Replay opened-snapshot validation  | Not reached                             | 1,235.1 ms         |
| Published engine hydration         | Not reached                             | 1,235.1 ms         |
| Begin editor basis                 | Not reached                             | 166.4 ms           |
| Offline Open on independent worker | Not exercised                           | 1,799.2 ms         |
| Flush / Close / scope disposal     | Not exercised                           | 0.8 / 2.4 / 0.2 ms |

Seed creation took 5,698.4 / 5,546.6 ms, excluded from Open. Native ready followed account + seed + Open + Begin + mount; no claim of instant opening. All nine account, exact source, trusted input, FIFO, accepted server cursor and offline-reopen assertions passed. Eight trusted characters appended after explicit public tail selection; accepted cursor 2, exact source length 986,907. Offline verification recorded zero API requests. Its Flush, Close, disposal, worker creation, offline Open and Read were individually marked: an earlier whole-method deadline cannot be assigned to offline Open.

## Causal evidence and limits

Both arms use identical instrumentation and source except the existing MessageChannel scheduler provision in the worker runner. Separate fresh browser profiles and fresh backends; exact `localhost` origin, stable 20,000 ms driver timeout, background agent-browser. Scheduler is already used by the main app. Worker retains its own BackgroundWork; the DOM background-work layer is not provided.

Worker-only first-validation window: default trace remains incomplete after 14,222.5 ms, containing 2,254 TimerFire events and median 5.01 ms idle between RunTasks. Native validation completes in 1,300.2 ms, with zero TimerFire events and median idle 0 ms. This supports scheduler task-source delay as a large opening cost. Windows differ in completion and duration; do not compare their accumulated CPU totals as equivalent completed work. Main and other threads excluded from these counts.

Native validation's largest worker RunTask is 12.281 ms, still above 8.33 ms. The repeated full snapshot validation and hydration remain expensive; scheduler reuse does not remove them. Trace events may overlap, and CPU-inclusive phases must not be added together. No retained-allocation attribution or 120 fps claim.

Read-only Opus 5.5 review found scheduler propagation and worker import safe. Cancellation and channel release are sound by source inspection; scope-close channel counters were **not** exercised. Worker termination through the real verifier succeeds but does not establish the scheduler's native-channel finalizer contract. Production adoption needs a conscious platform scheduler extraction and public cancellation/release proof, rather than importing a client-layer capability permanently into the worker.

## Preserved failures

- `origin-failure`: 127.0.0.1 URL mismatched the backend's localhost public origin. Account bootstrap failed before Open; no loading inference.
- `default-60s`: prior default run exceeded three readiness deadlines. Its instrumentation predates the finer event-write/validation marks; retain separately.
- `control`: fresh strict same-instrumentation control, one deadline; Open still running when browser closed.
- `native`: scheduler Open succeeded and server accepted exact trusted input, but verification failed before Flush because the driver omitted tail selection. The engine was not changed to fix this harness error.
- `native-tail-corrected/syntax-failure.log`: corrected driver initially failed to parse; no browser actions occurred. One corrected fresh run then passed all gates.

Raw large traces and browser authentication storage remain in `/tmp/alkalye-worker-cold-open-diagnostic`; sanitized results, exact source snapshots, candidate diff, emitted digests, driver and review are retained here. Source snapshots use `.ts.txt` to avoid misleading project imports. `summary.json` records native emitted asset hashes and worker task scope.

Reproduction: use the standalone runtime's `work.config.js`, `WORK_STATE_ROOT=/tmp/alkalye-worker-cold-open-diagnostic/work-state`, and **runtime cwd** for `work restart web`. Read its actual logged localhost URL. Build default runner first, then run `COLD_DIAG_READY_ATTEMPTS=1 bun control/run.ts URL`; restore `worker-native.ts.txt`, rebuild and use `COLD_DIAG_READY_ATTEMPTS=3 bun native-tail-corrected/run.ts URL`. Each arm needs a fresh profile and backend. Do not rerun into retained profile folders.

Written with gpt-6 in codex.
