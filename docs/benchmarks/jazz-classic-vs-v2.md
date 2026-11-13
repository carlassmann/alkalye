# Jazz Classic vs v2

Production comparison on 2026-11-13. Five alternating runs per implementation,
200 trace edits in each of three document sizes. Raw results are
`bench/results/classic.json` and `v2.json`; the superseded development baseline is
`classic-dev.json`. Each production JSON embeds its individual runs.

## Method and environment

Classic app source is exactly `8379d4e`, jazz-tools 0.20.18. Only its build
configuration selects the Node standalone adapter instead of Vercel. An external
HTTP proxy supplies the production SPA history fallback. No Classic app source
was changed. Its sync backend is jazz-run 0.20.19 with a 32 GB V8 heap cap.
v2 uses this migration branch, jazz-tools 2.0.0-alpha.61, the Node standalone
adapter and an isolated local SQLite store. Neither result represents Jazz Cloud. v2 app source is `847b2a5` plus the
merged benchmark infrastructure; no app source was changed for these tests.

Both serve production builds over Work's local tailnet HTTPS proxy. Unlike the
old baseline, there is no Vite compilation, HMR, or development React runtime.
Backends restart before each measured account. The order is Classic 1, v2 1,
Classic 2, v2 2, through Classic 5, v2 5. Each run records beginning/end load
averages. Pilots, failed authentication attempts and their server OOMs are
excluded. Their transient setup was not representative of the final runs.

Client: AMD RYZEN AI MAX+ 395 w/ Radeon 8060S, 32 logical CPUs,
linux 7.2.8-9-omarchy,
Chromium 145.0.7632.6, CPU throttle 1×. Node 24.22.1 and Bun 1.4.4. Core-run one-minute load averages range
from 2.08 to 10.71 on 32 logical CPUs. No latency outlier was attributed to
external load, so all five pairs are retained.
Other workloads were present. No network shaping or forced garbage collection.

Datasets are unchanged: 50 pinned Vite Markdown notes, Alice in Wonderland
170,590 bytes and Dracula 874,540 bytes; 52 files total 1,595,667 bytes.
Fixtures normalize line endings to LF and add title headings/frontmatter.
The account retains a welcome note outside the 52-file assertions.
The Automerge LaTeX trace contains 259,778 edits. Checksums, source URLs and
licenses remain in `bench/datasets/sources.json`. Vite documentation is MIT;
books retain Gutenberg attribution; the editing trace is CC-BY-4.0.

Account creation, ZIP import/export, settings, editor copy/paste and edits use
public UI only. Fresh contexts receive only account authentication: Classic's
`jazz-logged-in-secret` with a non-anonymous provider, or v2's
`jazz-account-selection-v1:` record reduced to its selected root secret.
No document databases, cookies, session leases or other account caches are copied.
The v2 `browserSecretStore` utility's key is not the account manager's actual
persistence key in this application.

First-visit cases block service workers and disable HTTP cache. Warm reload
preserves IndexedDB and enables HTTP cache. Returning-user cases allow SW
installation, wait for an active controller, measure a usable list after reload,
then disable networking and reopen the large document. Returning SW cases use five separate, alternating accounts before trace replay.
Preparation opens the large document, retries an exact whole-library export,
verifies its full text through a fresh UI copy and settles for five seconds.
Offline text is also verified after its readiness timer. The overall returning
case has a 150-second deadline and the usable-list wait has a 30-second deadline. Core runs also retain exploratory post-replay SW failures in their
individual records; those SW attempts are excluded from the returning-user
summary. Original metrics are retained.

The five-run 200-edit cases use Arrow keys, keyboard typing and text insertion
for control characters. Their exact-content checks all pass. Extended replay uses
`--literal-newlines`: prepare the clipboard before timing, then plain-text paste
line breaks. An intermediate 5,000-edit run exposed extra contenteditable newlines;
a 1,000-edit literal-newline check passes. Printable characters remain keyboard
input in both modes. Both implementations use the same mode within each phase.
Typing preserves trace
coordinates before the original text. Each case verifies original content first
and exact trace output plus original content afterward. Export checks all 52
original files byte-for-byte after normalization. Sync polls the receiving
editor every 20 ms for five markers per run.

