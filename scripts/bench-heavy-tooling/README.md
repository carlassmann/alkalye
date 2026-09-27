# Deferred tooling benchmark

This directory measures optional tooling without changing route splitting, navigation layout or splash behavior. Baseline: `9e82548`.

Run on a disposable browser profile. No accounts or personal documents are needed. All browser interaction uses headless `agent-browser`; the CDP helper attaches to that browser only for instrumentation, CPU throttling, cache control and evaluating probes.

## Reproduce

1. Keep this benchmark directory in the candidate checkout. In a separate baseline checkout, run `bun install`, then `bun run build` at the baseline revision. Copy `dist/client` to `/tmp/alkalye-heavy/baseline`.
2. Add a temporary `heavy` command to the project's source `work.config.js`: `{ run: "bun scripts/bench-heavy-tooling/serve.mjs", portless: false }`. Start it with `work run heavy`. The default port is 4317. `HEAVY_BUILD` chooses the build directory; baseline is the default. The server uses gzip and immutable caching for hashed assets.
3. Start `agent-browser --session heavy-tooling --headed false open http://localhost:4317/app`, then `bun scripts/bench-heavy-tooling/seed.mjs`. This imports 100 synthetic documents, about 4 KiB each, beside the welcome document, and creates a one-second AVC/AAC test video using FFmpeg. Record the returned document URL.
4. Run `bun scripts/bench-heavy-tooling/measure.mjs baseline '<document URL>'`. Then run `switch.mjs baseline`, `features.mjs baseline` `video.mjs baseline` and `import.mjs baseline` from the same directory prefix.
5. Build the candidate and copy `dist/client` to `/tmp/alkalye-heavy/changed`. Unregister this origin's service workers and delete its Cache Storage, keeping IndexedDB. Open `about:blank`, then `HEAVY_BUILD=/tmp/alkalye-heavy/changed work restart heavy`. Open the recorded URL and let the new worker install.
6. Repeat step 4 with `changed`. Do not run builds or tests while collecting timings. Copy `/tmp/alkalye-heavy/{baseline,changed}*.json` into `evidence/`, then run `bun scripts/bench-heavy-tooling/summary.mjs`.
7. Stop the server with `work stop heavy`, close the disposable browser and remove the temporary work command.

The scripts use macOS keyboard shortcuts and port 4317. A new measurement profile needs a new document ID. Do not run `seed.mjs` twice in one profile.

## Endpoints and conditions

Startup records the requested document's visible editor content, then hit-tests a point inside it against `elementFromPoint`, including splash obstruction. It focuses the editor, inserts a unique marker with browser keyboard input and verifies the resulting content. Undo restores the fixture before the next run. Switching requires the destination fixture's content, then repeats the edit check. It starts at document-link activation, not a URL change. Neither endpoint uses `__alkalyeReady`.

Seven production runs per cache mode and CPU setting; median and nearest-rank p95 (with seven samples, p95 is the maximum). The same anonymous IndexedDB library and browser session serve both builds. Cold HTTP runs clear Chromium's HTTP cache and bypass the service worker; cached HTTP runs reuse the cache and bypass the worker; service-worker runs use the installed worker. IndexedDB remains warm in every mode. This does not measure a brand-new account's onboarding.

Machine: Apple M5 Pro, 64 GiB RAM, macOS arm64. Viewport: 1280 × 633, DPR 1. Browser: headless Chrome 153.0.0.0, agent-browser 0.26.0. CPU: native and CDP 4× slowdown. Network: gzip over unthrottled localhost. Other tasks used the same host; host contention was not controlled. Treat timing differences as observations, especially the noisy 4× results. These are not mobile-network measurements.

“Interactive” is the verified typed-edit endpoint. It includes CLI round trips for click, focus, cursor movement and text input. The separate “uncovered” endpoint shows when hit testing first permits interaction. First-use feature runs reload between samples, keeping HTTP cache warm and bypassing the worker: highlighting ends at colored code containing the expected token; ZIP export ends at archive Blob creation; video conversion ends when the converted asset appears in the sidebar. Feature timings include the operation itself. ZIP export includes loading all 101 documents. Video assets are deleted between runs. ZIP import uses one small document, measures file selection to its sidebar entry, then opens it to verify content and moves it to trash. Those import-only runs occur after the startup measurements; they retain Jazz tombstones. Exported fixture names and contents have identical SHA-256 hashes across builds.

## Results

Run `runtime.mjs` for offline editing and blocked-highlighter recovery. Run `features.mjs offline --offline`, `video.mjs offline --offline` and `import.mjs offline --offline` for one offline first-use check each, after the candidate worker is installed.

See `RESULTS.md` for measured values and runtime checks. Raw observations are in `evidence/`.

written with GPT-6 in Codex
