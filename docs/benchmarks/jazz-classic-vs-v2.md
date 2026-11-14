# Jazz Classic vs v2

Production measurements on 2026-11-14 (Europe/Berlin). The typing target is **not met**: large-note p95 is 40.98 ms versus Classic's 33.78 ms (7.21 ms slower). Small-note typing is 33.30 / 34.86 ms versus 33.31 / 34.30 ms. Large-note medians are 33.39 versus 33.32 ms. The 200-edit long-task counts are near Classic. The 5,000-edit case is 41.57 / 82.90 ms versus Classic's 33.37 / 50.02 ms, with 1077 versus 37 long tasks. Completed typing replays and collaboration checks pass; returning/offline failures are counted below.

| Metric, median / p95                                        |                  Classic |                       v2 |
| ----------------------------------------------------------- | -----------------------: | -----------------------: |
| ZIP import + resolve                                        |          40.93 / 41.38 s |          17.76 / 18.59 s |
| First usable list                                           |            6.15 / 6.31 s |            1.60 / 1.72 s |
| Warm list, SW blocked                                       |            2.52 / 2.71 s |            0.64 / 0.69 s |
| First large document                                        |          11.22 / 11.38 s |            1.27 / 1.38 s |
| Fresh-device exact dataset export                           |          19.50 / 19.62 s |          11.74 / 11.82 s |
| Returning SW list                                           |            3.53 / 3.81 s |            0.70 / 0.87 s |
| Offline SW large document                                   |                        — |            0.54 / 0.59 s |
| Small-note sync                                             |       288.06 / 306.90 ms |         59.81 / 94.10 ms |
| IndexedDB after import                                      |       142.30 / 181.34 MB |           1.93 / 2.00 MB |
| First-load JS/Wasm, Brotli                                  |           2.96 / 2.96 MB |           3.46 / 3.46 MB |
| Small: Dispatch → double-rAF                                |         33.31 / 34.30 ms |         33.30 / 34.86 ms |
| Small: Beforeinput → double-rAF                             |         30.60 / 32.00 ms |         31.20 / 32.70 ms |
| Small: Event duration, censored                             |         16.00 / 24.00 ms |         16.00 / 24.00 ms |
| Small: Event input delay, censored                          |           0.20 / 1.00 ms |           0.10 / 0.80 ms |
| Small: Event processing, censored                           |           0.30 / 4.30 ms |           0.20 / 3.60 ms |
| Small: Event presentation estimate, censored                |         15.30 / 18.80 ms |         15.60 / 20.70 ms |
| Small: Long tasks / case                                    |              0.00 / 0.00 |              0.00 / 0.00 |
| Small: Long-task total / case                               |           0.00 / 0.00 ms |           0.00 / 0.00 ms |
| Small: Sent payload / edit                                  |        183.06 / 183.06 B |        245.53 / 245.91 B |
| Small: Received WS payload / edit                           |            8.78 / 8.78 B |            0.00 / 0.00 B |
| Small: Main-page JS heap                                    |         52.86 / 52.90 MB |         55.51 / 66.14 MB |
| Alice: Dispatch → double-rAF                                |         33.31 / 33.99 ms |         33.33 / 35.17 ms |
| Alice: Beforeinput → double-rAF                             |         31.70 / 32.70 ms |         32.20 / 33.80 ms |
| Alice: Event duration, censored                             |         16.00 / 16.00 ms |         16.00 / 16.00 ms |
| Alice: Event input delay, censored                          |           0.10 / 0.50 ms |           0.10 / 0.60 ms |
| Alice: Event processing, censored                           |           0.30 / 3.60 ms |           0.20 / 3.20 ms |
| Alice: Event presentation estimate, censored                |         15.50 / 16.00 ms |         15.60 / 16.00 ms |
| Alice: Long tasks / case                                    |              1.00 / 1.00 |              0.00 / 0.00 |
| Alice: Long-task total / case                               |       116.00 / 120.00 ms |           0.00 / 0.00 ms |
| Alice: Sent payload / edit                                  |        181.34 / 181.34 B |    2,022.57 / 2,022.78 B |
| Alice: Received WS payload / edit                           |            6.21 / 6.21 B |            0.00 / 0.00 B |
| Alice: Main-page JS heap                                    |       140.99 / 143.89 MB |         58.50 / 64.73 MB |
| Dracula: Dispatch → double-rAF                              |         33.32 / 33.78 ms |         33.39 / 40.98 ms |
| Dracula: Beforeinput → double-rAF                           |         31.90 / 32.80 ms |         32.00 / 36.20 ms |
| Dracula: Event duration, censored                           |         16.00 / 16.00 ms |         16.00 / 16.00 ms |
| Dracula: Event input delay, censored                        |           0.10 / 0.50 ms |           0.10 / 2.50 ms |
| Dracula: Event processing, censored                         |           0.30 / 3.30 ms |           0.30 / 3.90 ms |
| Dracula: Event presentation estimate, censored              |         15.60 / 16.00 ms |         15.50 / 16.00 ms |
| Dracula: Long tasks / case                                  |              1.00 / 1.00 |              0.00 / 0.00 |
| Dracula: Long-task total / case                             |       312.00 / 331.00 ms |           0.00 / 0.00 ms |
| Dracula: Sent payload / edit                                |        181.34 / 181.34 B |        953.26 / 954.40 B |
| Dracula: Received WS payload / edit                         |            6.55 / 6.55 B |            0.00 / 0.00 B |
| Dracula: Main-page JS heap                                  |       473.22 / 490.60 MB |        82.51 / 108.28 MB |
| Dracula, 5,000 edits: Dispatch → double-rAF                 |         33.37 / 50.02 ms |         41.57 / 82.90 ms |
| Dracula, 5,000 edits: Beforeinput → double-rAF              |         32.30 / 32.80 ms |         31.60 / 51.30 ms |
| Dracula, 5,000 edits: Event duration, censored              |         24.00 / 32.00 ms |         24.00 / 40.00 ms |
| Dracula, 5,000 edits: Event input delay, censored           |           0.10 / 1.10 ms |           0.20 / 3.70 ms |
| Dracula, 5,000 edits: Event processing, censored            |          0.20 / 15.20 ms |          0.90 / 30.90 ms |
| Dracula, 5,000 edits: Event presentation estimate, censored |         16.00 / 31.90 ms |         14.90 / 30.60 ms |
| Dracula, 5,000 edits: Long tasks / case                     |            37.00 / 37.00 |      1,077.00 / 1,077.00 |
| Dracula, 5,000 edits: Long-task total / case                | 37,426.00 / 37,426.00 ms | 61,748.00 / 61,748.00 ms |
| Dracula, 5,000 edits: Sent payload / edit                   |        171.50 / 171.50 B |  12,630.31 / 12,630.31 B |
| Dracula, 5,000 edits: Received WS payload / edit            |          10.66 / 10.66 B |            0.00 / 0.00 B |
| Dracula, 5,000 edits: Main-page JS heap                     |       436.83 / 436.83 MB |         70.35 / 70.35 MB |
| Stress setup: ZIP import + resolve                          |          40.93 / 40.93 s |          17.79 / 17.79 s |
| Stress setup: First usable list                             |            5.17 / 5.17 s |            1.69 / 1.69 s |
| Stress setup: Warm list                                     |            2.48 / 2.48 s |            0.73 / 0.73 s |
| Stress setup: First large document                          |          11.23 / 11.23 s |            1.19 / 1.19 s |
| Stress setup: IndexedDB                                     |       160.87 / 160.87 MB |           2.04 / 2.04 MB |
| Stress setup: First-load JS/Wasm, Brotli                    |           2.96 / 2.96 MB |           3.46 / 3.46 MB |
| Returning SW list-ready cases                               |                      5/5 |                      5/5 |
| Offline SW exact-text cases                                 |                      0/5 |                      5/5 |
| Stress exact reload verified                                |                      1/1 |                      1/1 |
| Core/SW scenario failures                                   |                        5 |                        0 |
| Stress scenario failures                                    |                        0 |                        0 |

