# Rejected terminal prefix diff

Native `startsWith` shortcuts replaced two JavaScript prefix scans in SourceTextarea and EditorViewport. `candidate.patch` is experimental; production remains unchanged.

All 48 matched app cells passed exact source, trusted input, fresh accepted journal cursor and durable peer reload checks. Eighteen public EditorElement/SourceTextarea contracts and TypeScript checks passed; read-only Opus review found no correctness blocker. Performance did not justify adoption.

128 KiB largest-task medians often worsened: plain append 8.25→10.20 ms, header append 9.11→10.95 ms. At 1 MiB task medians barely changed (roughly 13.6–14.5→13.4–14.0 ms). Plain append two-RAF opportunity was 341→347 ms; header append 816→821 ms. These are not 120 Hz measurements.

## Method

Baseline browser and unchanged native Bun backend: `aad445b`. Candidate changes only the two browser source files. Frozen asset SHA256 values and requested resource URLs are recorded in `results.json`; executed script bytes were not independently hashed.

Three alternating fresh logical owner/writer invitation histories per arm and size; not byte-identical cloned database/profile pairs. Public seed input creates plain/header 128 KiB and 1 MiB documents. Measured owner append and Backspace use trusted native input. Receiver source timing starts at sender's browser-local beforeinput epoch; source visibility, two additional RAF opportunities, and fresh accepted checkpoint are separate milestones. Complete main-thread RunTask scopes, Layout/Paint and sampled whole-browser heap are recorded; no CPU sampler. Heap is not an allocation or retained-heap proof.

Large source-arrival delays are not explained by receiver task size alone. Backend/transport waiting is an unverified hypothesis; these traces do not attribute it.

`excluded-runs.json` preserves both fixture failures: initial huge argv E2BIG and a reload-cleared harness variable. Neither contributes to the confirmatory summaries. Browser-side seed construction and post-reload expected-value reconstruction fixed the harness without changing application state or extending deadlines.

## Reproduce

Apply `candidate.patch` only in a disposable checkout, build immutable before/after assets, and run:

```sh
PEER_PHASE=before PEER_SIZE=131072 PEER_TRIALS=1 PEER_OUTPUT=/tmp/peer-before.json ALKALYE_TEST_ASSETS=/absolute/baseline-assets PEER_SERVER=/absolute/native-baseline/tests/browser-document-app.ts bun experiments/performance/peer-diff/journey.ts
bun experiments/performance/peer-diff/contracts.ts
```

Repeat with candidate assets, sizes 131072/1048576 and alternating order. Run contracts against both source variants. Keep agent-browser background sessions and its daemon timeout environment stable at 20000. No production backend changes, user profiles or user databases.

Raw timeline traces remain in `/tmp/alkalye-peer-diff/app/`; compact per-cell trace metrics and all 48 observations are committed in `results.json`.
