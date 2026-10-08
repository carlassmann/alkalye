# First rich document open: marked diagnostic

One sampled current-production small2→rich128 library switch. Frozen8937a0b (production1b630c8 core), instrumentation only, real background agent-browser and cloned disposable backend/profile. Exact initial and target native source hashes and independent HTTP accepted receipts passed. No new import or writes. Strict types passed; first build failed outside Git initialization, then disposable Git initialization and build passed. Server and browser stopped.

Library acquisition626.1ms contains session-layer610.3ms. Passive state missed; initial journal was empty, then an opened snapshot receipt appeared. No cache restore phase ran. Materialization22.9ms and two fork spans10.3/9.1ms followed. Previous flush0ms; synchronous mount16.5ms includes editor14.9ms; old scope close9ms. Presentation opportunity664.36ms; largest full-window task21.258ms. Sampling/marks perturb runtime: these are attribution data, not a new unsampled baseline or performance improvement.

Mapped CPU profile: parseCheckpointSteps checkpoint.ts404 has71.891ms self/87.055ms inclusive; ownership claim callback43710.647ms self; restoreStateSteps24.844ms self/73.639ms inclusive; indexAtom37.973ms self/44.305ms inclusive. These overlap and must not be added. The old description of parseCheckpointSteps as expandAtomsSteps was corrected. Mount also samples previousGrapheme6.233ms; currentDocument span0ms in this cell.

HTTP snapshot/persist/restoreSnapshot are not individually marked. Library latency cannot all be attributed to parsing. No evidence yet that foreground loading waits BackgroundWork idle admission. Current browser layer already uses cooperativeWork and MessageChannel scheduler. Branch/page marks can include background work on the previous document; only library-contained spans belong to this acquisition. No warm-cache, offline, permissions, FPS or full worker cutover claim.

Full trace retained outside repository; digest in hashes.json. Full phases/branch marks, mapped samples, task summary and exact receipt hashes retained. Private profile, cookies, API key/oracle configuration omitted.

Command: bun experiments/performance/interaction-matrix/runner.ts /tmp/alkalye-first-open-diagnostic/manifest.private.json from the frozen outside runtime. Work-managed server; stable background browser timeout20000. Independent CLI/API-key oracle verifies accepted text. Instrumentation.patch.txt is the exact source-only change against8937a0b.

written with gpt-6 in codex
