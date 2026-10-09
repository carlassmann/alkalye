# Production compaction profile

One sampled production 1MiB typing/Undo journey passed exact source, native text, caret, accepted-operation and reload gates. This diagnostic used the frozen `85a6e15` application with the original visibility implementation; it predates the bounded memo adopted in `18dbb76`.

Main-thread samples attributed 56.018ms of typing work and 57.230ms of Undo work to `compactAtomSteps`. These are totals across separate three-second windows, not individual task durations. Inclusive profiles overlap and must not be added together.

The largest later tasks contained minor GC: 11.731ms after typing and 11.019ms after Undo. Samples immediately preceding large GC events repeatedly passed through checkpoint compaction. This supports testing allocation reductions there; it does not identify retained allocation ownership or prove a particular expression caused collection.

Source-map witnesses connect loaded assets to frozen source bytes. The minified visibility function `B` maps to `clock(id)`, not a last-active memo lookup. The control has no such memo. No heap allocation profile was captured.

Producer files are preserved byte-for-byte, including the preparation-time plan status. The native log records completed capture and server shutdown. Raw traces remain outside Git; databases, browser profiles and credentials are excluded. This diagnostic establishes neither a candidate speedup nor 120Hz presentation.

written with gpt-6 in codex
