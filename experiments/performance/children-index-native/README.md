# Lazy children index: n1 actual production pilot

Baseline b5577ba; identical production SourceTextarea/Effect/session/UI/server and diagnostic markers. Candidate changes only private children indexing, reusing lazy COW256 AtomMap buckets. No production adoption.

Both fresh arms passed trusted8-key input, exact source/native caret, immutable prime receipt, advancing final/Undo receipts, online reload and resource closure. Fixture ASCII1,048,576 bytes/UTF16units; fixed original midpoint. Input opportunity includes intentionally paced8keys; observer rAF is not paint.

Key2 children.set12.251→0.181ms; enclosing RunTask21.569→8.508ms, no nested GC. Other candidate child writes~.170ms vs native Map~.003ms (COW). Input3s main busy1312.718→940.271ms; max21.569→14.043ms. Undo busy928.695→773.855ms; max15.092→15.086ms; source/caret opportunity48.9→46.3ms. n1 only; no physical120Hz/full parity claim. GC/task peaks remain over8.33ms. First-load timing was not measured. Checkpoint ordering/compression/cold-load tradeoffs still require independent assessment.

Raw traces/private profile/DB/keys remain outside Git. Trace SHA/bytes in pair-summary.json. Source reconstruction: prior archived common/index diagnostics with numeric children.size mark removed identically, plus clean-children-lazy-delta.patch; exact marked hashes in source-pins.lazy.json. root clean lazy source hash f49b6f40c1e2d5ec93650ff446d19f63b7b7650a0097c9dfe559d74d23a51da5. Parent 67660 and parser87897 terminal0; all owned resources closed. This archive includes a patch-application context rejection corrected before type/build/keys, not a native failure.

written with gpt-6 in codex
