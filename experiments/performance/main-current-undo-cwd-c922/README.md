# Paired 2 KiB input and Undo smoke

One sample per version, original `a749728` then rewrite `c922a8d`. Both arms passed exact seed, edited-source and restored-source checks through independent server readers; trusted native input and modified `z` Undo restored the ordinary-edit caret. Strict types passed. This validates the archived runner's small-cell gates, not the complete interaction matrix.

| Phase | Main enclosing task | Rewrite enclosing task | Main aftermath max | Rewrite aftermath max | Main frame opportunity | Rewrite frame opportunity |
| ----- | ------------------: | ---------------------: | -----------------: | --------------------: | ---------------------: | ------------------------: |
| Input |            4.167 ms |               2.976 ms |           8.008 ms |              2.939 ms |              13.301 ms |                 18.232 ms |
| Undo  |            1.702 ms |               0.525 ms |           8.291 ms |              2.848 ms |              15.853 ms |                 50.647 ms |

Rewrite task durations were lower in these samples, while both source-ready frame opportunities were slower, especially Undo. The latter is an observed readiness/frame opportunity, not displayed-pixel latency; its cause is unprofiled. No broad speed or 120 Hz claim follows. Three-second windows include deferred main-thread tasks, without a CPU sampler. Layout/Paint union time, GC, raw Event Timing and enclosing-task details remain in `summary.json`. The capture microtask is not the completed native input handler; use enclosing tasks and actual Event Timing instead.

The same 2,048-character source has 74 real newlines and digest `2273364cd6f408d0ed16b26d0508aa43c39894cf3dc347b86eb996afbe87a4f2`. Histories advanced: main had one previous accepted pair, rewrite two. Profiles were copied and original SDK numeric session keys reset before app boot, but backend histories were not reset to identical graphs. Version order was fixed. This is n=1 smoke evidence with those limitations.

Before mutation, the read-only cloned publisher plus explicit SDK alias cwd passed (`6706`), using the existing known document; no creation occurred. Its fresh independent reader matched the source. The earlier original oracle deadline remains archived in `../main-current-undo-gate-c922`; its phase was unknown. The new successful gate supports the corrected setup without proving that cwd alone caused the historical failure. Successful seed/edit/Undo oracle phases are retained separately for both versions, without credentials or document IDs.

`results.json` records actual fetched JavaScript hashes in each observation. These verify emitted requested resources; resource requests are not execution coverage. The tested source archives exactly matched the promoted runtime before packaging. `metadata.json` carries source digests before formatting. Raw traces remain outside Git at the paths in `trace-manifest.json`, with byte sizes and SHA-256. No account keys, browser profiles or databases are included. All own browser contexts and three managed servers were stopped before CPU handoff.

Replay only with private known-document manifests and an exclusive CPU lease. Promote archived TypeScript outside the repo, use installed dependencies and the original SDK alias cwd, then run:

```sh
bun run check:types
bun experiments/performance/main-current-preparation/runner-with-undo.ts PRIVATE_MANIFEST.json
python3 experiments/performance/main-current-preparation/summarize-phases.py PRIVATE_RESULTS.json PRIVATE_SUMMARY.json experiments/performance/interaction-matrix/summarize.py
```

Require fresh output, exact independently accepted seed before input, client save completion before Undo, exact independent restored receipt afterward, and new original SDK writing sessions. Stop dependent cells on uncertain outcomes. Rich fixtures and the n=3 matrix remain unrun.

written with gpt-6 in codex