Double-rAF timings retain their roughly 33 ms floor. New Event Timing observations
record duration, input delay, processing and presentation estimates, with a
16 ms reporting threshold. They include keyboard cursor movement and are
**censored slow-event samples**, not percentiles of every keystroke. Presentation
is derived from rounded duration and is approximate.

Network capture includes pages, iframes, dedicated workers and SharedWorkers.
The exact-byte worker verification passes for HTTP, WebSocket and Wasm.
Sent bytes include HTTP bodies and WebSocket payloads throughout replay, settling
and final verification. Received WS bytes exclude HTTP-stream payloads, so v2
zero values do not mean zero downloads. These are payload counts, excluding TLS
and framing. Heap is main-page JS only; it excludes workers and Wasm linear memory.
Storage is Chromium's IndexedDB usage estimate.

## Results

Ratios below divide v2 by Classic; lower is faster/smaller. SW percentiles
are conditional on successful verified cases, with success counts shown. Failed
cases are never represented as exact timings, and their ratios are omitted. Nearest-rank
percentiles. Five run samples per startup/resource metric, 25 sync markers;
typing pools samples across the five successful cases of each size.
With only five runs, run-level p95 is the maximum. Main-thread event counts
differ because Event Timing reports only slow events; see raw sample counts.

| Metric                                   |         Classic median / p95 |              v2 median / p95 | v2/Classic median / p95 |
| ---------------------------------------- | ---------------------------: | ---------------------------: | ----------------------: |
| ZIP import + resolve                     |              41.45 / 44.38 s |              11.88 / 12.07 s |           0.29× / 0.27× |
| First visit, usable list                 |                6.19 / 7.05 s |                1.61 / 1.69 s |           0.26× / 0.24× |
| Warm list, SW blocked                    |                2.76 / 2.98 s |                0.63 / 0.75 s |           0.23× / 0.25× |
| First visit, large document              |              10.99 / 11.48 s |                1.25 / 1.38 s |           0.11× / 0.12× |
| Fresh device, exact whole-dataset export |              19.61 / 21.50 s |                9.12 / 9.36 s |           0.46× / 0.44× |
| Returning user, SW-controlled list       | 7.75 / 8.57 s (2/5 verified) | 1.00 / 1.03 s (5/5 verified) |       n/a; failed cases |
| Offline SW large-document open           | 5.40 / 5.44 s (3/5 verified) | 0.54 / 0.63 s (5/5 verified) |       n/a; failed cases |
| Edit visible on second client            |           279.71 / 330.35 ms |            79.47 / 135.09 ms |           0.28× / 0.41× |
| IndexedDB after import                   |           148.64 / 157.29 MB |               1.76 / 3.30 MB |         0.012× / 0.021× |
| First-load JS + Wasm transfer            |               5.78 / 5.78 MB |             20.84 / 20.84 MB |           3.60× / 3.60× |

