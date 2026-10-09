# Current interaction comparison

One observation per arm; no percentile or sustained 120Hz claim. The browser's
recorded animation frames were about 16.7ms apart. Metrics below describe the
largest enclosing main-thread task in each complete three-second window, including
background work. They are not input-handler durations or physical paint latency.

The frozen original is `a749728`; the rewrite runtime is `1b50852`, before the
server-only polling coalescing commit. Its entry SHA is `975b1701`. The frozen plan
records exact commits, loaded asset hashes, fixture hashes and six producer source
hashes. Root verified those six hashes before archiving their source snapshots.

| Journey                | Original maximum, ms | Rewrite maximum, ms |
| ---------------------- | -------------------: | ------------------: |
| Search query, 128KiB   |                1.959 |               1.451 |
| Next search match      |                6.342 |               2.413 |
| Close search           |                4.747 |               1.527 |
| Switch small to 128KiB |               90.123 |              20.523 |
| Switch 128KiB to small |               22.143 |               6.600 |
| Trusted wheel, 1MiB    |                2.568 |               4.077 |
| Type, 128KiB           |               32.084 |               4.584 |
| Undo, 128KiB           |               58.275 |               5.968 |
| Type, 1MiB             |              116.605 |              11.471 |
| Undo, 1MiB             |              586.614 |              13.001 |

Fixtures repeat rich Markdown; the 1MiB body is not ASCII prose without syntax.
Both versions passed ordinary typing/Undo, independent accepted source and reload
prerequisites. Timed runs retain native content/selection and accepted-state
oracles. Search navigation has different selection behavior between versions, so
each uses its actual state oracle rather than forcing equal selection ranges.

The rewrite's 128KiB typing and Undo windows had no tasks above 8.33ms. Each 1MiB
window still had nine. The rewrite also used more total main-thread work while
scrolling: 336.082ms versus 51.486ms, despite staying below 8.33ms per task. Its
1MiB typing window used 531.117ms versus 245.036ms. Lower maxima do not establish
lower total cost.

Observed exact-state frame opportunities also remain mixed. Search query was
2.6ms on the original and 18.0ms on the rewrite; closing search was 14.1ms versus
33.3ms. The 1MiB Undo opportunity was 2.3ms versus 31.2ms. These are observer marks,
not physical presentation or durable-save completion. They must not be replaced
with the task maxima when discussing perceived response time.

## Incomplete extreme case

Seventeen arms produced twenty-two windows; sixteen arms completed. Native
2,048-selection editing is measured separately on the rewrite. The original's
native select-all-occurrences command stops above 1,000 ranges. Its 512-selection
save did not complete within the prerequisite gate; that case is preserved in
`../main-multicursor-save-gate` and excluded from this comparison.

The rewrite's 2,048-selection input reached its expected source and independent
server acceptance. Its three-second Undo source-and-range readiness gate failed.
The task maxima were 55.234ms for input and 22.870ms for Undo; the arm remains
marked failed, rather than presenting those numbers as a complete successful
journey. No retry, reset or further edit was issued.

A later read-only remount and independent server read both found the exact
original source, with the server revision advanced from edited 28 to 29. Thus
Undo was eventually accepted. The remount reset the caret to zero; it cannot
establish the selection or completion time in the original capture. The remaining
readiness failure could involve completion latency or the selection oracle.

## Recorded parity difference

After Next then Close, the original keeps a collapsed caret at the match's end.
The rewrite keeps the match selected. Subsequent trusted typing inserted one
character in the original and replaced seven in the rewrite. Both edits were
accepted, and Undo restored the exact original source. This is a behavior
difference, not interchangeable timing evidence.

Raw results, metrics, frozen plan, producer snapshots and read-only witnesses are
byte-preserved as `.txt`. `archive-pins.json.txt` records their source paths and
hashes. Trace paths and hashes are in the metrics; large traces, private state,
database and browser profiles remain outside the repository. Producer snapshots
are evidence, not a second production architecture or a standalone runnable suite.

written with gpt-6 in codex
