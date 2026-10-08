# Native SourceTextarea difference experiment

Experiment only; production unchanged. Written with gpt-6 in codex.

Two 4096-code-unit native string-comparison loops skip equal prefix/suffix blocks. Existing per-unit remainder and surrogate seam adjustments remain unchanged. No replacement hints, dependencies or private helper tests.

Strict types passed. Twenty-five real `SourceTextarea` scenarios produced identical public replacement outputs against unchanged production. Tests cover chunk seams, overlapping repeated text, Unicode/lone surrogates, projected links, source/index/caret agreement and native replay. Trusted selected-emoji input replaced the pair with `Q`, preserving exact source/caret. The existing lone-surrogate quirk deliberately remains unchanged.

Three ordered before/after browser pairs used actual mounted native textarea plus SourceTextarea reconciliation at 128KiB and 1MiB. Each cell primes Undo/Redo, then measures one synchronous call per direction with `performance.now`; exact source, source index, source caret and public deletion range follow each cell. Each variant also repeats the public contracts and trusted native input. Native visible fragment content at EOF was not independently asserted. No profiler, frame, full-app or 120Hz claim.

| Source size | Undo median before → after | Redo median before → after | Undo max before → after | Redo max before → after |
| ----------- | -------------------------- | -------------------------- | ----------------------- | ----------------------- |
| 128KiB      | 0.7 → 0.5ms                | 0.6 → 0.5ms                | 0.7 → 0.5ms             | 0.8 → 0.5ms             |
| 1MiB        | 4.4 → 2.4ms                | 4.3 → 2.7ms                | 4.4 → 2.6ms             | 4.5 → 2.8ms             |

Exact frozen baseline commit and SHA-256 source hashes are in `results.json`; source snapshots are the executed bytes. Initial TypeScript errors from omitted copied build module/module marking were corrected before runtime. A shell URL quoting failure during baseline contract setup was corrected and baseline output rerun. Those failures do not belong to the measured pairs. Opus review found no semantic blockers; native substring allocation/rope costs still require full-app verification before adoption.

Reproduction: copy source snapshots back to their `.ts` names in a disposable copied repository with current dependencies, place fixture at its root, build both variants using `build-fixture.ts`, preserve both bundles as `assets/{baseline,candidate}.js`, start `server.ts` through `work`, and set its printed URL in `run-pairs.py`. Use background agent-browser with stable 20000ms default timeout. No live/user server or data is required.
