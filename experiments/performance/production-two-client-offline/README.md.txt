# Two-client/offline production correctness

Frozen production 514e1bb; isolated artificial account/data and two independent browser profiles. Same account, separate per-session actors. Strict93713 and runtime87158 exited0. Twelve actual native/public gates passed; no timing measurements.

A/B native append and live convergence; each client Undo independently accepted. Service-worker controlled offline edit survived actual reload. Independent HTTP source/revision stayed at position33 while offline, advanced34 on reconnect, then35 after Undo restored baseline. Exact source hashes and positions in result.json. Native input/caret checks use typed probes; online Saved requires valid changed version. Offline local Saved permits pending transport and proves reload readback, not remote acceptance.

Both browser contexts closed; owned server stopped. No separate-account revocation, twenty-client capacity, physical device, full rich-feature or performance claim. No private profiles, database, account/document IDs or capability keys included. Harness snapshots preserve executed code after this run; strict preceded runtime without code changes.

written with gpt-6 in codex
