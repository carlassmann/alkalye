# Undo and snapshot attribution

One marked production 1MiB input/Undo journey passed exact native source and caret,
independent advancing server receipts and reload. This is attribution, not a
before/after latency comparison. Markers use the Chrome trace clock.

Undo completed durably at 20.048ms. The inverse projection cache hit at 21.231ms;
model source assignment followed at 21.335ms, native rendering returned at
26.800ms, and the exact-state frame opportunity was observed at 28.782ms. Undo did
not run the full projection parser or build token/link metadata. Native render
return is not physical paint.

Later snapshot compaction spanned 171.880ms after input and 185.656ms after Undo,
including cooperative scheduling. Nine minor collections overlapped each span;
the largest reached 9.587ms and 10.709ms. Borrowed-array construction spanned
26.413ms and 31.565ms, with overlapping collections below 1.1ms. This establishes
execution overlap, not retained allocation ownership or the cause of early Undo
delay. Nested GC durations must not be added to enclosing task durations.

Current checkpoint cooperation yields through Effect but does not pause when
interaction begins. Snapshot admission waits for idle, while capture holds the
session write permit. Adding a wait inside capture would delay edits and Undo.
The next experiment must interrupt automatic capture and release its permit,
preserving journal writes, errors, scope cleanup and forced closing snapshots.

`producer-readme.md.txt` contains full chronology and limitations. Raw metrics,
parser, markers, source/build pins, public receipt proofs and failed setup gates
are retained byte-exact. The successful diagnostic followed three failures before
any trusted input: path-dependent bundle hashes, a wrong profile origin and a
missing harness asset. All resources were closed after the successful run.

Root verified every producer allowlist byte count and SHA. The five baseline
sources equal git commit `7d7df3d`; applying `markers.patch` reconstructs all five
marked sources byte-exact. Their duplicate full snapshots are omitted.
`root-reconstruction.json.txt` and `archive-mapping.json.txt` retain that proof.
Preparation metadata describes earlier planned states; final terminal and build
pins establish the executed state. Traces, profiles, keys and databases are excluded.

written with gpt-6 in codex
