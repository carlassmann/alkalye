# Concurrent peer insertion run cache

Outside candidate on frozen `b48c2d8`; native backend and driver processes, fresh databases per arm. Only a private CRDT insertion-run prediction changes. Existing single-scalar path, full Schema/identity/visibility validation and identity/signature/generation publication guards remain. No production cutover by this experiment.

Three paired sixty-request journeys, alternating order. Twenty public authenticated accounts with writer invitations; independent causal branches append the same multi-character markers. All 360 measured requests accepted; exact markers, contiguous receipt positions 2–61, snapshot/history cursor 61 and public library metadata/kind/excerpt/wiki-links matched rebuilt snapshots.

| Trial | Baseline median / p95 / max ms | Candidate median / p95 / max ms |
| ----- | ------------------------------ | ------------------------------- |
| 1     | 276.11 / 502.45 / 534.47       | 38.93 / 135.34 / 148.07         |
| 2     | 276.46 / 495.83 / 544.44       | 32.28 / 122.69 / 126.38         |
| 3     | 262.72 / 474.83 / 526.48       | 38.45 / 124.40 / 127.97         |

Server CPU across roughly 3 second sampling brackets: baseline 2.063/2.078/2.039seconds; candidate 0.732/0.681/0.720seconds. Bracket lead/lag are retained in raw results. These observations include boundary slack, not precise handler CPU. Server max RSS 720–738 MiB baseline, 631–702 MiB candidate. Driver RSS and CPU are separately retained. No profiler in matched runs; no sustained throughput, browser session or 120 Hz claim.

Candidate types and 70 deep public module contracts passed (1,046 assertions). Differential reconstruction compares exact source, visible atoms, metadata and public Unicode replacement offsets. Cases include three concurrent writer branches/arrival orders, merged headers, fences/BOM fallback, hidden anchors/siblings, orphan descendants, cancellation-before-insert and last-replica atomic rejection.

An untimed serial HTTP oracle checked snapshot and library projection after each of 60 commits, then presentation metadata and wiki-link variants. A final 120-commit variant crossed checkpoint 100: every intermediate oracle passed; restored snapshot and public paginated history reached 121, exact original prefix and 120 markers, library kind slides and link other-doc. The final single-page 100-item history query initially failed its cursor gate; corrected read-only pagination verified the retained dataset without rewriting it.

Other retained setup failures: first untimed oracle accidentally kept concurrent producers, so snapshot and library reads raced. Corrected serial oracle used a new database. The first presentation variant retained three rounds because the source-edit pattern missed a formatted multi-declaration; its valid 60 checks remain distinct from the corrected 120-check oracle. None enters timing tables.

Evidence scripts are retained as text to preserve exact tested source, not additional production architecture. `runner.py` shows managed process isolation. Reproduction: archive selected commit twice, link pinned dependencies, apply candidate patch only in one arm; copy portable experiment and server from twenty-writer-http; run with work and fresh per-phase data directories at localhost:4470. Await server-ready, then launch driver; stop each server after observable resource samples bracket its timing window. Exact CRDT SHA-256 values and raw per-request/resource observations are in results-summary.json and arm folders.

written with gpt-6 in codex
