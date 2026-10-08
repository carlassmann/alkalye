# Actual EditorElement worker bridge — unshipped

Twelve actual native-editor correctness checks passed again after geometry repair. Nine corrected absolute timing cells passed. No causal speedup or visual-parity claim: the first fixture had invalid geometry. Production source remains unchanged.

The prototype uses the existing EditorElement, SourceTextarea, overlay, formatting and native textarea. Pending changes keep the canonical optimistic draft; the scoped FIFO worker queue owns Replica, replacements, durability and merge candidates. Main-thread options contain no Atom[] data. Applied production behavior remains unchanged in the patch.

## Proven boundary

`journey.log` records trusted append, successive queued edits, selected bold formatting, multicursor editing, refusing remote adoption while multicursors are active, worker-resolved caret adoption after a peer prefix, exact worker Flush/Read source, no reported authority failures and scope disposal. Twelve checks. The editor used different layout from the production shell; these establish behavioral boundaries, not visual parity.

OS IME, clipboard, phone accessibility, undo, comments/presence/search identity facades and permission recovery remain unverified or gated. This is not a production cutover.

## Invalid timing preserved

Three128KiB and three1MiB ordinary trials reached exact source and pending0. Their timing numbers are unusable as performance evidence: `alkalye-editor{height:800px}` lost specificity to `[data-editor].editor-wrap{height:100%}` inside an auto-height document. The1MiB host expanded to663985px and the native textarea contained the entire document. Rendering cost measured this broken fixture.

The first1MiB attempt returned a full string from agent-browser eval, exceeding the driver's output buffer. Returning true repaired that harness error. The2048-cursor first edit produced exact source and pending0; its timing gate failed because multicursor editing prevents the native input event, so an observer attached there never scheduled RAF. Both failures remain in logs.

The corrected source files use an800px matching selector and assert host height, overflow, bounded native fragment and editability before profiling. Trusted beforeinput schedules microtask/twoRAF observations; native input duration is null when that event is prevented. Corrected files passed types, build, the twelve native gates and all nine timing cells.

`durableMs` includes browser-driver waits and Flush/Read round trips: an observed completion upper bound. Flush/Read prove local worker journal source; accepted HTTP snapshot was not checked. Main JS heap samples exclude worker heap and process RSS, both unavailable. No claim about total memory or server durability.

## Reproduce outside the workspace

Copy the repository to a real disposable directory; never symlink mutable src/tests/public/build directories. Apply `prototype.patch` there, copying the handoff worker files to its root first. Copy the `.ts.txt` fixtures to root `.ts` filenames. `server.ts` bundles browser-fixture.ts and worker.ts; the server-only seed creates real accounts/documents through native endpoints. Run `bun server.ts`, then `bun journey.ts URL` and `bun timing.ts URL?size=131072 OUTPUT`. Other timing cells use size1048576, optionally cursors2048. Use background agent-browser with stable default timeout20000.

Original traces remain under `/tmp/alkalye-worker-editor/`; compact invalid observations and exact source/bundle SHA256 hashes are retained here. `production-head.txt` identifies the workspace revision when preservation occurred; prototype source hashes, not that HEAD alone, identify the actual bundle.

written with gpt-6 in codex

## Corrected absolute input evidence

Three successive history-advancing edits per fresh logical fixture:128KiB ordinary,1MiB ordinary and1MiB2048cursors. Each verifies exact native/queue source, pending0, local Flush/Read and no failures through three seconds of aftermath. Every profiler starts after an800px host/overflow/writable/bounded-native-fragment gate. Native fragments stayed about2–2.6Kcharacters. Timeline tracing has no CPU sampling; script/bundle hashes are in corrected-hashes.txt.

Complete enclosing main-thread RunTask durations, including microtasks: ordinary128KiB1.739/1.026/1.010ms; ordinary1MiB2.049/1.528/1.376ms;2048cursors7.204/5.901/5.094ms. The largest main task through aftermath was the same enclosing task except128KiBtrial2 deferred1.341ms. This is an absolute prototype result, not a matched production speedup or actual120Hz display proof.

Worker tasks remained large:128KiB29–40ms,1MiB204–240ms,2048cursors210–238ms. Observed driver-inclusive local Flush completion was77–92ms,81–196ms and302–507ms respectively. Pending0 throughout each measured aftermath establishes no retained queue backlog after those isolated edits; it does not establish sustained typing throughput. Worker and editor still retain duplicate basis/source state. Sampled main heap was8–11MB,21–29MB and27–44MB; worker heap/processRSS remain unavailable, so total-memory/startup regression is unproven.

The beforeinput microtask callback can execute before default native editing; its timestamp is not a complete input duration. Multicursor prevents the native input event, so listener inputMs is null. The authoritative blocking figure is the enclosing RunTask in corrected-summary.json. TwoRAF measures an opportunity, not presentation. Parsing uses the trusted-start mark's process/thread, enclosing RunTask, subsequent tasks, native Layout/Paint totals and dedicated-worker task maxima through aftermath. Raw traces remain in the disposable directory; corrected compact raw observations are committed.

OS IME, clipboard, actual mobile/accessibility, undo/atom features, startup, sustained backlog and accepted server checkpoint are still outside this proof. No production cutover.
