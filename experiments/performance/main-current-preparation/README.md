# Main/current comparison preparation

Source-only, unrun adapters. No new benchmark numbers or strict-type proof. Main is frozen `a749728a8f9a1cb984c980a5ea2daf984d60ae68`; proposed rewrite source is `72dd6f5edf6c8927b4c927d4c5c932d3940d6303` (verify checkout and build before freezing). Later documentation commits do not imply a different application build.

First bounded run: three alternating trials of 2 KiB middle input/Undo and rich 128 KiB start/middle/end. Reuse `interaction-matrix/runner.ts.txt`, its accepted-source contracts and trace summarizer. Search/next/close, both switch directions, scroll, multicursor, polling and offline cells remain defined in that matrix; run them only after the initial adapters pass. A setup deadline yields no performance sample; uncertain writes block dependent trials.

The main seeder uses the verified installed `UserAccount`, public `createPersonalDocument` and original Jazz worker APIs. It preloads the account document list, records pending creation before calling, privately records the assigned ID before waiting for durable sync, and never retries an uncertain creation. Seed only the required fixtures. Previously assigned IDs must resolve to the exact requested source. Do not mutate Welcome. Keep the existing account browser connected during seeding: the successful 2 KiB proof required normal account publication. Close it before measurements.

The main oracle is a fresh in-memory SDK process for every acceptance check, loading from the actual pinned local sync server. It subscribes to the loaded document until the exact expected digest arrives. It is separate from the writer browser and avoids a second browser heap. Its own deadline and failure are retained. Before any timings, independently accept every seed; matching local editor content alone is insufficient.

Every cloned main browser profile must clear only its SDK numeric session keys on the app-free static route BEFORE app boot, retaining authentication. The existing runner does this. Each trial checks complete source, writable native editor and actual loaded asset digests before tracing. Record native-platform Undo (`Meta+z` on macOS), client saved-content completion, independent edited receipt, restored source and independent Undo receipt separately. Full enclosing tasks and three-second aftermath include microtasks; two-rAF opportunities are not display latency. No 120 Hz claim from the headless environment.

The bundle adapter separately reports static bootstrap closure and optional same-origin ready-document ResourceTiming JavaScript/CSS/font paths; observing a resource does not prove every module executed or establish actual transferred/compressed bytes. It counts actual HTML/static dependency closure and finds the whiteboard entry through reachable static/dynamic imports. Whiteboard static dependencies exclude initial code. It reports raw, independently gzip-compressed and Brotli-compressed file sums with SHA-256 per included file. Unreachable old output files are excluded. Additional whiteboard bytes subtract resources already observed for the ready document; bootstrap-relative lazy sizes remain separate. CSS/fonts remain separate. PWA precache traffic is unmeasured and is not initial payload. This is emitted membership, not proof of browser transfer or cache behavior; actual loaded resources need their separate checks.

Promote copies of these archives outside the repository for types/runtime checks; preserve original checkout read-only. Private configuration supplies credentials, known document IDs, profile paths, source files, frozen asset roots and oracle commands. None belong in this archive. Use the existing standalone `work` config pattern with isolated DBs and an exclusive timing lease.

Initial replay commands after private manifests are prepared and a CPU lease is granted:

```sh
bun seed-main.js private-main.json private-manifest.json
bun main-oracle.js private-main.json < private-seed-request.json
BENCHMARK_CELLS=small-middle,rich-start,rich-middle,rich-end bun runner.ts private-manifest.json
python3 summarize.py PRIVATE_OUTPUT
bun bundles.ts MAIN_STATIC CURRENT_DIST PRIVATE_BUNDLE_RESULT.json PRIVATE_READY_RESOURCE_CAPTURE.json
```

These commands are preparation, not a claim they ran. Public SDK creation/readback was separately proven in `main-sdk-created` (`ea60199`). Backend history advances through accepted edit/Undo pairs unless the managed reset layer explicitly restores a snapshot; cloned profiles alone do not establish identical histories.

written with gpt-6 in codex
