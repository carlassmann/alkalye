# Document sidebar experiment

Baseline commit: `9e825483d818842b558959871347c86d6b003609`.

The production experiment moves the library sidebar outside the document-keyed editor in personal and space routes. Personal account subscription moves into the persistent parent. Document-specific state, controls, editor history, comments, permissions, assets and save handling retain their keyed lifetime. Space sidebars reset when the space changes. Personal/space route transitions retain separate screens.

## Reproduce

Use Bun 1.4.0 and agent-browser 0.26.0 with headless Chrome 153. Build both revisions with `bun run build`, copying each `.vercel/output/static` directory somewhere separate before rebuilding. Write the selected build directory to `/tmp/sidebar-root`. Start `bun scripts/sidebar-benchmark/serve.mjs` through a temporary `work` project with a `web` command pointing to this script. It listens on port 4391.

Create a disposable profile and import the fixtures:

```sh
bun scripts/sidebar-benchmark/fixtures.mjs
agent-browser --session sidebar2 --profile /tmp/sidebar-browser-profile2 --headed false open http://localhost:4391/app
agent-browser --session sidebar2 upload 'input[type=file][accept*=".comments.json"]' /tmp/sidebar-small.zip
bun scripts/sidebar-benchmark/measure.mjs baseline 1 12
bun scripts/sidebar-benchmark/measure.mjs baseline 4 12
bun scripts/sidebar-benchmark/verify-fixtures.mjs
```

Repeat against the other static build using the same profile. The measurement script unregisters workers, bypasses them during navigation measurements, and compares the loaded app asset with the currently served HTML. Initial attempted changed runs served stale worker content and were discarded.

For the populated library, import `/tmp/sidebar-library.zip` through the same file input. This adds 200 documents to the four target documents and the default welcome document. Run both CPU settings against both builds with 10 switches per document size. `verify-fixtures.mjs` checks complete CodeMirror document content against the fixture strings after undoing all markers.

```sh
bun scripts/sidebar-benchmark/measure.mjs baseline-library 1 10
bun scripts/sidebar-benchmark/measure.mjs baseline-library 4 10
bun scripts/sidebar-benchmark/startup.mjs baseline-library 4 3
```

The startup script measures cold HTTP cache, cached HTTP cache and service-worker-controlled startup separately. It retains IndexedDB in every mode. Cold HTTP cache is not a new anonymous account or empty local database.

## Measurement definitions

Navigation starts immediately before activating the destination document link. Readiness requires its URL and its expected heading in the editor. The visible-editor endpoint additionally requires nonzero bounds and a hit test inside the editor, including any splash overlay. The typing endpoint requires focusing the editor, inserting a marker through agent-browser's native input command and observing the marker in the editor. Each run undoes the marker and waits for its removal. The first switch for each size is a warm-up and is excluded from reported navigation summaries.

The paint column means the first animation frame with the correct, unobstructed editor. It is not a compositor screenshot timestamp. Typing times include CLI round trips and automation scheduling, so they are upper bounds on human interaction readiness. No endpoint uses `__alkalyeReady`.

Environment: Apple M5 Pro, macOS 26.6.2, headless Chrome 153.0.8010.54, 1280 × 633 viewport, localhost HTTP, no network throttling. CDP only configures CPU/cache conditions and startup instrumentation; agent-browser performs browser interaction. CPU settings are 1× and 4×. The host also ran other tasks, so CPU contention was not controlled. A repeat baseline and raw samples expose that variability.

Targets contain exactly 1,029 and 264,039 characters after import. Additional library documents contain about 3.4 KB each. All documents and browser accounts are disposable. The measurements do not represent remote sync latency or authenticated collaboration workloads.

After the navigation runs, `runtime.mjs` checks rapid-save navigation, undo isolation and retained search. `offline.mjs` checks service-worker-controlled offline reload and editing. These operate on the disposable target documents. The runtime script can also run within a space containing the same imported target fixtures.

The native driver did not reliably center-click tall editors, so the scripts explicitly focus the editor before native text insertion. Native contenteditable fill appended rather than replaced CodeMirror content; restoration therefore selects all and inserts the original text. Always pass absolute file paths to agent-browser uploads.

Browser commands and CDP requests time out after 20 seconds. Measurement scripts restore CPU throttling and service-worker bypass on exit; startup also removes its injected observer. Runtime checks restore the edited fixture in cleanup. Navigation summaries exclude the first run per document size, including the console output.

See `RESULTS.md` for measurements and validation. Raw samples are in `results/`.

written with gpt-6 in Codex
