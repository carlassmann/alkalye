# Interaction matrix runner

Archived runner/rewrite oracle strict types passed against frozen production 5c5b6aa. One real 2 KiB middle-input cell passed trusted input, exact client save, independent server receipt, native-platform Undo and server receipt. Current rewrite `1b630c8` additionally passed strict types, public fixture seed/readback and the three 128 KiB search cells once each; see `focused-rewrite-search`. The two rewrite switch and two multicursor cells also passed once; see `focused-rewrite-controls`. Original SDK runtime remains unrun. This directory changes no production code.

The runner reuses `tests/browser-driver.ts`, public editor interfaces and the existing trace machinery. It measures trusted actions in a three-second window, preserves failed stages and blocks dependent cells after an uncertain write or Undo. It records complete source hashes, server acceptance, client save completion and restoration separately. A failed setup produces no interaction timing.

## Bounded matrix

| Journey                 | Fixtures / positions                              | Samples per version |
| ----------------------- | ------------------------------------------------- | ------------------- |
| Body input              | 2 KiB; 128 KiB start/middle/end; 1 MiB middle/end | 3                   |
| Find                    | 128 KiB query, next, close                        | 3                   |
| Document switch         | 2 KiB → 128 KiB; 128 KiB → 1 MiB                  | 3                   |
| Multicursor replacement | 512 and 2,048 ranges                              | 3                   |
| Trusted scrolling       | Rich 128 KiB; 1 MiB paragraph                     | 3                   |
| Writer sync work        | WebSocket, forced polling, offline edit/reconnect | 3                   |

Version order alternates by trial. Freeze the current production source and actual main SHA, emitted asset hashes, immutable builds and their own local servers. Match source bytes, account/library composition and transport readiness. This runner currently advances backend history through accepted edit/Undo pairs; copied browser profiles do **not** reset server history. Label that limitation. Independent backend snapshots per trial require a separate managed reset step, not a claim that these profiles imply identical histories.

## Required inputs

The private manifest provides source-file paths, closed authenticated seed-profile paths, document routes, frozen loaded script paths/digests and an independent accepted-source oracle command. Never commit credentials, browser profiles or private manifests. Use real newlines from the unchanged fixture generator; metadata counts the emitted source bytes at runtime.

The oracle receives one JSON request on stdin:

```json
{
	"fixture": "rich128",
	"path": "/app/spaces/PRIVATE_SPACE/doc/PRIVATE_DOCUMENT",
	"expectedSha256": "64 lowercase hex characters",
	"phase": "seed",
	"deadlineMs": 20000
}
```

It must return only a JSON receipt with `sha256`, `characters` and, where available, accepted `cursor` / revision. It must read durable server state independently of the edited browser. Existing rewrite `apiDocuments.read` with a disposable read-only API key can provide exact server content; original main needs its public Jazz model/server reader or the existing server-only browser oracle. Browser verification must remove IndexedDB and reset Jazz session keys **before** app boot. Server receipt checking runs after the timed window, avoiding a second full editor during native input. The `rewrite-oracle.ts.txt` delegates to that existing API boundary and emits only a digest/length/revision receipt. It passed strict types and the single small-cell smoke. Archived `main-oracle.js.txt` uses the frozen original installed Jazz worker and public Document.load in a fresh in-memory context; no browser clone or local IndexedDB is used. The original adapter still needs its runtime/type gate. An arbitrary local source file is not an accepted-source oracle.

## Measurement and limits

- Full enclosing `RunTask`, including queued microtasks, plus subsequent tasks across the three-second window. Input listener duration alone is insufficient.
- Readiness and frame intervals are presentation opportunities, not proof of completed paint or physical 120 Hz. Collect Layout/Paint/GC phases separately; do not add overlapping nested durations.
- PerformanceEventTiming may omit short events. Missing entries mean unavailable, not zero input delay.
- Current `sync`, `poll` and `offline` cells measure writer/reconnect work plus eventual durable acceptance. They do **not** measure peer paint latency. Keep the existing peer-latency journey as a separate cohort.
- Loaded resource paths and matching fetched asset digests establish frozen served-asset provenance after clearing caches. They do not independently hash the executed bytes inside V8.
- `source-unchanged`, edit completion, edit acceptance, Undo completion and Undo acceptance remain separate gates. A later gate failure preserves a partial input trace; it does not establish an app crash or lost edits.
- Original platform Undo uses Meta+z on macOS. Fresh copied original profiles remove only Jazz writing-session keys before app boot; authentication stays intact.
- Multicursor verifies configured token count and exact replacement/Undo source. The rewrite adapter observes the replacement-range count at its public SourceTextarea.replace boundary during the trusted key; the original dispatches the same explicit range list. The rewrite multicursor adapter passed its 512/2,048 runtime smoke; the original adapter remains unrun.

## Remaining gates before execution

1. Verify the original SDK acceptance adapter against frozen main; keep private disposable configuration outside Git.
2. Preserve full commit/build provenance and prepare genuinely matched datasets for each version.
3. Small rewrite smoke passed; smoke each remaining adapter before a broad matrix.
4. `summarize.py` passed the small trace; preserve incomplete windows and failed cells.
5. Grant an exclusive CPU window before any measured matrix. Keep setup and sampled diagnostics separate.

