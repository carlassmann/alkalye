# Local performance comparison

The report and every measured sample are in `public/docs/performance-comparison.html` and `public/docs/performance-comparison.json`.

The TypeScript runner repeats warm reload and input journeys. The published run also measured find, preview, document switching, peer sync and offline reconnect using the same browser probe. Those additional journeys were sequenced by temporary experiment scripts, not by `compare.ts`.

Use disposable accounts, browser profiles and database directories. Build both versions in production mode. Keep all benchmark processes under `work`; do not reuse the app's normal sync database.

## Original

Build the original checkout with its Jazz endpoint pointing at a separate local relay:

```sh
PUBLIC_JAZZ_SYNC_SERVER=ws://127.0.0.1:4210 bun run build
```

Configure `work` commands for these processes:

```sh
bunx jazz-run@0.20.18 sync --port 4210 --host 127.0.0.1 --db /tmp/alkalye-benchmark/jazz.sqlite
bun experiments/performance/serve-original.ts /path/to/original/.vercel/output/static 4310
```

The static server injects an inline timing probe so the original's cached app shell also has it offline. It preserves deep routes, directory indexes and gzip delivery. It does not proxy the Jazz connection.

## Rewrite

Build, copy the output to an isolated directory, and instrument the copy:

```sh
bun run build
cp -R dist /tmp/alkalye-benchmark/assets
bun experiments/performance/instrument-rewrite.ts /tmp/alkalye-benchmark/assets
```

Configure another `work` command:

```sh
bun experiments/performance/serve-rewrite.ts /tmp/alkalye-benchmark/assets /tmp/alkalye-benchmark/rewrite-data 4311
```

The native server handles HTTP and WebSockets directly. The copied HTML loads a same-origin external probe because the rewrite's CSP rejects inline scripts. Warm the service worker before going offline. If changing the probe during an experiment, use a fresh profile to avoid a cached earlier version.

## Fixtures and runner

Create a separate account in each app. Import the same generated Markdown files into both:

```sh
bun experiments/performance/fixture.ts 2 > /tmp/alkalye-benchmark/2.md
bun experiments/performance/fixture.ts 32 > /tmp/alkalye-benchmark/32.md
bun experiments/performance/fixture.ts 128 > /tmp/alkalye-benchmark/128.md
```

Use background `agent-browser` sessions. Restore a second browser process to each disposable account for peer tests. Keep recovery keys private and out of result files.

Record the sessions and imported document routes in a configuration file:

```json
[
	{
		"kind": "original",
		"session": "benchmark-original",
		"url": "http://127.0.0.1:4310",
		"docs": [
			{ "kb": 2, "title": "Benchmark 2 KB", "path": "/app/doc/IMPORTED_ID" }
		]
	},
	{
		"kind": "rewrite",
		"session": "benchmark-rewrite",
		"url": "http://127.0.0.1:4311",
		"docs": [
			{ "kb": 2, "title": "Benchmark 2 KB", "path": "/app/doc/IMPORTED_ID" }
		]
	}
]
```

Open the apps and wait for their service workers to control the pages before running:

```sh
bun experiments/performance/compare.ts /tmp/alkalye-benchmark/config.json /tmp/alkalye-benchmark/results.json
```

The runner collects nine reload samples and twelve append samples per document. Documents of 32 KiB and above also receive twelve edits near the beginning and twelve in the middle. Optional fixtures cover prose, fenced code and a long wrapped paragraph. Each browser command has a timeout. A failed document does not stop measurements of the remaining documents.

The probe excludes automation command overhead. It starts at a trusted input event, checks the required state, and finishes at an animation-frame paint opportunity. It does not measure pixel presentation or completed animations. Local save acknowledgements only pace iterations; their timings are not compared as durable disk commits. The probe also sums JavaScript animation-frame callbacks per frame. This excludes event handlers, layout, rasterization and compositing; it cannot prove an 8.3ms total frame budget or 120fps on a 60Hz headless browser.