| Metric                                         | Classic median / p95 |          v2 median / p95 | v2/Classic median / p95 |
| ---------------------------------------------- | -------------------: | -----------------------: | ----------------------: |
| small, Dispatch → double-rAF                   |     33.31 / 34.33 ms |         51.43 / 67.70 ms |           1.54× / 1.97× |
| small, beforeinput → double-rAF                |     31.00 / 32.00 ms |         32.10 / 41.30 ms |           1.04× / 1.29× |
| small, Event Timing duration, censored ≥16 ms  |     16.00 / 24.00 ms |         32.00 / 40.00 ms |           2.00× / 1.67× |
| small, Event Timing input delay                |       0.10 / 0.90 ms |           0.20 / 2.30 ms |           2.00× / 2.56× |
| small, Event Timing processing                 |       0.30 / 4.20 ms |          0.30 / 32.30 ms |           1.00× / 7.69× |
| small, Event Timing presentation estimate      |     15.40 / 19.70 ms |         14.10 / 39.70 ms |           0.92× / 2.02× |
| small, Long tasks                              |          0.00 / 0.00 |              1.00 / 6.00 |               n/a / n/a |
| small, Long-task total                         |       0.00 / 0.00 ms |        56.00 / 327.00 ms |               n/a / n/a |
| small, Sent payload/edit                       |    183.06 / 183.06 B |        414.99 / 417.31 B |           2.27× / 2.28× |
| small, Received WS payload/edit                |        8.78 / 8.78 B |            0.00 / 0.00 B |         0.000× / 0.000× |
| small, Main-page JS heap                       |     77.29 / 78.13 MB |        43.34 / 153.63 MB |           0.56× / 1.97× |
| medium, Dispatch → double-rAF                  |     33.34 / 34.55 ms |         66.69 / 96.35 ms |           2.00× / 2.79× |
| medium, beforeinput → double-rAF               |     32.10 / 32.80 ms |         36.40 / 64.00 ms |           1.13× / 1.95× |
| medium, Event Timing duration, censored ≥16 ms |     16.00 / 24.00 ms |         40.00 / 64.00 ms |           2.50× / 2.67× |
| medium, Event Timing input delay               |       0.10 / 0.60 ms |           0.20 / 2.00 ms |           2.00× / 3.33× |
| medium, Event Timing processing                |       0.30 / 3.40 ms |          0.30 / 43.00 ms |          1.00× / 12.65× |
| medium, Event Timing presentation estimate     |     15.60 / 18.00 ms |         14.40 / 48.00 ms |           0.92× / 2.67× |
| medium, Long tasks                             |          1.00 / 1.00 |             7.00 / 56.00 |          7.00× / 56.00× |
| medium, Long-task total                        |    88.00 / 113.00 ms |     452.00 / 4,152.00 ms |          5.14× / 36.74× |
| medium, Sent payload/edit                      |    181.34 / 181.34 B |        412.62 / 414.68 B |           2.28× / 2.29× |
| medium, Received WS payload/edit               |        6.21 / 6.29 B |            0.00 / 0.00 B |         0.000× / 0.000× |
| medium, Main-page JS heap                      |   125.18 / 142.54 MB |        84.63 / 161.05 MB |           0.68× / 1.13× |
| large, Dispatch → double-rAF                   |     33.33 / 34.23 ms |       117.74 / 148.46 ms |           3.53× / 4.34× |
| large, beforeinput → double-rAF                |     31.80 / 32.80 ms |        79.40 / 106.00 ms |           2.50× / 3.23× |
| large, Event Timing duration, censored ≥16 ms  |     16.00 / 16.00 ms |        80.00 / 104.00 ms |           5.00× / 6.50× |
| large, Event Timing input delay                |       0.10 / 0.50 ms |          0.20 / 13.80 ms |          2.00× / 27.60× |
| large, Event Timing processing                 |       0.30 / 3.50 ms |          0.30 / 88.20 ms |          1.00× / 25.20× |
| large, Event Timing presentation estimate      |     15.50 / 16.00 ms |         14.40 / 95.50 ms |           0.93× / 5.97× |
| large, Long tasks                              |          1.00 / 1.00 |          200.00 / 200.00 |       200.00× / 200.00× |
| large, Long-task total                         |   341.00 / 446.00 ms | 15,780.00 / 17,786.00 ms |         46.28× / 39.88× |
| large, Sent payload/edit                       |    181.31 / 181.34 B |        414.99 / 417.67 B |           2.29× / 2.30× |
| large, Received WS payload/edit                |        6.55 / 6.55 B |            0.00 / 0.00 B |         0.000× / 0.000× |
| large, Main-page JS heap                       |   473.29 / 492.55 MB |        52.98 / 150.77 MB |           0.11× / 0.31× |

## What this means

