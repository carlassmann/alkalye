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

The runner appends text to the fixtures. It collects nine reload samples and twelve input samples per document. Each browser command has a timeout. A failed document does not stop measurements of the remaining documents.

The probe excludes automation command overhead. It starts at a trusted input event, checks the required state, and finishes at an animation-frame paint opportunity. It does not measure pixel presentation or completed animations. Local save acknowledgements only pace iterations; their timings are not compared as durable disk commits.

For peer sync, start at the producer's trusted `beforeinput` event and finish two animation frames after the peer source contains a unique marker. Compare `performance.timeOrigin + performance.now()` on the same host. For offline runs, confirm the peer does not receive the edit, reload the producer offline, then start reconnect timing at its `online` event. Use visible menu actions for shortcuts that macOS browser automation cannot dispatch reliably.

These benchmarks are experiments, not CI thresholds. Repeat on a quiet host, randomize version order, and increase sample counts before treating small differences as regressions.

written with gpt-6 in codex
