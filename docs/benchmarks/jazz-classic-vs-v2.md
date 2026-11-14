# Jazz Classic vs stock v2

The typing target is not met. Large-note p95 is 83.55 ms versus
Classic's 34.05 ms, 2.45× slower. The 5,000-edit p95 is
87.96 versus 50.12 ms. Brotli first load remains 3.46 versus
2.96 MB. Stock v2 retains its startup and storage advantages.

| Metric, median / p95                    |            Classic |           Stock v2 |
| --------------------------------------- | -----------------: | -----------------: |
| ZIP import + resolve                    |    42.38 / 63.46 s |    19.22 / 20.88 s |
| First usable list                       |      7.44 / 7.59 s |      1.46 / 1.64 s |
| Warm list                               |      2.76 / 3.01 s |      0.72 / 0.77 s |
| First large document                    |    11.35 / 12.39 s |      1.24 / 1.31 s |
| Fresh-device exact dataset export       |    20.09 / 20.72 s |    12.07 / 12.43 s |
| Small-note sync                         | 292.99 / 325.33 ms | 201.82 / 223.66 ms |
| IndexedDB after import                  | 103.53 / 181.69 MB |     1.88 / 1.90 MB |
| First-load JS/Wasm, Brotli              |     2.96 / 2.96 MB |     3.46 / 3.46 MB |
| Small typing, dispatch → double-rAF     |   33.31 / 34.52 ms |   33.69 / 46.45 ms |
| Small long tasks / 200 edits            |        0.00 / 0.00 |        0.00 / 0.00 |
| Large typing, dispatch → double-rAF     |   33.31 / 34.05 ms |   34.05 / 83.55 ms |
| Large beforeinput → double-rAF          |   32.00 / 32.60 ms |   32.10 / 79.60 ms |
| Large Event Timing processing, censored |     0.30 / 3.30 ms |     0.20 / 3.50 ms |
| Large long tasks / 200 edits            |        1.00 / 1.00 |      47.00 / 54.00 |
| Large long-task total / 200 edits       |      0.37 / 0.75 s |      2.60 / 3.20 s |
| 5,000 edits: dispatch → double-rAF      |   33.42 / 50.12 ms |   34.03 / 87.96 ms |
| 5,000 edits: beforeinput → double-rAF   |   32.50 / 32.90 ms |   32.30 / 84.30 ms |
| 5,000 edits: long tasks                 |      51.00 / 51.00 |    986.00 / 986.00 |
| 5,000 edits: long-task total            |    44.14 / 44.14 s |    58.29 / 58.29 s |
| 5,000 edits: sent payload / edit        |  173.55 / 173.55 B |  222.66 / 222.66 B |
| 5,000 edits: main-page JS heap          | 468.48 / 468.48 MB |   93.47 / 93.47 MB |

Five successful 200-edit cases per size and implementation, 1,000 edits pooled
per size. Five medium-note cases per implementation are also retained in the summaries. Sync has
25 markers each. The 5,000-edit stress case has one case per implementation,
so its case-level count, total, payload and heap median/p95 are identical.
Every measured replay passes exact-content validation; both stress cases pass
exact text after online reload. MB means decimal megabytes.

One additional Classic small replay exceeded its 120-second outer deadline
before its first 50-edit progress message. The exact stage was not captured.
Its metrics are excluded from the final distributions and the failure is retained
in the diagnostic summary. A fresh replacement account completed.
The outer deadline then became 240 seconds, leaving the 120-second content
assertion deadline unchanged. No latency outlier was excluded.

Committed summaries: [Classic](../../bench/results/stock-classic.json),
[stock v2](../../bench/results/stock-v2.json),
[Classic stress](../../bench/results/stock-classic-5000.json),
[stock-v2 stress](../../bench/results/stock-v2-5000.json),
[stock CPU diagnostic](../../bench/results/stock-typing-cpu.json), and
[validation, assets and excluded attempt](../../bench/results/stock-diagnostics.json).
Raw samples, CPU profiles and exploratory runs remain ignored and uncommitted.

The current implementation uses stock `jazz-tools@2.0.0-alpha.61` and
`jazz-wasm@2.0.0-alpha.61`. The SDK auth patch is byte-for-byte identical to
`fe49b12`. `git diff fe49b12 -- patches vendor package.json` is empty.
There is no vendored runtime, replacement worker, Rust build, engine patch,
query-snapshot patch or splice-hint write path. The original Effect prepare
command remains unchanged from `fe49b12`.