Recorded failures: Classic: returningServiceWorker: offlineOpen (5). All five Classic failures occurred during exact offline-text verification after list readiness; no offline timing is assigned to them.

All timings are median / p95; MB means decimal megabytes. Startup/resource
metrics have five samples each, sync has 25 markers, and each typing size pools
1,000 trace edits across five independent cases. Long-task counts/totals and
payload/heap metrics summarize whole cases. The 5,000-edit stress case has one
case per implementation; its count/total therefore has identical median/p95.
Service-worker timings are conditional on verified successes; failures retain
their error and elapsed time rather than a fabricated timing.

The committed summaries are [Classic](../../bench/results/final-classic.json),
[v2](../../bench/results/final-v2.json),
[Classic stress](../../bench/results/final-classic-5000.json),
[v2 stress](../../bench/results/final-v2-5000.json), and
[CPU attribution](../../bench/results/final-typing-cpu.json).
Raw samples, profiles and intermediate trials remain ignored and uncommitted.
Stress verification drains pending writes, waits for global acceptance and
checks exact text after an online reload. Verification traffic is excluded from
the replay payload metrics.

## Per-edit CPU attribution

Paired fresh production profiles compare `fe49b12` with `5f0f339` on the same
200-edit trace. Each cell below is sampled CPU milliseconds per trace edit,
**JS / Wasm**. These are exclusive leaf samples, categorized by call ancestry.
Subscription work nested inside a write/tick is charged to subscriptions first.

