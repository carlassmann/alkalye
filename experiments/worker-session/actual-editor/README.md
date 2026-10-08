# Actual EditorElement worker bridge — unshipped

Twelve actual native-editor correctness checks passed. No performance or visual-parity claim: the first timing fixture had invalid geometry. Production source remains unchanged.

The prototype uses the existing EditorElement, SourceTextarea, overlay, formatting and native textarea. Pending changes keep the canonical optimistic draft; the scoped FIFO worker queue owns Replica, replacements, durability and merge candidates. Main-thread options contain no Atom[] data. Applied production behavior remains unchanged in the patch.

## Proven boundary

`journey.log` records trusted append, successive queued edits, selected bold formatting, multicursor editing, refusing remote adoption while multicursors are active, worker-resolved caret adoption after a peer prefix, exact worker Flush/Read source, no reported authority failures and scope disposal. Twelve checks. The editor used different layout from the production shell; these establish behavioral boundaries, not visual parity.

OS IME, clipboard, phone accessibility, undo, comments/presence/search identity facades and permission recovery remain unverified or gated. This is not a production cutover.

## Invalid timing preserved

Three128KiB and three1MiB ordinary trials reached exact source and pending0. Their timing numbers are unusable as performance evidence: `alkalye-editor{height:800px}` lost specificity to `[data-editor].editor-wrap{height:100%}` inside an auto-height document. The1MiB host expanded to663985px and the native textarea contained the entire document. Rendering cost measured this broken fixture.

The first1MiB attempt returned a full string from agent-browser eval, exceeding the driver's output buffer. Returning true repaired that harness error. The2048-cursor first edit produced exact source and pending0; its timing gate failed because multicursor editing prevents the native input event, so an observer attached there never scheduled RAF. Both failures remain in logs.

The corrected source files use an800px matching selector and assert host height, overflow, bounded native fragment and editability before profiling. Trusted beforeinput schedules microtask/twoRAF observations; native input duration is null when that event is prevented. Corrected files have not yet run.

`durableMs` includes browser-driver waits and Flush/Read round trips: an observed completion upper bound. Flush/Read prove local worker journal source; accepted HTTP snapshot was not checked. Main JS heap samples exclude worker heap and process RSS, both unavailable. No claim about total memory or server durability.

## Reproduce outside the workspace

Copy the repository to a real disposable directory; never symlink mutable src/tests/public/build directories. Apply `prototype.patch` there, copying the handoff worker files to its root first. Copy the `.ts.txt` fixtures to root `.ts` filenames. `server.ts` bundles browser-fixture.ts and worker.ts; the server-only seed creates real accounts/documents through native endpoints. Run `bun server.ts`, then `bun journey.ts URL` and `bun timing.ts URL?size=131072 OUTPUT`. Other timing cells use size1048576, optionally cursors2048. Use background agent-browser with stable default timeout20000.

Original traces remain under `/tmp/alkalye-worker-editor/`; compact invalid observations and exact source/bundle SHA256 hashes are retained here. `production-head.txt` identifies the workspace revision when preservation occurred; prototype source hashes, not that HEAD alone, identify the actual bundle.

written with gpt-6 in codex
