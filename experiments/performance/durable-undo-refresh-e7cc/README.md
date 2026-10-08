# Durable Undo/Redo feedback

Three matched pairs, real production application, 2,048 UTF-16 units / 74 newlines. Both arms freeze `e7cc1367b9060136fe81b1a7950de1e0441939ec`; candidate changes only the mounted editor refresh after successful durable Undo/Redo. Identical timeline instrumentation marks model assignment and viewport-render return. No CPU sampling.

| Median milliseconds                | Baseline | Candidate |
| ---------------------------------- | -------: | --------: |
| Undo completion → model assignment |      9.9 |       0.4 |
| Undo completion → render return    |     11.1 |       1.5 |
| Undo key → model assignment        |     28.6 |      16.1 |
| Undo observer frame opportunity    |     44.3 |      26.2 |
| Redo completion → model assignment |     11.7 |       0.3 |
| Redo completion → render return    |     12.8 |       1.3 |
| Redo observer frame opportunity    |     44.0 |      24.7 |
| Undo 3-second main-task union      |   79.528 |    88.919 |
| Redo 3-second main-task union      |   76.393 |    94.905 |

Maximum main task across each complete 3-second window: Undo 3.332 → 3.065 ms; Redo 2.852 → 2.888 ms; typing 3.334 → 3.346 ms. Aggregate work increases: this is a feedback improvement, not a CPU reduction. The pending animation-frame refresh remains intentionally scheduled. Aggregate costs include unrelated background work and are not causal self-cost totals.

Each phase restores the same stopped backend snapshot and browser profile, removes browser caches, verifies writable exact source and an independent authenticated API receipt, then sends trusted `x`, `Meta+z`, and `Meta+Shift+z`. Each action has its own 3-second trace; acceptance polling runs afterward. Exact source, caret and accepted receipts pass; an untimed final Undo restores the fixture. Order: baseline0, candidate0, candidate1, baseline1, baseline2, candidate2. The generic runner's `advancing` label describes actions within a phase; the orchestration resets history between phases.

The gate0 run proves source assignment occurs inside the success tap. Public menu Undo/Redo also pass. A trusted key starts Undo; a later keydown listener removes the real editor. Removal precedes completion by 12.9 ms, no source assignment occurs, callbacks clear, server Undo is accepted, and reopening shows exact source. DOM removal is a deliberate lifecycle fixture action, not a user navigation measurement.

Loaded requested JavaScript URLs, decoded sizes and fetched emitted-byte SHA256 pins are retained. Requests are not execution coverage. Model assignment, native render return and observer animation-frame opportunity are distinct; none measures physical display latency. Headless 60 Hz, finite 2 KiB scope, n=3: no large-document or 120 Hz claim. Heap observations are boundary readings, not peak or retained allocation attribution.

Strict app/runner types and production builds passed for both marked arms. The later standalone setup adapter and heap-read probe additions were runtime exercised; no separate final strict rerun is claimed. Initial `work start` rejection occurred before a process started; corrected installed `work run` succeeds. All owned contexts and processes close. Opus 5.5 reviewed the clean patch; its cached-version concern is resolved by gate0 and direct session-version reads, without cache invalidation.

Reproduction snapshots use the existing browser-driver and oracle machinery. Supply private account, profile and backend snapshots outside Git; no credentials or databases are included. Original runtime `/tmp/alkalye-durable-undo-refresh`. Large trace files remain there; `raw-traces.json` records paths, sizes and SHA256. `summary.json` contains all 18 action observations and non-overlapping task/Layout/Paint/GC unions.

written with gpt-6 in codex