For peer sync, start at the producer's trusted `beforeinput` event and finish two animation frames after the peer source contains a unique marker. Compare `performance.timeOrigin + performance.now()` on the same host. For offline runs, confirm the peer does not receive the edit, reload the producer offline, then start reconnect timing at its `online` event. Use visible menu actions for shortcuts that macOS browser automation cannot dispatch reliably.

These benchmarks are experiments, not CI thresholds. Repeat on a quiet host, randomize version order, and increase sample counts before treating small differences as regressions.

written with gpt-6 in codex

## Diagnose graph work

`session.ts` exercises the real DocumentSession and SQLite adapters through their public boundary. A static transport isolates local hydration and persistence from network latency. It verifies the complete source before and after a durable append and cached reopen.

```sh
bun experiments/performance/session.ts > /tmp/alkalye-benchmark/session.json
PROFILE_FREEZE=1 bun experiments/performance/session.ts > /tmp/alkalye-benchmark/freezing.json
```

Initial and cached open timings cover graph hydration; first source materialization is a separate phase. Prototype counters and optional freeze instrumentation run only in this disposable process. Results are exploratory single samples, not regression thresholds. The browser integration suite now exercises 200,000-character checkpoints and deletion, 128 KiB local-file merging and 512 Unicode cursors. The previous Chromium argument-limit crash is fixed. Bun module timings remain separate from browser timings.

The follow-up profiling samples and causal editor experiments are in `public/docs/performance-diagnosis.json`. The follow-up implementation and measured gains are recorded in `public/docs/performance-improvements.html` and its JSON companion. Discarded editor/CSS experiments remain temporary.

Before measuring a changed build, activate its service worker or clear only the disposable benchmark profile's worker and shell caches. Confirm the loaded app bundle matches the build; keep account data intact. Allow an edit to populate the compact derived cache before comparing steady-state reopening. Measure migration from the expanded cache separately.

The mixed-transport collaboration scenario in `tests/document-live-poll.test.ts` runs 24 real persisted sessions, eight rounds of append/top/middle/deletion, cursor updates, offline recovery and permission rejection. Its throughput includes all same-process client work, two synchronization barriers and assertions; it is not a server capacity benchmark.

Repeat in-app switching without reloading between selections:

```sh
bun experiments/performance/switch.ts /tmp/alkalye-benchmark/rewrite-config.json /tmp/alkalye-benchmark/switch-results.json
```

The rewrite-only configuration needs the 2, 32 and 128 KiB routes. Nine selections per large document include one initial cold selection and eight warm revisits.

## Post-cutover comparison, 7 October 2026

`public/docs/performance-rebench.html` and its JSON companion record the frozen `be48f8b` rewrite against main `a749728`, including every sample and unsuccessful harness attempt. The later email authentication and CLI changes are outside this comparison.

`compare.ts` now interleaves version batches by fixture size, discards one extra reload warmup and records descriptive percentiles. `journeys.ts` reproduces find, preview and document switching. `peer.ts` reproduces passive peer updates and reconnect; add `peerSession` to each configuration entry after connecting a second disposable browser account to the document. Its offline gate observes absence of the unique marker for 750 ms before restoring the network. This observation is a negative assertion, excluded from reconnect latency.

For synchronous input spans, capture `performance.now()` at document `beforeinput` in capture phase and finish at document `input` bubbling. This omits deferred work. The extra run records 24 single-character middle edits per version, separately from the runner's 12 chunk insertions. Programmatic scrolling advances the editor's scroll owner in `requestAnimationFrame` for 1.5 seconds and records frame intervals; the measured headless cadence was 60 Hz.

The multicursor stress starts from the 128 KiB fixture, selects every `responsiveness` occurrence, then times trusted insertion of `MULTIX` until all replacement counts are verified and a later frame occurs. Selection setup is outside timing. Main uses CodeMirror's public `EditorSelection.create` / `range` API because the initial macOS shortcut attempt selected incorrectly; the rewrite uses its select-all-occurrences shortcut. Restore the complete saved fixture between three repetitions. The counts and this setup difference are retained in the report.

