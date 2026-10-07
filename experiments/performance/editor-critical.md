# Extreme editor tasks

A 1 MiB document with 2,048 selections still exceeds the 8.33 ms main-thread budget. Preparing each replica once cuts the largest deferred task by about 24%; the synchronous edit task remains about 30 ms.

| Top-level renderer task                         | Before median / max | Prepare once median / max |
| ----------------------------------------------- | ------------------: | ------------------------: |
| Select all occurrences                          |    0.715 / 1.453 ms |          0.740 / 1.414 ms |
| Trusted replacement input                       |  29.540 / 35.771 ms |        30.073 / 35.511 ms |
| Replacement plus three seconds of deferred work |  74.768 / 80.666 ms |        57.041 / 58.351 ms |

Five trials per version. All ten replaced exactly 2,048 occurrences, saved durably and restored the exact original source through undo. The actual public replacement call received 2,048 ranges. Source length after replacement was 1,040,384 characters.

## What caused the deferred stall

A separate CPU profile of the original implementation attributed the longest task to an IndexedDB transaction completion resuming its Effect fiber. The continuation parsed, validated and applied the same large operation across three replicas. `applyChanges` validated every replica, then `apply` prepared each replica again. Schema parsing, insertion ownership checks and visibility validation dominated; this was not an IndexedDB cache `put` callback or a layout-only problem.

`Replica.applyTogether` prepares each distinct replica once, then commits only after every replica validates. Prepared edit caches survive rejected preparation. Public contracts cover conflict in the last replica without partial publication, duplicate instances, privately owned operation facts, concurrent text/frontmatter edits, replay, causal undo and copy-on-write removal histories. Opus 5.5 found no blocking issue; raised cache-failure and shared-history concerns were reviewed against the existing guards and public tests.

Any later experiment that slices pure preparation must keep publication synchronous and atomic. Generation checks must reject concurrent mutations and interruption must leave every replica unchanged. The remaining 30 ms native input task needs its own profile; this change does not solve it.

## The synchronous input cost

A separate V8 attribution pass after the batch change found a 39 ms instrumented input task. `DocumentSession.replace` accounted for 25.5 ms of inclusive samples: preparing the precise edit, decoding `DocumentActionSchema`, then applying the optimistic replica synchronously. `Replica.apply` accounted for 15.2 ms within that path. Editor projection/render accounted for 8.4 ms, with 5.3 ms sampled in `TextIndex.summary`, which allocates `Array.from(text)` to count code points. These nested inclusive figures must not be added.

The worst deferred task in that profile still resumed from IndexedDB completion into Effect and replica/schema preparation. Prepared visibility facts could avoid another repeated validation pass; pure cooperative preparation remains a subsequent experiment. The synchronous optimistic edit path requires separate work. Profile samples and mapped source locations: `editor-input-attribution.json`. Profile overhead means its 39/65 ms task durations are attribution evidence, not replacements for the matched timings above.

## Allocation-free code-point counting

A narrow TextIndex change (`4a14e3c`) replaces repeated `Array.from(text).length` allocations with UTF-16 length minus valid surrogate pairs. ASCII takes a native regex fast path; paired and lone surrogates retain exact code-point and UTF-16 offset semantics. Public TextIndex/replacement/causal integration contracts passed, including surrogate pairs across leaf boundaries and a 1 MiB replacement. Opus reviewed the change; its boundary and regex-mode concerns were addressed.

Matched five-trial A/B against the batch-only version used the same restored histories and fixture. The whole trusted replacement task improved from **31.8 → 27.4 ms median**, **35.0 → 31.7 ms maximum**. The largest task across the three-second aftermath remained **57.5 → 59.1 ms median** (65.8 → 60.9 ms maximum). All ten trials replaced exactly 2,048 ranges, saved durably and undid to the exact original source. This improves input without meeting the 8.33 ms budget or reducing the deferred validation bottleneck. Samples and exact build hashes: `editor-codepoint-results.json`.