The installed and built 8,812,317-byte Wasm has SHA-256
`793d17d49189ac682d527c4b119a19d0dd52c8276a6d70241f3de725e07c0aff`.
The Wasm glue, broker worker, SDK write/query modules and Wasm fingerprint also
match the published package archives. The diagnostic summary records their hashes.
Only existing Vite asset naming and compression configuration affect Jazz assets.
Each of the five stock runs records one Brotli Wasm wire transfer of about
2.518 MB including headers, followed by one zero-byte disk-cache read.
The combined app changes leave transfer within 1 KB of the stock pilot at
`264870f`. This does not isolate the PDF import change, and it does not close
the roughly 0.50 MB gap to Classic.

## App changes and limits

The app retains metadata-only library queries, an isolated editor subscription,
subscription splices, stale-echo handling, retained document strings, worker
statistics, shared local-write receipts, bounded saved notifications and the
benchmark's exact-content and persistence assertions. Every text write still
passes the complete original editor base as `editedFrom`. No positional-write
shortcut replaces Jazz's stale-base merge.

The stock SDK recreates unchanged query projections. Library, comment and
presence hooks now retain equivalent result arrays at the app boundary.
This lets React Compiler reuse dependent values and components without changing
Jazz subscription or reset semantics. Equality handles nested values, Dates,
byte arrays, removed fields and row order.

A visible typing burst coalesces for 100 ms after its first animation frame.
A 140 ms fallback covers the period before that frame. A delayed first frame
can extend buffering to about 240 ms; congestion can delay timers further.
Related edits keep the first complete editor base and latest replacement.
A different base stays a separate write. Hidden pages submit immediately;
pagehide and visibility changes synchronously submit queued writes.

Batching reduces full-scalar writes and local durability waits. Buffered text
is not durable before submission. Saved notifications still wait for the local
receipt. Sync measurements include the added buffering. Classic ships a
250 ms save debounce, so these are app timings rather than protocol-only latency.

Cursor changes update local position immediately but only send extra cursor
writes when another device row is present. Initial presence and the two-second
heartbeat remain, so a new viewer can discover the session. Text convergence
and editor selection behavior are unchanged. CodeMirror's native DOM selection
updates still run for every Arrow key.

PDF rendering code now loads on a print action. Time-machine helpers import
their data functions directly rather than loading screen barrels. These are
small dependency changes; the transfer row measures their actual first-load
effect. Whiteboard, media and syntax-highlighter loading already had lazy paths.
No claim of reaching Classic's transfer size follows from code splitting alone.

The removed engine experiment is documented as an
[upstream proposal](../jazz-v2-issues/large-text-materialization.md). Its numbers
and the historical `final-v2*.json` summaries describe `94fc4ed`, not this
stock-Jazz implementation.

## Attribution

The remaining large-note work includes full-string lowering, materialization,
hashing and subscription serialization on the page. Stock Jazz maintains an
optimistic page database plus a durable worker database. App batching reduces
how often writes enter that path; it cannot remove the page replica or make the
public splice subscription deliver only a delta.

A separate 200-edit stock diagnostic measured 11.64 ms of page JS/browser APIs
and 10.83 ms of page Wasm per large-note trace edit. SHA-256 accounts for
3.93 ms/edit, materialization 1.71, UTF-8 validation 0.98 and JS encoding
0.90. The durable worker adds 1.69 ms JS and 6.15 ms Wasm in parallel.
The small-note page uses 8.41 ms JS/browser APIs and 1.76 ms Wasm.
These leaf samples cover replay, verification and settling, not just input
handlers. They are excluded from the latency distributions. Full-scalar native
work remains measurable after app batching; these short profiles do not measure
the 5,000-edit cursor-heavy workload.

The historical 5,000-edit profile at `94fc4ed` attributed 23.60 ms/trace edit
to page replication, 100.03 to durable-worker replication and 7.52 to parked page
transaction waits. `Selection.collapse` consumed 69.54 ms/trace edit across
26,401 Arrow movements. Those are sampled whole-replay averages from the removed
engine experiment. They identify follow-up areas, not current stock-Jazz CPU
measurements or proof of a waiter leak. The new unprofiled results determine
the remaining latency and long-task gaps.

The app still needs one local durability wait per committed transaction.
Stock alpha.61 exposes no public cancellation for individual write waits.
Skipping those waits would remove local-save error reporting and saved-event
guarantees. Worker-only execution, native materialization caching and
version-guarded splice writes need upstream work.

## Method and reproduction

Measured on 2026-11-14, Europe/Berlin. Classic app source is `8379d4e`,
`jazz-tools` 0.20.18 and `jazz-run` 0.20.19 with a 32 GB V8 heap limit.
Only its Node adapter and external serving infrastructure differ from that
source. Stock-v2 app source is `afdb0a6`, based on `94fc4ed`; later commits
change documentation and summaries only.