| Thread/phase, JS / Wasm ms per edit |  Small before |  Small after |  Large before |   Large after |
| ----------------------------------- | ------------: | -----------: | ------------: | ------------: |
| Page: write/stage/commit            |   0.59 / 3.89 |  0.46 / 1.40 |  4.50 / 15.39 |   0.99 / 3.05 |
| Page: query/subscription            |   0.70 / 1.84 |  0.48 / 1.68 |  2.34 / 21.02 |   2.41 / 3.02 |
| Page: replication/tick              |   0.07 / 3.81 |  0.04 / 2.64 |   0.06 / 3.86 |   0.05 / 2.51 |
| Page: React render/effects          |  20.55 / 0.02 |  1.43 / 0.01 |  23.87 / 0.03 |   1.55 / 0.01 |
| Page: other app/CodeMirror/SDK      |   4.25 / 0.00 |  4.09 / 0.00 |   5.44 / 0.00 |   5.78 / 0.00 |
| Page: other engine runtime          |   0.00 / 0.57 |  0.00 / 0.45 |   0.00 / 1.67 |   0.00 / 1.85 |
| Page: total JS/Wasm                 | 26.17 / 10.13 |  6.50 / 6.18 | 36.22 / 41.97 | 10.78 / 10.43 |
| SharedWorker: total JS/Wasm         |  3.74 / 21.23 | 3.60 / 16.83 |  4.00 / 34.17 |  3.48 / 16.44 |
| Statistics worker: total JS/Wasm    |   0.01 / 0.00 |  0.00 / 0.00 |   0.06 / 0.00 |   0.06 / 0.00 |

Profiles cover the active typing page and its workers. Setup clients and the
backend are outside this CPU attribution. The full CPU summary also accounts
for GC, browser/native `(program)` samples,
idle time and the separate statistics worker. Profiles include cursor movement,
final verification and three seconds of settling. They are workload-normalized
CPU estimates, not instrumented timers around individual keystrokes. Worker
work runs in parallel; these columns cannot be summed into dispatch latency.
The unprofiled comparison table determines whether the typing target is met.
The JS bucket includes JS-invoked browser builtins and unsymbolized V8 frames,
0.47 ms/edit for unsymbolized frames in the final large
case. Their source and finer phase are unknown; they are included in other JS.

Small notes were spending about 20.6 ms/edit in React render/effect stacks,
versus 1.4 ms after the change. Native row invalidations recreated unchanged
query projections, which drove library/editor renders and cursor work. The
editor already changed synchronously; an awaited worker response was not
required to display its text.

Large notes previously spent 14.0 ms/edit in SHA-256 compression and 6.4 ms/edit
in `materialize_attempt` on the main page. The patched cache removes repeated
authentication/materialization of the same immutable text and applies new tail
edits to a validated prefix. Remaining large-note self samples include JS string decoding 1.56 ms/edit,
exact JavaScript string comparison 0.75 ms, native subscription serialization
1.05 ms, native comparison 0.87 ms and UTF-8 validation 0.77 ms.
CodeMirror string extraction costs 0.59 ms, its update listener 0.53 ms,
binding echo handling 0.62 ms and wikilink matching 0.52 ms.
SHA-256 remains at 0.61 ms/edit, including range authentication and periodic
canonical rebuilds. Full-scalar transfers and record work still consume page CPU.
GC falls from 2.41 to 0.31 ms/edit for small notes and 2.90 to 0.79 for large.
Browser/native `(program)` samples remain 6.25/6.38 ms/edit after the change;
these samples do not identify a finer browser phase. Idle time remains
31.88/24.88 ms/edit, including settling. The CPU JSON retains all categories.

