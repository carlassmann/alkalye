# Ordinal-page adjacency: native n3 proof

Frozen control 4a0aa7553a0de7fbfc2d8eb9a6332313b04bcf0dc68e558de6add25ea6e71b7d; candidate 6bcad274fcac66bf8ec36e0bd06aebd6de569b99879936427204f8d23df78605. Only children adjacency changed. Same experimental Worker Editor, session, proposal, mapper, CSS, transport and pristine ASCII 1MiB seed. This is not production Worker parity.

Twelve fresh cells: n3 per arm and 1/512 ranges, alternating arm order. All exact source, full range/direction/primary/caret and independent API accepted edit/Undo gates passed. Each cell server/browser closed and state preserved before parsing. No profiling in timing windows. Requested resource hashes match each immutable dist; request inventory is not execution coverage.

Medians (control → candidate), milliseconds:

| Scope | Expected native-value frame observation | Save-status frame observation | Main task max | Main task union | Worker task max | Worker task union |
| --- | --- | --- | --- | --- | --- | --- |
| 1 input | 6.3 → 10.7 | 6.3 → 10.7 | 5.647 → 5.672 | 213.257 → 235.007 | 168.702 → 154.135 | 696.622 → 603.379 |
| 1 Undo | 128.2 → 42.8 | 877.5 → 807.8 | 6.598 → 6.690 | 219.937 → 241.808 | 23.224 → 10.424 | 655.596 → 474.253 |
| 512 input | 11.7 → 13.4 | 11.7 → 13.4 | 4.663 → 4.817 | 186.089 → 213.441 | 170.414 → 159.207 | 618.100 → 651.605 |
| 512 Undo | 126.8 → 63.6 | 908.2 → 811.8 | 4.992 → 4.748 | 221.803 → 232.670 | 28.661 → 29.113 | 484.983 → 441.176 |

Input observations slowed; main union increased in every group. The 512 input worker union and Undo worker maximum regressed. Input worker tasks still reach 154–170ms. Main peak across input/Undo was 8.066ms control and 6.721ms candidate in this finite sample; no physical 120Hz claim.

The rAF probe observes expected textarea value: frame opportunity, not assignment timestamp, paint or key-handler cost. Save-status observes public pending flags after ready and can precede a queued pending notice; it is not durable receipt latency. Exact independently accepted source is a separate gate after each 3s window. Task union clips overlapping RunTasks to the common Chrome window; GC event spans are not additive task costs or retained-allocation ownership. Raw traces remain outside Git; analysis retains SHA256 and byte sizes.

The separate 72-cell public cost proof remains archive-cost-prepared: long sync checkpoint 53.139 → 67.729ms, durable 117.387 → 124.197ms; 1000-small-target sync load 70.492 → 86.249ms (+22.4%). These regressions prevent unconditional adoption.

Two work setup failures occurred before any server/driver/key action: wrong installed config field, then missing disposable Git workspace. Logs retained; private failed states remain outside Git. No uncertain action repeated.

Written with gpt-6 in codex.