Five fresh accounts per implementation run in alternating Classic/v2 order,
with backend restart before each account. All three sizes use the same 200 edits;
the requested small/large cases each pool 1,000 edits. Sync has 25 markers per
implementation. Both first-load measurements use fresh contexts, HTTP caching
enabled, SW blocked, Brotli quality 6, matching cache headers and MIME types.
No Classic timing is reused because host load differs from the earlier campaign.

The 5,000-edit large-note stress case runs once per implementation after the
five pairs, unprofiled. It includes 26,401 Arrow movements. Input latency excludes
cursor positioning; whole-window long tasks and elapsed time include it.
Both stress cases drain pending writes, wait for global acceptance and verify
the complete final text after an online reload. Verification traffic is excluded
from replay payload metrics.

Client is AMD RYZEN AI MAX+ 395, 32 logical CPUs, Linux 7.2.8-9-omarchy,
Chromium 145.0.7632.6, CPU throttle 1×, Node 24.22.1, Bun 1.4.4.
One-minute host load ranged 2.21–33.09.
Other machine workloads are uncontrolled; every run retains beginning/end load
averages. No app rebuilds, checks or profiles overlap the final timing cases.
Neither local backend represents Jazz Cloud or a deployed CDN.

Datasets remain 50 pinned Vite Markdown notes, Alice 170,590 bytes and
Dracula 874,540 bytes, 52 files totaling 1,595,667 bytes. Checksums, source URLs
and licenses are in `bench/datasets/sources.json`. The Automerge editing trace
has 259,778 edits. Literal newlines use plain-text paste; printable characters
use keyboard input. Both implementations disable pairing and completion.

Account creation, import/export, credentials-only restore and editing use the
public UI. Each replay verifies the original and final full text. Export checks
every file. Dispatch-to-double-rAF includes keyboard dispatch and two frames,
with a roughly 33 ms floor at 60 Hz. Event Timing samples are censored at 16 ms
and include cursor movements; they are not every-keystroke percentiles.
Presentation is an estimate derived from rounded durations.

Heap is main-page JS without forced GC and excludes Wasm and workers.
IndexedDB is Chromium's usage estimate. Payload includes HTTP and WebSocket
bodies; received WS bytes exclude HTTP-stream downloads. Zero WS downloads
therefore do not imply zero received traffic.

Returning/SW benchmark timings were not rerun in this campaign and are omitted
from the final table. The full production e2e suite covers offline guest restore,
online/offline concurrent Unicode writers, reconnect and exact reload convergence.

Servers use Work projects initialized with `work setup --tailscale`.
Production serving uses `scripts/bench/serve-production.ts`,
`ALKALYE_LOCAL_PREVIEW=1` and `BENCH_BUILD_ROOT` pointing at an immutable
production build. Classic adds `BENCH_HISTORY_FALLBACK=1`.

```sh
# Alternate Classic and v2, restarting the respective backend before each run.
bun run bench:compare --target "$CLASSIC_URL" --label classic --runs 1 --edits 200 --literal-newlines --skip-sw --out bench/results/raw/stock-classic-1.json
bun run bench:compare --target "$V2_URL" --label v2 --runs 1 --edits 200 --literal-newlines --skip-sw --out bench/results/raw/stock-v2-1.json
# Repeat with fresh accounts for runs 2 through 5; pool the raw samples.

bun run bench:compare --target "$CLASSIC_URL" --label classic --runs 1 --edits 5000 --literal-newlines --large-only --performance-only --skip-sw --replay-timeout-ms 3000000 --out bench/results/raw/stock-classic-5000.json
bun run bench:compare --target "$V2_URL" --label v2 --runs 1 --edits 5000 --literal-newlines --large-only --performance-only --skip-sw --replay-timeout-ms 3000000 --out bench/results/raw/stock-v2-5000.json
bun scripts/bench/summarize.ts stock-classic stock-v2 stock-classic-5000 stock-v2-5000
```

Measured URLs:

- https://classic-main-alkalye-stock.cshed.carlassmann.com
- https://web-main-alkalye-stock.cshed.carlassmann.com

Validation: `VITEST_MAX_WORKERS=1 bun run check` passes all 862 tests in 84
files, lint, types and formatting. Limiting workers avoids test timeouts under
host contention. The final production build passes `bun run test:e2e --workers=2`,
all 17 tests. This includes simultaneous writers, rapid same-position writers,
large offline Unicode text and exact reload checks.

written with gpt-6.1-sol in T3 Code (Codex)
