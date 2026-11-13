# Jazz Classic vs v2

Classic baseline measured 2026-11-13: three completed runs, zero scenario failures.
All nine typing replays and three whole-dataset exports passed exact-content checks.
v2 remains TBD.
Raw samples: `bench/results/classic.json`.

## Reproduce

```sh
bun run bench:fetch
work setup --tailscale
NODE_OPTIONS=--max-old-space-size=16384 work up --tailscale
work urls
bun run bench:compare -- --target <web-url> --label classic --out bench/results/classic.json
```

Run from the checkout serving the target. Package and Git metadata describe that
checkout. For v2, use its URL, `--label v2 --out bench/results/v2.json`, and identical
machine, browser, options and server mode. Default: three independent accounts,
50 notes plus two books, 200 trace edits per typing case, no CPU slowdown.
`--cpu 4` throttles page execution; workers and the server are not throttled.
`--edits full` attempts all edits. Deadlines scale with edit count and can be
changed with `--replay-timeout-ms`. Full replay can take hours.

## Datasets

| Dataset       | Selection                                                                           | License / attribution                                           |
| ------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Notes         | First 50 sorted Markdown paths from pinned Vite docs                                | MIT; VoidZero Inc. and Vite contributors                        |
| Medium book   | Alice's Adventures in Wonderland, 170,590 bytes                                     | Lewis Carroll; public domain in USA, Gutenberg license retained |
| Large book    | Dracula, 874,540 bytes                                                              | Bram Stoker; public domain in USA, Gutenberg license retained   |
| Editing trace | Automerge's LaTeX paper trace: 259,778 insert/delete edits; baseline uses first 200 | CC-BY-4.0; Martin Kleppmann and Alastair R. Beresford           |

`bench/datasets/sources.json` records complete source URLs, licenses and SHA-256
checksums. Fetching fails on changed content. Large downloads are ignored by Git.
Fixtures normalize line endings to LF and add a unique title heading and explicit
title frontmatter. Original text remains intact. Books are plain Markdown paragraphs.
The account also retains its welcome document. The small typing/sync note is
Corpus 000, 6,218 bytes.

## Method

Seeding reuses the e2e account helper and imports a ZIP through the app. IDs come
from sidebar search results, with no Jazz schema/storage calls. Settings disable
automatic pairs, marker wrapping and completion, allowing literal trace replay.
Storage is sampled five seconds after import.

Fresh contexts receive only the Classic auth-secret entry, with empty IndexedDB,
no cookies, blocked service workers and disabled HTTP cache. Session IDs and other
localStorage caches are deliberately excluded: Classic stores session leases in
localStorage, and cloning those into isolated clients can reuse a session ID.
Cold-list time opens Documents when collapsed, then ends when the search input accepts a click and finds the large book.
Cold large-open time ends at the app's ready signal plus the visible book heading.
Warm reload keeps IndexedDB and enables HTTP cache, ending at usable sidebar search.

Whole-dataset loading starts before navigation in a fresh authenticated context.
The app's Export all command must download a ZIP containing all 52 original files
with exact content equality. This includes startup, export and verification costs;
it is not a pure transport timer. Export has a 60-second deadline after startup.
Sync measures five small-note insertions per run, from sender dispatch until a
second client's editor DOM contains the marker, polled every 20 ms.

Each typing case uses its own browser context. Full original content is verified
before editing; only the small note needs reset after sync markers, using plain-text
paste. Reads use Edit → Copy, which avoids collaborator labels in native DOM copies.
Direct document URLs avoid virtualized-sidebar click geometry. Pages are activated
before navigation and recording.

Trace cursor positions are reproduced with Arrow keys. Printable text uses keyboard
events, control characters use text insertion, deletions use Delete. No direct
editor-state writes. The trace is inserted before the original document, preserving
trace coordinates while exercising the document's full size. After replay, content
must equal independently replayed edits plus the original document. Full replay
also checks the upstream finalText.

Dispatch-to-paint starts before input dispatch and ends after a double
requestAnimationFrame response, including input queueing and automation/IPC overhead.
This paced estimate has a roughly 33 ms floor at 60 Hz; it is not a hardware display
measurement. A separate beforeinput-to-double-rAF proxy remains in JSON when emitted.
Long tasks are tasks over 50 ms during replay and its three-second settling window.
Typing percentiles pool successful edit samples; other percentiles use run samples,
except sync, which pools five markers per run. Percentiles use nearest rank.

CDP captures pages, iframes, dedicated workers and SharedWorkers before worker code
resumes. `bun run bench:verify-network` verifies exact binary HTTP/WebSocket byte
counts and Wasm transfers in both worker kinds. Bundle bytes are encoded JS/Wasm
transfers through first usable list plus one second. Wire metrics divide outgoing
WebSocket payload and HTTP request-body bytes by edits; received WebSocket payload
is separate. The window includes replay, settling and final verification. These
include background sync/hydration and are not marginal protocol costs or a packet
capture: transport compression, TLS and framing are excluded.

