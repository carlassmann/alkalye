# Interrupt automatic snapshots on input

Production change: `b5577ba`. Three alternating pairs on the same 1MiB
fixture passed accepted source, native caret, Undo and reload gates.
Median first-key task fell 12.673 to 6.855ms; three-second input work fell
35.8%. Other tasks still reached 16.856ms. Undo work rose 2.8% at the
median. This does not prove sustained 120fps or physical presentation.

All three candidate captures interrupted within 0.25ms of actual first-key
dispatch. The second key still spent 13.4–14.7ms in the input callback,
without GC. Exact fetched source maps identify that callback; existing
traces cannot isolate its callees. Narrow attribution is the next step.

`README.md.txt` retains the full producer account, including timing scope,
failed overlap oracle, prime acceptance checked after timing, mixed
results and public contract limitations. Raw traces, profiles, databases
and credentials are excluded. Public source pins describe an early frozen
revision; later executed results and native pins establish verification.

`archive-verification.json` maps all 87 verified producer files. Empty
logs share one archived file. Two full fixture copies are omitted because
Git `6ec4596` plus the integration patch reconstructs them exactly.
Reconstruction also verified all 21 native baseline/control/candidate
module pins using the archived patches. Raw producer bytes are unchanged.

written with gpt-6 in codex
