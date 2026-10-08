# Production native input, 8 October 2026

Actual production builds and local sync servers: original `a749728a8f9a1cb984c980a5ea2daf984d60ae68`, rewrite `dc2af56a7c1e7b07510b8e922b99c06d33340cac`. The later Projector caret cache is outside this freeze. These results use the production app, not the experimental worker editor.

| Fixture / position             | Version  | Timed samples / complete journeys | Trusted input RunTask median / max | Largest subsequent task in 3 seconds, median / max |
| ------------------------------ | -------- | --------------------------------- | ---------------------------------- | -------------------------------------------------- |
| 128 KiB rich Markdown / middle | Original | 3 / 3                             | 4.123 / 4.147 ms                   | 15.534 / 15.907 ms                                 |
| 128 KiB rich Markdown / middle | Rewrite  | 3 / 3                             | 5.422 / 5.614 ms                   | 7.935 / 8.107 ms                                   |
| 1 MiB long paragraph / end     | Original | 1 / 0                             | 6.565 / 6.565 ms                   | 126.108 / 126.108 ms                               |
| 1 MiB long paragraph / end     | Rewrite  | 3 / 3                             | 7.213 / 7.293 ms                   | 17.228 / 31.120 ms                                 |

The rewrite remains slower inside the 128 KiB input task. Its deferred work is smaller in this finite sample. Its 1 MiB deferred tasks still exceed the 8.33 ms budget. Headless Chrome presents approximately 60 Hz frame opportunities; this experiment cannot prove physical 120 fps.

## Method

Each cell clones a closed disposable account profile, verifies the complete source hash, selects the requested caret through the public editor API, and sends one trusted `agent-browser press x`. Version order alternates between trials. DevTools event tracing includes the entire task enclosing trusted keydown / beforeinput and three seconds of subsequent main-thread tasks. No CPU sampling runs during measurements. Nested task durations are not added together.

Both apps use network-enabled accounts and their real local backends. An independent same-account browser verifies the changed source hash. Original cells also await the public `alkalye:document-saved` event before Undo and after Undo. A complete journey requires exact local Undo and an independent server-propagated original source hash. Rewrite cells additionally require zero pending actions and an idle save badge. These are accepted-source oracles; journal cursor positions were not instrumented.

Original profiles clear only Jazz account session keys before app boot on the app-free `/changelog` page. Otherwise, copying localStorage duplicates a Jazz writing session across browser profiles and can fork transaction sequences. The server-only seed oracle removes original IndexedDB, preserves authentication, clears these keys, and verifies every complete fixture. Original fixtures were finally created through its installed public Jazz model APIs, then synchronized to the actual server. Fixture histories advanced through setup corrections and preceding trials; they are not identical operation graphs between implementations.

`afterHandler` in raw observations is a microtask queued from the document capture listener. It can run before later native processing, so it is **not** an input-handler duration. EventTiming entries are retained when available; its minimum reporting threshold means missing entries do not imply zero input delay. Input-to-rAF values are frame opportunities, not paint completion.

## Gates and failures

The original 1 MiB cell passed trusted input, exact local source, independent changed-source acceptance, client save completion, exact local Undo, and client Undo save completion. Its peer had only 560,128 characters when the 20-second Undo acceptance deadline expired. Two dependent original trials were skipped; the timing above remains a valid input observation with an incomplete journey. An earlier comparable attempt eventually reached exact server Undo according to a separate SDK observer. No data loss or application crash is inferred from that acceptance deadline.

Earlier setup and harness failures are retained separately: navigation before debounced original saves, oversized CLI argument payloads, a malformed generator snippet, the wrong macOS Undo modifier, reused Jazz writing sessions, and observer names exceeding the Unix socket-path limit. These are excluded from the confirmatory rows. The first corrected four-cell attempt is retained in `first-corrected-results.json`, separately from the final core matrix. An original SDK observation timed out while the server was busy; all sources were exact after the disposable server restart. Process disappearance was observed later without an exit reason; it is not attributed to the application.

A later inspection of the retained sync-server log directly proves a separate original server failure: Node v24.14.0, PID 90885, exhausted its roughly 4 GiB JavaScript heap. The final major GC occurred 358.450 seconds after process startup; the fatal native stack includes `JsonStringifier::Stringify`. `original-sync-oom.log` retains this evidence. Exact wall-clock correlation with the earlier Undo peer deadline was not recorded, so this does not establish the cause of that deadline or identify the responsible document/action. It also does not establish the cause of the older process disappearance.

The final scope excludes fresh 2048-cursor, middle-of-1-MiB, paced typing, pointer, and load measurements. Prior experiments remain separate evidence.

## Reproduce

The `*.ts.txt` files are executable snapshots kept outside the application TypeScript build. Copy them to a disposable experiment directory and adjust its paths. Use `work` to manage independent original static/Jazz and rewrite production/Bun servers. Preserve the explicit `AGENT_BROWSER_DEFAULT_TIMEOUT=20000` setting supplied by the shared browser driver. Provide a privately generated disposable account credential file for SDK seeding; no credential values are included here.

Run the server-only seed oracle before `native-tasks.ts.txt`, then run `summarize.py` on the retained traces. Full trace files and copied browser profiles remain outside Git under `/tmp/alkalye-prod-current-oct8`; the sanitized task summaries, samples, gate outcomes, and emitted main asset hashes are retained here.
