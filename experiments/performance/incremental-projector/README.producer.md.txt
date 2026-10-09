# Certified incremental projection

Actual production SourceTextarea/Projector, frozen 18dbb7679877bb366fd4f1702f4b051f6157ca1b, CRDT4a/TextVisibilityf7. Candidate changes only `src/shared/projection.ts` and `src/client/source-textarea.ts`. No worker/editor/model/authority changes. Requested Opus CLI model `claude-opus-5-5`; plaintext output did not expose a resolved model ID.

The certificate reparses the edited line and requires exact unchanged link/token metadata, lexical context, active-token state, options and cached canonical source/text. It splices the cached projected text and shifts token metadata; uncertain syntax, changed tokens or stale state use ordinary projection. Whole-source arrays remain authoritative. No viewport-only projection, deferred parsing or arbitrary editor-source authority.

## Repeated actual production result

Three fresh alternating trials per arm, original rich fixture midpoint 524288. Fixture: 1,048,576 UTF-16 units and UTF-8 bytes, 20,767 LF characters; source SHA256 `0ba3f77995fce57ab0142bbb058e5413468afd515c1b2592079091656a89091b`. Dirty linked paragraph and guard eligibility were recorded before keys in `native-plan.json.txt`; no substituted blank-line edit.

| Metric, ms | Control | Candidate |
| --- | ---: | ---: |
| Initiating input RunTask median / maximum | 11.073 / 11.981 | 8.004 / 8.110 |
| Input EventDispatch median / maximum | 9.461 / 10.269 | 6.470 / 6.599 |
| Input native-event to exact-frame opportunity median / maximum | 10.8 / 11.7 | 7.7 / 12.6 |
| Input full 3s largest main task median / maximum | 11.073 / 11.981 | 9.947 / 11.180 |
| Input full 3s main busy union median | 780.761 | 770.252 |
| Undo native-event to exact-frame opportunity median / maximum | 22.1 / 26.6 | 25.1 / 28.6 |
| Undo full 3s largest main task median / maximum | 11.345 / 11.770 | 10.585 / 10.975 |
| Undo full 3s main busy union median | 662.482 | 701.468 |

All six cells and twelve input/Undo phases completed exact source/native projection/source-caret, independent HTTP edit/Undo receipts advancing the same durable log, and reload gates. Candidate foreground tasks consistently improved; Undo busy union rose 5.9% and frame opportunity worsened. Background tasks still exceed 8.33ms. Finite headless 1MiB linked-paragraph n3; no physical paint, physical 120Hz, all-interaction or giant-single-line claim.

`series-analysis.json.txt` retains all raw per-phase metrics and trace SHA256/byte witnesses; raw traces stay outside Git. `series-summary.json.txt` contains n3 distributions. `production-*` files retain the separate n1 pilot; do not pool it with n3. Input enclosing task contains the first native input EventDispatch. Full-window RunTask durations include nested GC. Busy is clipped interval union, never nested duration addition. Largest GC is an overlapping main-thread event span, not retained allocation ownership. rAF readiness is the next observed frame opportunity, not display/paint latency. No CPU sampling or forced GC during comparative captures.

## Correctness and review

Public Projector final: 50 generated cases, 670 assertions. Consolidated permanent candidate: three public contracts, same 670 assertions, PASS. Actual SourceTextarea native fixture: thirteen initial plus six repeated trusted input actions, 152 assertions, PASS. It covers Unicode/CRLF, raw/project equal-length switching, links before/after edited text, token-changing syntax fallback, renamed documents, and repeated edits. Existing production pilot separately proves real Undo and durable reload. The proposed existing prettification insertion remains source-prepared, unrun in this outside experiment; root integration owns its execution.

A real linked-line repeated-emoji failure revealed stale cached dirty-line tokens; final candidate publishes reparsed tokens. Initial raw/project certificate mismatch was rejected by Opus and fixed with canonical source/text and mode checks. Final focused Opus review found no semantic blocker. Logs retain initial failures and final passes.

Three production setup failures occurred before trusted keys: missing disposable Git metadata, inherited server data-prefix guard, inherited output/profile allowlist guards. All retained; own roots corrected without relaxing guards. No uncertain mutation retried. Final successful n1 and n3 use the same source/dist. Final setup-only runner pins were recorded after n1; n3 runner remained unchanged throughout. Exact source/dist digests and per-cell requested resource lists are retained; resource requests do not establish execution coverage.

## Replay and provenance

Producer scripts, parser, module/native fixtures and focused source patch are archived as inert `.ts.txt` / `.json.txt` / `.log.txt` files. `producer-manifest.json.txt` maps exact outside producer paths, bytes and SHA256. `cells.json.txt` retains measurements/source-selection/public receipt hashes; network observations omitted to avoid unnecessary request detail. `native-package-pins.json.txt` records both immutable source/dist trees. Private profiles, authority DBs, keys, manifests and raw traces are excluded.

Formatted adoption patch differs from measured source only by root Prettier conventions. Measured `candidate-src` and `control-src` sources are separately retained. Archives are evidence, not a portable execution environment; replay requires isolated private fixture setup and existing background agent-browser/work dependencies.
