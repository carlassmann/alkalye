# Multicursor source-index pilot

Do not adopt the candidate wholesale. The production editor receives exact multicursor edits but rebuilds their enclosing source-index span. An isolated candidate preserves those ranges and applies replacements backwards, after certifying their source result. No production files changed; candidate certification/projection/browser behavior remain untyped and untested.

A public TextIndex probe on a rich one-MiB fixture compared broad replacement with descending individual replacements. Fifteen alternating trials per count discarded three warm-ups and retained twelve timing samples per arm. Every mutation checked exact output, original fork independence and Unicode/logical/native line addressing against an independent index.

Mutation-only Bun medians, broad → narrow:

- 64 edits: 1.486 → 0.345 ms.
- 512 edits: 1.547 → 6.989 ms.
- 2,048 edits: 1.547 → 19.035 ms.

This excludes source certification, projection, CRDT work, browser layout and paint. It is a mechanism probe, not an application latency or 120Hz claim. Descending replacements lose badly for dense selections; sparse-range reuse may be worth a separate browser experiment, but this candidate does not solve the extreme multicursor target. Keep the existing broad path for now.

Producer bytes and hashes are retained in `mapping.json.txt`; `module-pin.json.txt` records the actual TextIndex source and Bun runtime. No accounts, private document contents, browser profiles or database fixtures are involved.
