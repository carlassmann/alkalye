# Bounded visibility memo pilot

One ordinary 1MiB native trial per arm on the experimental worker editor. The largest edit worker task fell from 165.221ms to 125.296ms; sampled visibility activity checks account for much of the change. Main task peaks did not improve. Exact text, caret, overlay and independently accepted edit/Undo checks passed.

This supports testing the bounded memo in production. It does not establish a reliable latency gain or physical 120Hz presentation. The production memo remains pending that comparison. See the unchanged producer README for scope, task windows, sampling limits, asset pins and failed attempts.

All 23 producer files are retained unchanged with byte/SHA256 verification. Credentials, databases, browser profiles and raw traces are excluded.

written with gpt-6 in codex