Storage uses Chromium's IndexedDB usage estimate, not database-file size. Heap is
main-page JS used size after replay, without forced GC; workers, native allocations
and Wasm linear memory are excluded. It cannot establish total-memory improvement
when v2 moves work into a SharedWorker.

## Results

Client: jazz-tools 0.20.18, harness commit `262baf5`. Server: jazz-run 0.20.19,
Node 24.22.1, 16 GB heap limit; server database retained across measured accounts.
AMD RYZEN AI MAX+ 395, 32 logical CPUs, Linux 7.2.8-9-omarchy,
Chromium 145.0.7632.6, CPU throttle 1×. The 52 imported files total 1,595,667 bytes.
This baseline uses the 200-edit slice; the full 259,778-edit replay was not run.

| Metric                                       | Samples | Classic median | Classic p95 | v2 median / p95 |
| -------------------------------------------- | ------: | -------------: | ----------: | --------------- |
| ZIP import, including document resolution    |       3 |        67.26 s |     67.55 s | TBD             |
| Cold usable document list                    |       3 |         6.84 s |      7.15 s | TBD             |
| Warm usable document list                    |       3 |         3.40 s |      3.55 s | TBD             |
| Cold large-document open                     |       3 |        14.29 s |     14.31 s | TBD             |
| Fresh device, all bodies verified via export |       3 |        22.34 s |     23.52 s | TBD             |
| Edit visible on second client                |      15 |         409 ms |   22,359 ms | TBD             |
| Typing dispatch → double-rAF, small          |     600 |       33.32 ms |    34.58 ms | TBD             |
| Typing dispatch → double-rAF, medium         |     600 |       33.31 ms |    33.84 ms | TBD             |
| Typing dispatch → double-rAF, large          |     600 |       33.33 ms |    33.83 ms | TBD             |
| Long-task count, small                       |       3 |              3 |           3 | TBD             |
| Long-task count, medium                      |       3 |              3 |           4 | TBD             |
| Long-task count, large                       |       3 |              2 |           2 | TBD             |
| Total long-task duration, small              |       3 |         496 ms |      499 ms | TBD             |
| Total long-task duration, medium             |       3 |         702 ms |    1,011 ms | TBD             |
| Total long-task duration, large              |       3 |       1,878 ms |    2,206 ms | TBD             |

Byte units below are decimal: 1 MB = 1,000,000 bytes. Per-edit figures divide the
entire measurement window by 200 edits, including background traffic.

| Metric                                 | Samples | Classic median |  Classic p95 | v2 median / p95 |
| -------------------------------------- | ------: | -------------: | -----------: | --------------- |
| IndexedDB after import                 |       3 |      115.54 MB |    142.65 MB | TBD             |
| First-load JS + Wasm transferred       |       3 |       20.23 MB |     20.23 MB | TBD             |
| Sent payload bytes/edit, small         |       3 |       183.06 B |     183.07 B | TBD             |
| Sent payload bytes/edit, medium        |       3 |       340.57 B |     346.22 B | TBD             |
| Sent payload bytes/edit, large         |       3 |       258.05 B |     262.28 B | TBD             |
| Received WS payload bytes/edit, small  |       3 |         8.53 B |       8.53 B | TBD             |
| Received WS payload bytes/edit, medium |       3 |   193,378.57 B | 200,445.57 B | TBD             |
| Received WS payload bytes/edit, large  |       3 |    94,772.09 B | 100,075.20 B | TBD             |
| Main-page JS heap after replay, small  |       3 |       80.48 MB |     94.46 MB | TBD             |
| Main-page JS heap after replay, medium |       3 |      191.36 MB |    208.43 MB | TBD             |
| Main-page JS heap after replay, large  |       3 |      497.16 MB |  1,144.18 MB | TBD             |

Three of 15 sync samples took 21.39–22.36 seconds; the remaining 12 took
311–453 ms. This tail is retained without attributing its cause. Large incoming
payloads during book replay include hydration/background work; they do not imply
that each keystroke individually downloads that much data. Typing medians sit near
the frame-pacing floor despite substantial long tasks, so both measures matter.
The app also emitted Base UI and unavailable-wikilink console warnings; measured
document content still passed verification.

## Limits and v2 adapter

Development server over a local tailnet proxy, no network shaping. Keep production
bundle/CDN claims separate. Three runs give a coarse p95; inspect raw samples and
retain outliers. Background work, garbage collection and sync batching add variance.
Classic debounces saves while v2 writes immediately; payload totals include that
shipped behavior. Earlier experiments exhausted server heaps; final runs use a
16 GB server limit. Failed exploratory runs are excluded.

`adapter.ts` owns account creation, settings, ZIP import/export, editor copy/paste,
direct opens and credential capture. Adapt these public UI bindings for v2. In
particular, replace `captureCredentials` with v2's device-auth-only bootstrap if
credentials move to IndexedDB/worker storage. Never copy a document database or
session leases into cold contexts. Preserve content assertions and test IDs.
Scenario failures retain elapsed time/error in JSON, continue independent cases,
and cause a nonzero exit; they are never converted into exact latency samples.

written with gpt-6.1-sol in T3 Code (Codex)