The separate 5,000-edit profile averages 82.20 ms JS +
40.03 ms Wasm per trace edit on the page. Writes account for
4.41 ms, subscriptions 4.32, replication
23.60, React 1.74, other app/SDK JS
76.73 and other engine runtime 11.43.
GC adds 1.28 ms and unattributed browser/native program samples
12.77 ms; idle time is 10.85 ms per edit.
The durable worker averages 1.43 ms JS + 102.01 ms Wasm.
Of the page's other JS/API samples, 69.54 ms/edit is the browser's
`Selection.collapse`, called through CodeMirror's `updateSelection` during the
many individual arrow-key moves. It is browser builtin work invoked by JS.
Parked native transaction-wait futures account for 7.52 ms/edit on the page.
Worker self samples include 18.72 ms/edit allocating/freeing memory and
14.58 ms validating records/values within replication. These sampled costs
identify remaining work; they do not establish a particular waiter leak or a
text-versus-presence split. The JSON includes the complete phase breakdown and
largest self samples.
These averages cover the full trace, cursor movement, the final full-text read and settling;
reload/durability verification runs after CPU capture. These costs
are independent of the unprofiled stress latency result.

## Changes and merge safety

The engine caches one validated scalar, capped at 64 MiB, by its complete
immutable descriptor. A matching base with an append-only edit tail reuses the
validated bytes and computes UTF-16 metrics from edited fragments. Different
roots, kinds, formats, hashes or divergent tails use authenticated full
materialization. Descriptor and Unicode boundary tests cover invalid reuse.
Whole-text replacements rebuild through the existing whole-write path once
128 edits accumulate. This bounds growing descriptor encoding/validation work;
append and positional writes retain their existing policy. Readers still accept
the original 4,095-edit format limit. The canonical rebuild stores the final
tree instead of every intermediate edit's tree.

The SDK retains the previous snapshot when a native row invalidation leaves
its selected projection unchanged; subscription resets still notify.

CodeMirror receives content directly from the Jazz subscription. The React
snapshot and document metadata settle after 300 ms; cursor presence is limited
to ten updates per second and excludes this device's echo. The binding retains
its current flat string and ignores acknowledged local echoes. The router's
startup sync-status subscription unmounts once routing is ready. Saved notifications
retain only the latest body per document; older durability waits keep tokens
instead of full text. Committed writes and their error observers still run.

Editor writes run after a paint, with a 40 ms deadline and a flush on page hide
or visibility loss. Writes are ordered per document. Acknowledged text is discarded even while other writes remain pending. Unknown
incoming snapshots wait for outstanding writes, preserving local characters.
The paint scheduler flushes complete native transactions synchronously on page
hide; an integration test checks ordering before Promise continuations. Local
rendering remains immediate. Consecutive changes waiting for the same paint share
one write only when each original exactly equals the previous replacement.
The first original is retained for stale-base merging; different bases keep
separate writes. Local durability observers share one receipt per handle.

For large, bounded edits, CodeMirror supplies a UTF-16 replacement hint alongside
both full strings. The Wasm bridge validates that applying it to `edited_from`
reconstructs the exact replacement, including Unicode boundaries, before
avoiding the second full JS-to-Rust string conversion. Invalid hints use the
original decoder. Both paths construct the original `TextEdit`, including the
original base; the core still performs its usual stale-base merge. An exact-value
conversion cache reuses the previous Rust base, capped at 64 MiB. The core can
compare validated current bytes with that base before repeating UTF-8 validation. Stored and
sync encodings and the native server binary are unchanged.

`applyDiffs` was read through SDK lowering, `lower_large_mutations` and Jazz's
text-splice integration tests. Positions apply to the local store's current
row, including staged writes; the resulting value then enters normal history
and Markdown merge handling. This does not bind positions to an editor's older
snapshot. The adapter has no atomic public version guard, so it keeps
`editedFrom` rather than treating a subscription sequence as that guard.