The current production evidence is narrower: older full-app native traces cover rich-128 KiB middle and 1 MiB EOF; older search/switch/multicursor/sync comparisons predate recent cache changes. Recent actual app Undo/Redo proofs cover specific changes, not this complete interaction matrix. The small rewrite body cell and all seven current rewrite focused cells are passed. This is not a main/rewrite comparison. Its enclosing task was 3.303 ms; the largest subsequent task was 2.118 ms over the three-second window. This is one small-cell observation, not 120 Hz proof.

## Replay commands

```sh
BENCHMARK_CELLS=body-small bun experiments/performance/interaction-matrix/runner.ts /tmp/PRIVATE_MANIFEST.json
python3 experiments/performance/interaction-matrix/summarize.py /tmp/RESULTS/results.json /tmp/RESULTS/task-summary.json
```

Promote the archived `.ts.txt` / `.js.txt` files in a copied frozen checkout first; relative imports rely on its existing production modules and browser driver. These runnable copies passed the smoke; archives keep future unverified changes out of production type checks.

The example manifest has no versions and is a schema outline, not a runnable configuration. Populate real frozen versions, private profiles and oracle configuration first. A future full run requires an exclusive CPU window.

## Focused rewrite search smoke

Frozen rewrite `1b630c80268665f1c7838e584eeb9c6f9f0ad463` passed the query, next and close adapters on one exact 131,072-character rich document with 1,298 query occurrences. Each client source hash matched the independent public API receipt before the action; each nonmutating action retained exact source. Query kept caret 0, next selected 65–72, and close preserved caret 0 while hiding the find bar and clearing highlights. The original main was not started.

Complete three-second windows had largest RunTasks of 2.381, 2.861 and 2.874 ms. Initial enclosing tasks were 1.092, 0.435 and 0.430 ms; next/close click handling can occur after the initial pointerdown task. Presentation opportunities were 29.861, 16.312 and 32.297 ms. These are three n1 correctness observations, not a repeated timing comparison, physical 120 Hz or proof of painted completion. No source-allocation or heap claim follows.

The corrected source-only adapters now wait for the queried match/count before capturing close state, verify switch route plus editability before its exact source/server receipt, check primary multicursor selection before selecting all matches, and retain the precise replacement count plus complete edit/Undo receipts. The switch and multicursor changes have strict types and later passed the four runtime gates documented below. Multicursor's full rewrite range count is observed only at the public replacement boundary, not claimed as pre-action introspection.

Public rewrite fixture creation uses matching frontmatter/API titles and genuine newlines, preserves assigned IDs before readback, resumes assigned documents without creating duplicates, and leaves a sticky marker after uncertain creation. Original seeding checks the manifest's full Git SHA before importing its frozen Jazz SDK; it remains unexecuted. Main creation/reader and transport isolation require separate runtime proof. Source bytes were generated anew; copied profiles do not reset backend history.

The fixture generator was initially misread from JSON-escaped tool output as emitting literal backslash-newlines. A byte check disproved that; the defect claim was withdrawn before seeding. One setup command used a relative focused-cells path from the old workdir and failed before creation/browser actions; it was corrected to an absolute path. Exact public seeds then passed for rich128, mc512 and mc2048. Only rich search was run. The copied own backend used 4473 and was stopped; no phone or user data was changed. Credentials, profiles and private manifests are excluded. Raw traces remain under `/tmp/alkalye-focused-interaction/results`; committed hashes identify them.

written with gpt-6 in codex

## Focused rewrite switch and multicursor smoke

The same frozen rewrite `1b630c8` passed the remaining four adapters once each. Switch checked exact source, target route, editability and an independent accepted target receipt for 2,048 → 131,072 characters and back. Largest three-second-window tasks were 18.781 and 7.409 ms; presentation opportunities were 632.281 and 35.136 ms. The first rich opening remained a noticeable delay.

Trusted replacement of 512 and 2,048 exact `ZXMARK` occurrences checked the precise ranges at public SourceTextarea.replace, complete native source, the expected collapsed primary caret (34/35), local Saved and independent accepted edit. Native Undo restored the exact server source (1,048,585/1,048,582 characters) durably. Initial tasks containing beforeinput were 14.900 and 33.803 ms. The largest subsequent tasks were 15.101 and 53.964 ms; presentation opportunities were 15.615 and 34.447 ms. These observations exceed the 8.33 ms budget and do not establish physical frame rate. Undo acceptance passed, but Undo was outside the recorded interaction window and has no latency claim.

`focused-rewrite-controls` contains sanitized receipts, source/build hashes and hashes of all four retained traces. Sampling is n1 per cell; no main counterpart, speedup, regression trend or p95 claim is justified. The backend history advances through accepted edit/Undo pairs. The source shapes match the public generated fixtures, but copied profiles do not provide identical reset histories. Resource cleanup closed all browser contexts and stopped the isolated4473 server.

The initial remaining-cell setup used the wrong work cwd; its own reported PID had already exited before correction. The corrected frozen runtime setup then passed strict types and all four cells. The setup mistake is preserved in `setup-limit.txt`; no cell or timing started before the correction. Main SDK creation/reader, main/rewrite paired timings and sync/scroll remain separate required gates. No production runtime was changed by this evidence commit.

written with gpt-6 in codex