## Prepared visibility facts

A second narrow change (`155bc33`) retains privately owned, prevalidated removal/cancellation facts for synchronous Replica publication. Previously the same visibility facts were parsed during validation and parsed again during commit. The public prepared commit rejects stale or repeated publication before mutation. Existing atomic batch, fork, concurrent metadata and causal undo contracts remain covered; new contracts cover input mutation, fork-after-prepare, double commit, intervening apply/restore and a raised migration floor. Opus found no blocker under the existing synchronous, privately owned Replica path. Introducing yields later would require preflight checks across all replicas before any publication.

A separate restored-history five-trial pair against the TextIndex version measured **26.6 → 25.6 ms median trusted input**, **31.0 → 29.4 ms maximum**. The largest task across the three-second aftermath improved **56.2 → 49.4 ms median**, **57.2 → 51.4 ms maximum**. All ten trials replaced exactly 2,048 ranges, saved durably and undid exactly. Both phases remain above the 8.33 ms budget. Each pair stands independently; their median improvements must not be added. Samples and exact build hashes: `editor-visibility-results.json`.

## Method and provenance

Before: `1bbe9dae675e72f73027559e65b23faae0b049ca`. Candidate: exactly that source plus the batch application change committed in `bd54e62`; unrelated cache warm-up and mobile changes were excluded. Both ran the same frozen baseline server. Browser entry SHA-256 and loaded script byte counts were verified; hashes are in the raw results.

Both phases used identical starting server snapshots and browser history at `http://localhost:58167/`. Disposable SQLite databases were consistently backed up using Bun's `VACUUM INTO`; blobs were copied. Backend data was restored before each phase. The default ephemeral Chrome profile disappeared on close, so both persistent profiles recovered identical quiet pre-close LevelDB copies. HTTP, code and service-worker caches were removed. Viewport: 1,280 × 800. The generated source has 2,048 equally spaced `TOKEN` occurrences, with plain filler and newlines.

The browser sent trusted Control+Shift+L and insertText events. Timelines contain no CPU profiler. The summarizer identifies the page's renderer from each performance marker, measures whole enclosing `RunTask` intervals and does not sum nested slices. Input and three-second background windows are reported separately. Frame callback spacing measures opportunities on an approximately 60 Hz headless browser; it cannot prove 120 Hz presentation. Five ordered trials are a small sample.

## Failed and pending cells

Initial 128 KiB / 512-range and 128 KiB / 2,048-range probes reached the 20-second required-selection deadline. A corrected readiness retry also failed; those cells are unmeasured, not app-crash claims. The harness now records source/native selection, selected text, focus and trusted key modifiers on failure. No further retry was performed in this A/B window.

The original select-all timing marker could begin on the Control modifier while the primary token was already selected. Those earlier selection timings are withdrawn. Matched results wait for the actual trusted L event. Earlier `inputTaskMs: 0` fields represented unavailable synthetic-input timing, not zero work.

Setup errors were a shell argument limit while injecting a literal 1 MiB source, and a doubled route slash. Both were corrected before valid timings. The scroll harness is prepared but has not run; no scroll-performance claim follows from these results.

## Reproduce

- Start a disposable production app server with isolated databases; seed via `editor-critical-setup.ts`.
- Clone browser and backend history before comparing builds. Keep every agent-browser command at `AGENT_BROWSER_DEFAULT_TIMEOUT=20000`, background only.
- Run `bun experiments/performance/editor-critical.ts CONFIG.json RESULTS.json`.
- Run `bun experiments/performance/editor-critical-trace.ts RESULTS.json SUMMARY.json`.
- `editor-scroll.ts` provides the separately labeled scroll experiment.

Sanitized samples: `editor-critical-results.json`. Large Chrome timelines remain in `/tmp/alkalye-critical-batch`; the earlier attribution profile remains in `/tmp/alkalye-critical-current`.

written with gpt-6 in codex