Validation on the final candidate: `bun run check` passes all 860 tests plus
lint, types and formatting. All 17 E2E tests pass, including rapid same-position writers, simultaneous online
writers and a new large Unicode test that disconnects both clients, types at
zero delay at opposite ends, checks isolated values, reconnects, checks exact
merged values and reloads both. A unit test covers stale-base large writes;
binding tests cover delayed asynchronous snapshots, multi-range hints, IME,
selection mapping and undo. Jazz's own 16 text-splice integration tests, 132 large-value tests, 80 DB
tests, 237 type tests, Wasm tests and 59 subscription tests pass.

## Trials and remaining limit

Metadata batching alone did not remove the regression. Stable query snapshots
and direct content subscriptions removed most React work. Splitting staging
from commit lost characters, including in an ordered retest, and was rejected.
The final scheduler defers the whole write and flushes stage/commit synchronously
when the page hides. Raw positional writes remain unused without a base guard.

Longer stress runs exposed growing tail descriptors and retained text in saved
notification waits. The 128-edit whole-write bound passes Jazz's wire/storage
budgets; a 64-edit trial did not. A heap snapshot traced full bodies through
local durability waits to notification closures. Keeping only the latest body
per document reduced the separate 1,000-edit probe from 495/331 MB before/after
GC to 68/47 MB; exact reload passed after the fix. Older receipt closures now
keep small tokens. These diagnostics are summarized in the CPU JSON.

CodeMirror's ChangeSet supplies hint offsets directly; an earlier whole-string
prefix/suffix search was discarded. The final artifact uses Jazz's release
optimization pipeline; measurements of an earlier unoptimized diagnostic build
are excluded. Two wider batch-window trials also missed the target: a delay
after the frame and a frame-aligned delay measured 46.0/50.1 ms large-note p95
in separate 200-edit probes, versus 39.6 ms with the retained scheduler. Neither
trial is included in the final comparison.

The final large-note p95 gap is 7.21 ms. Classic's per-run large-note
p95 spans 33.62–33.96 ms (0.33 ms); v2 spans 39.19–42.25 ms. The gap exceeds
that observed variation. The current full-string query/write boundary and the page's
optimistic replica remain active on the main thread. They are not waiting for
worker acknowledgement before rendering, but their synchronous conversion,
serialization and replication tasks can still delay later frames. The worker
owns a durable store while the page owns an in-memory replica by design; the
second core is not an accidental extra application initialization. A worker-only execution path and true delta subscriptions were not implemented. The committed cache
and bridge are engine changes, and the remaining CPU is quantified above.

## Fairness and reproduction

Classic app source is `8379d4e`, `jazz-tools` 0.20.18, with `jazz-run` 0.20.19 and
a 32 GB heap limit. Only its build adapter and external serving infrastructure
change. v2 app/runtime source is `5f0f339`, alpha.61 plus the committed source,
Bun and browser-runtime patches. Harness source is `5f0f339`. Later reporting commits do not change the app.
Both use Node production builds, local backends and tailnet HTTPS. Neither
measurement represents Jazz Cloud.

Both implementations use `scripts/bench/serve-production.ts`, Brotli quality 6,
the same cache headers and MIME types. Classic's SPA fallback is enabled with
`BENCH_HISTORY_FALLBACK=1`. First visits use fresh browser contexts with HTTP
caching enabled and service workers blocked, permitting page/worker asset reuse.
The first-load row measures encoded JS/Wasm bytes on that visit, including
worker requests. This replaces the previous unmatched compression comparison.
The provisioner now configures this server for Classic too.

Client: AMD RYZEN AI MAX+ 395, 32 logical CPUs, Linux 7.2.8-9-omarchy,
Chromium 145.0.7632.6, CPU throttle 1×, Node 24.22.1, Bun 1.4.4. The final
campaign interleaves five Classic and five v2 core cases, then five returning/offline
cases for each. Each account starts after a backend process restart; all cases run
sequentially. No builds, checks, profiles or other benchmark campaigns overlap
the timing cases. A separate stress profile runs after both unprofiled stress
cases. Other machine workloads remain uncontrolled; beginning/end load averages
are retained in the summaries. A partial v2-only campaign was discarded after
host load changed, so the final comparison uses fresh interleaved references.

