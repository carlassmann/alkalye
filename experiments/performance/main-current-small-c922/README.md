# Main/current: paired 2 KiB smoke

Both actual production cells passed once: original main `a749728a8f9a1cb984c980a5ea2daf984d60ae68` and rewrite `c922a8d61d2730e0b9b6179b36b36ba85cd5e578`. This validates the comparison adapters; n1 is not a stable median or the broader performance matrix.

| Input + three-second window |      Main |  Rewrite |
| --------------------------- | --------: | -------: |
| Enclosing initial task      |  5.330 ms | 3.199 ms |
| Largest later task          |  6.924 ms | 2.524 ms |
| Ready frame opportunity     | 18.475 ms | 4.551 ms |
| Layout interval union       |  0.769 ms | 1.478 ms |
| Paint interval union        |  0.586 ms | 0.601 ms |
| GC interval union           |      0 ms | 0.810 ms |

Both began at exactly 2,048 UTF16 units, accepted trusted middle `x` input at 2,049 units, completed the client save, independently read the edited source from the actual sync server, then performed native-platform Undo and independently read the restored source. Source SHA-256 restored to `2273364cd6f408d0ed16b26d0508aa43c39894cf3dc347b86eb996afbe87a4f2`. Original uses a fresh in-memory Jazz SDK oracle; rewrite uses authenticated public API reads in a separate process. The original browser clone clears SDK numeric session keys before app boot. Rewrite operation actors use a fresh cryptographic nonce.

The full three-second trace starts on trusted input and includes its enclosing task, microtasks and deferred work. Undo is an exact acceptance gate AFTER that trace; Undo latency was not measured. Ready means the first observed frame opportunity containing the expected source, not display latency. Headless cadence is 60 Hz; these cells prove no physical 120 Hz result. EventTiming is retained where emitted; missing entries are not zero delay.

| Emitted JavaScript gzip, independently per file |        Main |   Rewrite |
| ----------------------------------------------- | ----------: | --------: |
| Static bootstrap closure                        | 1,280,350 B | 351,064 B |
| Ready-document resource set                     | 1,300,394 B | 409,948 B |
| Whiteboard additional to document               |   514,054 B | 592,192 B |

`bundles.json` also records raw/Brotli, CSS/fonts and file hashes. Bootstrap is static HTML/module closure. Ready-document resources are observed same-origin paths, including dynamic route chunks and workers; observation is not proof every module executed or actual compressed transfer. Whiteboard uses the reachable lazy entry's static closure minus already present bootstrap/document resources. Main's tldraw CSS is already among initial CSS; rewrite's additional CSS is 98,395 raw B / 19,289 gzip B. Both observed 59,768 raw B of fonts. Unreachable retained files and PWA precache traffic are excluded. Whiteboard JavaScript remains larger in this rewrite.

The unchanged SDK-created main fixture was reused; rewrite used a fresh public UI fixture with the identical source. Library composition and histories are not identical across systems. This was main then rewrite, one trial; larger runs must alternate order. Independent seed/edit/Undo receipts are in `results.json`, with only receipt digests, sizes and revision positions retained. Credentials, known document IDs/configuration, browser profiles, data stores and source content are excluded. Raw trace URLs may contain disposable route identities; no private oracle configuration is included.

Strict types and build exited zero on the frozen outside source copy, including promoted adapters. The initial exec failed because its requested cwd did not yet exist; no process or fixture action ran. Creating the runtime directory corrected setup. Actual writer markers prevented duplicate creation. Own rewrite4491, original4220/static4490 servers and all browser contexts were stopped before packaging. Compression ran after the timed cells.

Archived runners are exact outside tested sources, not production code changes. `metadata.json` pins every expected loaded JavaScript digest; `bundles.json` pins included emitted files. The smoke inventories observed 10 main and 34 rewrite JavaScript resources, including module-preload initiators. Main dependency/type build limitations from older work are unchanged; this smoke did not rebuild or modify original source.

written with gpt-6 in codex
