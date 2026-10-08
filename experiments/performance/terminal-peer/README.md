# Remote terminal body edits

A validated peer scalar append/backspace now preserves warm raw and projected
source through the existing `PreparedTextEdit` cache publication. Parser,
identity, cancellation, migration-floor and atomic publication checks still run.
Unknown parent descendants, hidden inserts, structural fences, legacy text,
stale/duplicate identities and unsupported edits retain the general path.
Raw/canonical tails have independent splice positions, including frontmatter.

## Evidence

`results.json`: three alternating fresh logical invitation/history pairs;
24 trusted native edit cells, exact source and fresh accepted journal cursors.
Both browsers are actual separately signed-in accounts joined through a writer
invitation. Both backend arms use unchanged native Bun code; only browser assets
change. Each arm creates new accounts/origin and the same logical seed/history;
these are **not byte-identical database/profile resets**. Plain body is 128 KiB;
the other document adds 48 characters of frontmatter.

Receiver main-task median / maximum, milliseconds:

| Journey               |      Before |       After |
| --------------------- | ----------: | ----------: |
| Plain append          | 25.8 / 26.4 | 11.1 / 11.2 |
| Plain backspace       | 25.1 / 25.6 | 10.7 / 11.4 |
| Frontmatter append    | 31.2 / 33.0 | 10.6 / 11.2 |
| Frontmatter backspace | 27.4 / 27.6 | 10.0 / 10.7 |

Accepted peer checkpoint medians: plain 167→89/90 ms; frontmatter 180/186→93/106 ms.
Source arrival improves modestly. Two-rAF opportunities remain approximately
106–127 ms. They start at the sender's trusted `beforeinput`, using same-host
browser epoch timestamps; command-driver latency precedes that timestamp.
These headless measurements do not prove presentation at 120 Hz. Largest tasks
still exceed its 8.33 ms budget. No instant-peer claim.

Sampled whole-browser JS heap maximum: 281→275 MB. GC-sensitive samples are not
retained-heap/allocation measurements. Timeline traces contain no CPU sampler.
`diagnostic.json` is a separate instrumented journey, excluded from timings:
each receiver append/backspace publishes one suffix cache, plain and frontmatter.

The preliminary pilot lacked an explicit fresh journal floor and is excluded.
Complete corrected traces remain under `/tmp/alkalye-terminal-peer/app/`; compact
raw browser metrics, fresh cursor floors/positions, resource URLs and emitted
asset hashes are preserved in `results.json`. Assets remained immutable within
an arm. The record does not claim an independent digest of already executed
script bytes.

## Reproduce

Freeze baseline/candidate browser builds and an unchanged native backend checkout.
From the repository root, select each asset directory and run alternating arms:

```sh
PEER_PHASE=before-0 PEER_TRIALS=1 PEER_OUTPUT=/tmp/peer-before-0.json \
ALKALYE_TEST_ASSETS=/absolute/baseline/dist \
PEER_SERVER=/absolute/native-baseline/tests/browser-document-app.ts \
bun experiments/performance/terminal-peer/journey.ts
```

Repeat candidate/baseline order for three pairs. `journey.ts` provisions real
accounts/invite, awaits editability and exact saves, performs native append and
Backspace, records receiver task traces and fresh accepted checkpoints, then
reloads the peer. Browser/server resources close in `finally`. The initial large
seed uses the editor's public source/input boundary; measured edits use trusted
native keyboard input. `tests/replica-terminal-peer.test.ts` exercises independent
writers, checkpoint rebuilding, concurrent headers, orphan arrival, early
removal/cancellation, conflicts, fences, Unicode and legacy fallback.