The 1 MiB long-paragraph setup was aborted; it provides no valid load or input comparison. Do not substitute isolated renderer or module timings for a complete app journey.

## Bundle sizes

Measure the production asset directories with the same compression for both:

```sh
bun experiments/performance/bundles.ts MAIN_ASSETS REWRITE_ASSETS OUTPUT.json
```

The runner follows static JavaScript imports from the app HTML's scripts, hydration entries and module preloads. It follows CSS imports from the linked stylesheets. Dynamic imports stay out of the initial graph. The whiteboard group is its editor's static dependency closure minus the initial graph. The document worker is separate; the report includes it in the first-document code estimate.

Each file is gzip compressed separately at level 9 with Bun, then summed. Every group records its file list and exact raw and gzip bytes. Totals count emitted JavaScript and CSS once, including lazy features, syntax grammars and service workers. Exclude source maps, benchmark probes, HTML, inline scripts, fonts, images, WASM, documents and compression sidecars. These figures do not measure network traffic or service-worker precaching.

The published comparison uses main `a749728` and frozen rewrite `be48f8b`. It separately records current rewrite `700f9f4`, including email authentication. Main already loads React and tldraw CSS at startup; the rewrite loads React and tldraw CSS with the whiteboard. Chunk sharing and library versions also differ, so the whiteboard group is not pure tldraw package attribution.

## Performance overhaul follow-up

`seed-large.ts CONFIG.json OUTPUT.json` creates a disposable 1 MiB long-line document through each app's editor boundary and waits for the complete source and durable-save acknowledgement. Setup is excluded from load measurements. If automation times out, independently verify exact source equality and the save acknowledgement before using that document; a timeout alone does not establish an application failure.

`compare.ts` accepts `BENCHMARK_RELOAD_SAMPLES` and `BENCHMARK_INPUT_SAMPLES` (3–30). It separately records synchronous `beforeinput` to bubbling `input`, then the complete required state to a later paint opportunity. The synchronous span omits deferred work. A small animation callback does not establish a complete frame budget.

`peer.ts` accepts optional `transport: "poll"` on rewrite entries. The injected probe deliberately rejects WebSocket construction for that disposable profile and waits for the HTTP presence path. Resource samples record path, initiation, response and duration relative to the trusted edit or reconnect event; WebSocket samples record direction and time, never payloads. Default transport remains WebSocket. Confirm the fallback really became active before interpreting results.

Preserve the history and library composition when comparing hydration changes. Replacing the whole visible source does not reset retained CRDT atoms, event history or undo state. A new 1 MiB document can also change unrelated library work. Record canonical source hashes, checkpoint bytes, packed runs and expanded character atoms where those differences affect a result.

The follow-up report is `public/docs/performance-overhaul.html`, with raw samples in its JSON companion. Intermediate measurements retain their build and dataset labels; they are not interchangeable with the final build.

`continuous.ts CONFIG.json OUTPUT.json` observes 25 canonical edits scheduled at 40 ms intervals over three seconds, including the background persistence window. It records completed edits, synchronous edit spans, frame intervals and whether a durable-save acknowledgement appeared. These edits are synthetic, so this is a behavior/task observation rather than trusted input latency. Each version receives a separate Chrome timeline trace without the CPU-profiler category. Analyze all main-thread tasks, collection, layout and frame gaps; do not infer responsiveness from the synchronous edit span alone.

Final overhaul measurements and limitations are published at `public/docs/performance-overhaul.html`, with raw samples in the adjacent JSON. The final frozen editor source is `aa89506`; both servers use production assets. Reload and input setup remain outside the measured span. The three-second continuous probe accepts both quiet local-save labels and records explicit pending, busy and version fields. A local-save acknowledgement does not prove server convergence.