v2 reaches the first usable large editor 8.8× faster and completes a fresh-device,
exact whole-library export 2.15× faster. Its IndexedDB estimate is about 85×
smaller for these documents. The compact stored state is consistent with less
hydration/replay work; Classic's hydration profile processes many CoValue
transactions. This does not isolate storage encoding from encryption or UI costs. These are app-level outcomes, including routing,
hydration and export work; they are not isolated transport throughput.

Small-note sync is 280 ms median on Classic and 79 ms on v2. Classic's source
debounces saves by 250 ms; v2 writes each change immediately. That shipped
behavior explains much of the difference, so this is not a protocol-only win.

Large-document editing regresses: dispatch-to-double-rAF rises from 33/34 ms to
118/148 ms median/p95. Event Timing processing p95 rises from 3.5 to 88.2 ms,
and cumulative long tasks rise from 341 to 15,780 ms per 200-edit case. The
200-edit CPU profiles independently reproduce the difference. Classic's 10.6 s
profile is mostly idle, while v2 spends 12.3 s of its 27.5 s profile in main-page
Wasm. SHA-256 accounts for 4.3 s and large-value materialization for 2.1 s.
The stack runs through `large_values::materialize_attempt`, `values::from_sql`
and `fanout::refresh_group` during database ticks. This points to expensive
large-string query refreshes after immediate edits. Word counting adds another
1.6 s. A SharedWorker does not eliminate this main-thread work.

The first-load transfer grows from 5.78 to 20.84 MB. A representative network
capture downloads two identical 8.81 MB Wasm files, one with a hyphenated filename
and one with a dotted filename. Both have SHA-256
`793d17d49189ac682d527c4b119a19d0dd52c8276a6d70241f3de725e07c0aff`.
Their encoded transfers total 17.63 MB, about 85% of the v2 first-load total.
This is measured duplication, not merely two copies found on disk.

v2 passes all five returning-user list and offline text checks. Classic completes
the list check in two of five attempts and offline full-text verification in
three of five. Three Classic cases time out waiting for the controlled-reload
sidebar; two time out during offline opening/verification. Successful timings
alone therefore overstate Classic reliability here. The JSON retains each failure
stage and captured UI state. These results concern this local production preview,
not a general claim about Jazz Cloud. A ready editor heading is weaker than a
complete cached-library restore; this test does not isolate SW code as the cause.

## Sync tails and profiles

The archived dev baseline has one 21–22 s sync stall per run, on marker 3, 3
and 2. Two separate profiled dev probes reproduce 25.92 s and 22.03 s stalls.
Neither diagnostic contributes to production percentiles.

The 22.03 s probe records complete socket lifecycle lists. Neither sender nor
receiver opens, closes or reports a frame error during the slow marker.
Across its five-marker profile, the sender is idle for 22.4 of 25.1 seconds.
The receiver processes bulk CoValue transactions and dev-mode sidebar rendering.
Stacks include `processQueues → handleSyncMessage → handleNewContent →
tryAddTransactions`, Wasm transaction insertion, JSON parsing and React
`DocumentItem` rendering. Its retained last 200 frame events carry 15.20 MB near
the end of the stall. These are observer receipt times, not wire throughput
timestamps.

This reproduces the tail as a receiver hydration/processing backlog, with no
reconnect or session-lease wait in that trace. The exact historical three stalls
lack complete lifecycle data, so assigning each of them this cause remains an
inference. Profiling adds overhead.

The 25 unprofiled production markers top out at 359 ms on Classic and 141 ms on
v2. No comparable 20-second tail appears in either production set.

Raw main-page CPU profiles are compressed under `bench/results/profiles/`;
`summary.json` records sampled self time and frame locations. Decompress a
`.cpuprofile.gz` file and open it in Chromium DevTools. The paired 200-edit
profiles are separate diagnostic runs, outside the five unprofiled summaries.

### Extended trace

