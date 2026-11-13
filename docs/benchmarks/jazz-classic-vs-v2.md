# Jazz Classic vs v2

Classic baseline in progress. v2 remains TBD until the migration is ready.
Raw samples and environment are recorded in `bench/results/classic.json`.

## Method

Run `bun run bench:compare -- --target <url> --label classic --out bench/results/classic.json`.
Use the same Chromium version, machine, CPU throttle, dataset pins, edit count and
server mode for v2. Classic uses jazz-run 0.20.19, Node 24.22.1, with
`NODE_OPTIONS=--max-old-space-size=16384`. Failed exploratory runs exhausted the
default 4 GB server heap; the service log and SIGABRT core confirm V8 heap exhaustion.
During an initial harness run that reloaded the app per document, the server also
exhausted 16 GB.
The final harness uses sidebar links to navigate within one Jazz connection, matching
normal use and the existing responsiveness benchmark. Failed runs are excluded. The default uses three independent accounts and browser contexts.
Services run through `work setup --tailscale` then `work up --tailscale`.

Accounts also retain the app's welcome document; the 52 imported bodies are verified.
The corpus contains the first 50 sorted Markdown paths from Vite's pinned docs tree.
Each receives explicit title frontmatter and a unique heading for reliable UI lookup. Books are Alice's Adventures
in Wonderland and Dracula, preserved as plain Markdown paragraphs under a heading.
Books receive the same title frontmatter. Line endings become LF. Source URLs, SHA-256 pins, authors and license references
are in `bench/datasets/sources.json`. Downloaded files are ignored by Git. Gutenberg
licenses remain inside the books. Vite is MIT; the Automerge trace is CC-BY-4.0,
attributed to Martin Kleppmann and Alastair R. Beresford. The trace contains 259,778
insert/delete edits; cursor-only events were removed upstream.

Seeding creates an account with the existing auth helper and imports a ZIP through
the app's file input. Imported IDs come from document-list search results. No Jazz
schema or storage API is used. A five-second settling window follows import.

Cold measurements use a new browser context carrying only localStorage credentials,
with empty IndexedDB, blocked service workers and disabled HTTP cache. The list must
be usable and able to find the large book. Large-document open waits for its heading
inside the visible editor. Warm reload retains IndexedDB and enables HTTP cache.
Bundle bytes are CDP encoded transfers of JavaScript/Wasm responses through readiness
plus one second; development module loading makes this different from production.

Fresh-device time includes recovery-phrase sign-in and opening every imported doc,
using Edit → Copy for its complete editor text and checking exact equality. Native
clipboard copying can include collaborator cursor labels, so it is not used. It includes sequential
sidebar search, link navigation and clipboard verification overhead. This proves all bodies arrived, rather than equating a
populated sidebar with complete account hydration. Sync latency starts before an
editor insertion and ends when a second isolated client's editor contains the
marker in its visible editor DOM, polled every 20 ms. The receiver is scrolled
to the end first; polling never takes keyboard focus from the sender. Each run measures five markers on Corpus 000, a roughly 6 KB note.
Discarded exploratory sync attempts exceeded 120 seconds while using the earlier
clipboard/reload drivers, including server exhaustion. These are not successful
samples and do not establish normal-use sync latency.

Trace edits are replayed through browser text input and Delete keys, using Arrow keys
to reproduce offsets. No database calls or direct editor-state writes. Each document
is reset with plain-text paste first. Automatic bracket pairs, marker wrapping and
completion are disabled through Settings, so replay can reproduce literal edits.
The trace starts at offset zero, with the original document as a
suffix, so large-document cost is measured without changing the trace's coordinates.
The resulting full content must equal independently replayed trace text plus the
original document. Full replay also checks upstream's finalText. Default replay uses
the first 200 edits, not the full history or its original timing.

Input-to-paint is a beforeinput timestamp to the second requestAnimationFrame,
a paint-opportunity estimate rather than a display presentation timestamp. It excludes
input queueing before beforeinput. Inserts
and deletions with beforeinput events contribute samples; cursor moves do not.
The runner waits two frames after each trace edit, so this is paced editing, not
maximum throughput. Long tasks are PerformanceObserver tasks over 50 ms throughout
the replay and its three-second settling window. Typing percentiles pool input
samples across runs. Other metrics use nearest-rank percentiles of run samples;
sync pools five samples per run. Raw samples are retained.

Storage uses Chromium's origin estimate usageDetails.indexedDB after import. It is
an implementation estimate, not a database-file size. Wire metrics count CDP WebSocket
payload bytes and HTTP request-body bytes exposed by CDP during replay plus settling, divided by
trace edits. They include presence/background traffic, exclude TLS, framing and
headers, and report received WebSocket payload separately. JS heap comes from CDP
Runtime.getHeapUsage after replay, without forced GC, and excludes worker heaps.

## Results

Pending baseline completion. v2: TBD.

## Caveats

These are development-server measurements over a local tailnet proxy, without
network shaping. CPU throttling applies to page targets, not a whole-machine
low-end-device simulation. Server caches persist between accounts. Browser JIT,
background processes, sync batching and garbage collection add noise. Three runs
only give a coarse p95. Repeat on an idle machine before making product claims.
Service-worker offline startup and production CDN compression need separate runs.

For v2, adapt `scripts/bench/adapter.ts` if auth/import UI changes. Preserve public
selectors, recovery-phrase behavior and document routes where possible. If auth
credentials move out of localStorage, replace credentials-only context creation;
never copy IndexedDB into cold-load contexts. Keep every content assertion.

written with gpt-6.1-sol in T3 Code (Codex)
