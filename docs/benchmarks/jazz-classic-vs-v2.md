# Jazz Classic vs v2

Classic baseline pending the final run. v2 remains TBD.
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
Cold-list time ends when the search input accepts a click and finds the large book.
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

<!-- results -->

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