Datasets: 50 pinned Vite Markdown notes, Alice 170,590 bytes and Dracula 874,540
bytes; 52 files, 1,595,667 bytes. Sources, checksums and licenses are in
[the dataset manifest](../../bench/datasets/sources.json). Account creation,
ZIP import/export, credentials-only fresh-device restore and editing use the
public UI. Each replay verifies exact original and final full text; whole-library
export verifies every file. The same 200/5,000 edits from the Automerge trace are
used for both versions. `--literal-newlines` pastes control newlines as plain
text; printable characters remain keyboard input. Pairing/completion is disabled.

Dispatch → double-rAF includes CDP keyboard dispatch and two animation frames,
with a roughly 33 ms floor at 60 Hz. Beforeinput → double-rAF begins inside the
page. Event Timing rows are censored slow-event samples (threshold 16 ms), also
including cursor movement; they are not all-keystroke percentiles. Presentation
is an estimate from rounded duration. Sent payload includes HTTP and WebSocket
bodies through settling/verification; received WebSocket payload omits HTTP
streams. Main-page JS heap excludes workers and Wasm linear memory. IndexedDB
uses Chromium's storage estimate.

Offline cases explicitly call Jazz's `disconnect()` before network emulation;
Chromium context-offline alone leaves the SharedWorker's existing link alive.
Classic's existing WebSockets are also explicitly closed. Returning/SW cases
use five separate accounts, prepare and export the entire library before going
offline, then verify full large-document text after reopening. The verified
export primes the full dataset before large-document navigation; this is a
prepared warm offline case, not a cold metadata-only open. The offline timer
starts after transport shutdown. Stress cases additionally drain committed
writes and verify the exact full text after an online reload. This replaces
previous offline timings that did not reliably disconnect the persistent link.

```sh
# Work projects must first be initialized with --tailscale.
bun scripts/bench/production.ts
BENCH_RESULT_PREFIX=final- BENCH_LITERAL_NEWLINES=1 bun scripts/bench/interleaved.ts

# Each stress case uses the corresponding production URL and a restarted backend.
bun run bench:compare --target "$CLASSIC_URL" --label classic --out bench/results/raw/final-classic-5000.json --runs 1 --edits 5000 --literal-newlines --large-only --performance-only --skip-sw
bun run bench:compare --target "$V2_URL" --label v2 --out bench/results/raw/final-v2-5000.json --runs 1 --edits 5000 --literal-newlines --large-only --performance-only --skip-sw
bun scripts/bench/summarize.ts final-classic final-v2 final-classic-5000 final-v2-5000

# Separate diagnostics; never overlap these with latency cases.
BENCH_PROFILE_DIR=bench/results/profiles/after bun run bench:compare --target "$V2_URL" --label v2 --out bench/results/raw/profile-after.json --runs 1 --edits 200 --literal-newlines --performance-only --skip-sw
```

The measured services are:

- Classic: https://classic-main-alkalye-typing.cshed.carlassmann.com
- v2: https://web-main-alkalye-typing.cshed.carlassmann.com

The five-run command used `BENCH_CLASSIC_TARGET` and `BENCH_V2_TARGET` for those
URLs, `BENCH_CLASSIC_WORK_ROOT=/tmp/alkalye-bench-production`,
`BENCH_CLASSIC_COMMAND=sync`, `BENCH_V2_WORK_ROOT=/tmp/alkalye-typing-preview`,
`BENCH_V2_COMMAND=web` and the Brotli server note retained in the summaries.

The generated Wasm/glue, matching worker and ABI fingerprint are pinned in
[vendor](../../vendor/README.md). `bun install` verifies and installs that archive
by rename, preserving Bun's shared package cache. CI/Vercel use the same bytes
without a Rust toolchain. The clean-source rebuild was exercised with Rust
1.93.1, wasm32 and wasm-bindgen 0.2.117, with upstream release optimization
settings and pinned Binaryen 132.0.0. The manifest records source commit,
engine-patch fingerprint and archive checksum.

written with gpt-6.1-sol in T3 Code (Codex)
