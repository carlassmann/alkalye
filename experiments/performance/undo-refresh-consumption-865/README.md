# Rejected completion-refresh consumption

One matched Gate0 pair on production `8654545b2ebd0a84671bcfbfe2bf0b0f346f5874`. Candidate consumes only prior `documentRefreshPending` before the durable Undo success refresh, restoring it on thrown error. Library/presence/frame scheduling and reentrant requests remain intact. Both arms restore the same stopped backend/profile snapshot and have identical diagnostic markers. Strict types/builds, actual trusted input/Undo, exact source/caret, independent authenticated accepted snapshots and loaded-resource byte pins pass.

**Rejected: duplicate document work remains.** Prior document/library pending flags are true at completion in both arms. Each performs four document refreshes from completion through the next 100ms; each receives 29 later refresh requests in that interval. The first scheduled post-completion frame still refreshes. Total three-second refresh counts are nine versus eight, but the difference is the final periodic mark at the observation boundary, not demonstrated candidate savings. No n3 or production adoption follows.

`summary.json` retains phase counts, prior flags, request/refresh timings and the decision. `gates.json` retains exact accepted source hashes/cursors and timeline observations. Script URLs/decoded sizes and fetched emitted-byte hashes are provenance, not execution coverage. Raw traces stay outside Git; sizes/hashes are recorded. No credentials, profiles or databases are included.

Opus5.5 found no immediate flag/lifecycle blocker but predicted late notifications could recreate pending state; Gate0 confirms that performance concern. Prepared menu/disposal, simulated public reentrant input, injected update failure and real library/presence drivers were **not executed**. This experiment therefore claims none of those correctness gates. Initial nonexistent-workdir shell setup rejection occurred before any process ran and is not an application failure. All owned processes/contexts closed.

Finite one-pair 2KiB/headless observation; no displayed-pixel, sustained-capacity or physical120Hz claim. Root production remains unchanged by this rejected candidate.

written with gpt-6 in codex