Both implementations pass exact-content validation for 5,000 edits in the large
document. These are single profiled runs, outside the five-run summaries.
They include 26,401 Arrow-key cursor movements, versus one in each 200-edit case.
They stress selection, presence and background replication as well as editing;
their elapsed time is not an estimate of a user's writing time.

| Metric                                       |          Classic |                 v2 |
| -------------------------------------------- | ---------------: | -----------------: |
| Dispatch → double-rAF, median / p95          | 33.38 / 50.10 ms | 149.93 / 259.50 ms |
| Long-task count                              |               40 |             13,641 |
| Long-task total                              |          42.51 s |         1,326.30 s |
| Profiled replay/settling/verification window |         507.67 s |         2,179.97 s |
| Main-page JS heap after replay               |        474.58 MB |        1,522.61 MB |
| Sent payload / edit, entire window           |         174.84 B |        28,713.71 B |
| Received WS payload / edit                   |          10.96 B |                0 B |

The heap samples have no forced GC and exclude Wasm and workers. They do not
measure retained memory or establish a leak. The long-window wire totals include
all cursor/presence activity and background work; they are not marginal document
protocol costs. v2's zero received WS count excludes its HTTP-stream downloads.

An earlier extended replay exposed nonliteral contenteditable line breaks:
15 extra newlines and 20 extra characters. The corrected mode prepares the
clipboard before timing and pastes literal newlines; printable text remains
keyboard input. A 1,000-edit check and both final 5,000-edit runs pass. Initial
invalid-input/interrupted attempts are kept under `bench/results/exploratory/`
and excluded from conclusions.

## Reproduce

Measurement preview processes were stopped after the runs.

```sh
bun scripts/bench/production.ts
bun scripts/bench/interleaved.ts
```

The provisioner uses temporary directories under `/tmp` and Work setup/start
with `--tailscale`. It is configured for this machine's cshed tailnet domain.
Use a clean temporary directory for a new campaign; do not rebuild a server
during measurement. Measured URLs:

- https://classic-main-alkalye-bench.cshed.carlassmann.com
- https://v2-main-alkalye-bench.cshed.carlassmann.com

The full trace's 33 ms pacing floor alone exceeds two hours, and its
5,602,244 Arrow-key movements add substantial automation and selection work.
The 5,000-edit slice includes 26,401 Arrow movements, versus one in the
200-edit cases. Input latency excludes cursor positioning; whole-window long
tasks and profiles include it. A 5,000-edit,
large-document-only slice per side therefore supplies the longer stress case.
Its raw JSON is separate from the five-run summaries; compressed CPU profiles
are committed under `bench/results/profiles/`. Replay commands add
`--runs 1 --edits 5000 --large-only --literal-newlines --skip-sw
--replay-timeout-ms 2500000`;
`BENCH_PROFILE_DIR` enables main-page CPU profiling.

## Caveats

Local backends, headless desktop Chromium, one machine and one dataset family.
No mobile, CDN or cloud conclusions. Cold means a fresh browser context inside the run's Chromium instance, not
a fresh browser process, cold backend or cleared OS/native-code caches. Classic uses a local SPA-fallback proxy hop. The
stacks also differ in security semantics: Classic E2EE versus v2 server-readable
storage. IndexedDB estimates exclude SW/HTTP caches; encoded asset transfers
reflect this local server rather than CDN compression. Five runs give coarse tails. Immediate
v2 saves and Classic's debounced saves are the shipped behaviors, so payload
figures are not a protocol-only comparison. SW blocked first visits exclude
precache competition; returning cases explicitly install and use the SW.
Event Timing omits fast events; main-page heap cannot compare total application
memory. A capture-listener microtask probe in early raw records returned near
zero and did not measure editor processing, so it is excluded from summaries. Profiles add overhead; the 200-edit, 5,000-edit and development
diagnostics are separate from the five unprofiled production runs. Failed exploratory attempts are excluded from the production
comparison and must not be treated as measured wins or regressions.

written with gpt-6.1-sol in T3 Code (Codex)
