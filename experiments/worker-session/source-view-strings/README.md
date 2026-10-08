# Private published source-view string experiment

Retained outside production. One matched finite run per arm gives a promising burst gain and a modest human gain; neither establishes bounded sustained backlog. Worker maximum tasks remain about 400 ms. Profiling is the next gate.

Candidate adds a private WeakMap from immutable published source atom views to their already materialized strings. `prepareReplacements`/`prepareEdit` reuse that string for a stale view; external mutable arrays still join their current values. Registrations sit beside validated prepared-cache publication and ordinary/cooperative source materialization. No schema, identity, visibility, permission or operation checks bypassed. Existing frontmatter projection selects frozen indexed atoms; immutable atom-sequence proxies reject mutation.

Baseline is production CRDT SHA `09430839d4093aef3644e2991a6161c3f30e338cc63632a80224e590787818f2` including the adopted peer insertion-run cache. Corrected actual EditorElement/worker bridge retained from the prior `71eac8c` prototype. This is not the production app or a main-branch comparison. The sole candidate behavior change is `candidate.patch`; exact source and emitted asset hashes retained.

| Finite arm                         | Baseline         | Candidate        |
| ---------------------------------- | ---------------- | ---------------- |
| Human peak queued edits            | 38               | 36               |
| Human post-command local drain     | 8.306 s          | 7.509 s          |
| Human enclosing input task p95/max | 1.492 / 2.701 ms | 1.705 / 2.568 ms |
| Human largest worker task          | 392.749 ms       | 409.601 ms       |
| Human peak main heap observation   | 132.4 MB         | 139.4 MB         |
| Burst peak queued edits            | 68               | 58               |
| Burst post-command local drain     | 11.169 s         | 1.415 s          |
| Burst enclosing input task p95/max | 1.157 / 2.192 ms | 1.095 / 2.226 ms |
| Burst largest main task            | 2.892 ms         | 2.226 ms         |
| Burst largest worker task          | 399.350 ms       | 423.996 ms       |
| Burst peak main heap observation   | 216.6 MB         | 236.5 MB         |

Fresh backend/temp dataset, signed account and browser session for every arm. Order: baseline human, candidate human, candidate burst, baseline burst. Same 1 MiB multiline source, 72 local characters and four actual worker peer prefix requests. Human uses one native key batch with requested 100 ms cadence; measured medians 103.9/103.8 ms, all 72 trusted keydowns and beforeinputs. Burst is one `keyboard type` command: 72 trusted beforeinputs, zero keydowns, median 0.9 ms. See the preceding sustained proof for the verified CLI distinction.

All four arms passed exact editor/worker source, four peer markers, zero pending/rejected/unsaved, independent signed public snapshot hash and receipt positions 1→77. After measurement, both actual worker sessions closed with network blocked and the primary session reopened the shared journal to exactly the same source. The two sessions share an origin/account/journal. Peer requests are concurrent with input, but their final acceptance/adoption can follow input and local drain. Completion timestamps do not establish the exact mutation instant or visible peer delivery during typing.

Complete top-level main tasks include native input, queued microtasks, local admission queue drain and three seconds of aftermath. Final canonical peer merge, snapshot oracle and offline reopen run outside that timed window. Worker maxima combine both worker threads; no command ownership or hot function inferred from their durations. No CPU sampler in these comparative traces. Headless rAF is approximately 60 Hz; no 120 Hz presentation claim. Approximate main heap is not worker or process memory. Quantiles are correlated event-level samples within one run.

Nine public Replica contracts passed, 68 assertions; types passed. They compare stale warm-view operations against cold views (ignoring only independently generated wall-clock timestamps), checkpoint reconstruction, metadata, Unicode, CRLF/frontmatter, mutable external bases, frozen nested facts and cancellation. Initial test failures were fixture-only: timestamps compared literally and one hardcoded offset beyond the base. Both original and corrected logs retained. Five additional cold/fast-cache cases are source-prepared outside the repository for the next correctness slot; not represented as passed here.

Opus 5.5 read-only review found no source blocker. It specifically flags full-length string retention while stale views stay alive and remaining source reconstruction paths. The test file was created after its initial read, so test validation is the separate executed contract suite. Candidate remains unadopted pending sampled worker attribution and further evidence.

Full trace files remain outside Git with exact hashes in `traces.json`. Both managed servers stopped and all browser contexts closed. Reproduce with the retained corrected runtime, exact baseline/current CRDT plus candidate patch, unchanged sustained driver, fresh backend for each arm and fixed agent-browser 20,000 ms defaults. No actions replayed on observation timeout.

written with gpt-6 in codex
