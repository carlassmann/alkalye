# Validated replacement inverse receipt

Outside prototype; no production adoption. Original stable-copy worker and full selection mapper versus the same source with only a private replacement receipt. One fresh identical closed database/profile per arm, sequential baseline then candidate. Actual native TOKEN→x replacement and Undo, 1 and 512 ranges. Headless shared-host n=1 per cell; no sustained capacity or physical frame-rate claim.

| Undo metric (ms)                        | Original 1 | Receipt 1 | Original 512 | Receipt 512 |
| --------------------------------------- | ---------: | --------: | -----------: | ----------: |
| Largest worker RunTask                  |    181.474 |   101.853 |      181.555 |     115.135 |
| Worker clipped task union, 3s           |   1533.117 |  1329.918 |      879.040 |     706.531 |
| Source observer frame opportunity       |      523.1 |     341.1 |        542.4 |       378.6 |
| Local saved observer opportunity        |     1321.6 |    1340.5 |       1225.4 |      1313.0 |
| Largest main RunTask                    |      6.855 |     6.561 |        4.432 |       4.180 |
| Main clipped task union, 3s             |    206.565 |   184.234 |      222.613 |     216.841 |
| Largest GC event span, selected threads |      9.699 |     9.362 |       11.459 |      19.041 |

Source readiness and worker work improved; saved completion worsened. The unchanged full mapper still costs 87–114ms in the candidate. GC spans have no proven owner and are not additive to task durations. Main RunTask durations include nested GC. Observer opportunities are neither paint nor display latency. Experimental WorkerRPC/actual EditorElement scope does not establish production-worker parity.

Both arms passed native exact source, every range/direction, primary selection/caret, and independent HTTP accepted edit and Undo gates. Per-arm fetched script SHA inventories match immutable arm outputs; fetching a digest is not execution coverage. Raw traces, private account configuration, databases and browser profiles remain outside Git. `retained-traces.json` identifies original captures.

Strict and 82 public tests/1295 assertions passed on the diagnostic-free source: actual SQLite DocumentSession 1/512 accepted Undo/Redo; peer insertion, deletion, same-body retype, metadata, comments and scope interruption; zero-insert deletion, Unicode replacement and repeated cancellation chains; concurrent lost-alias normalization and BOM/CRLF/root-header fallback; existing frontmatter contracts. Public before/after view identity confirms eligible accepted Undo/Redo reuse. All ordinary identity/visibility validation and cancellation permissions remain in place. Any unknown operation invalidates the receipt; only fully validated known acknowledgements preserve it. New root '-' or BOM insertion falls back, preserving historical alias normalization. One immutable paired receipt only; no editor-source authority or global memo.

Initial Opus review rejected unrestricted header reuse. The conservative root-header exclusion and cold reconstruction oracles address it; focused Opus review found no counterexample. Initial instrumented module marks were overwritten by a later test run: their logs remain, but their original raw marks are unavailable. Independent fresh per-arm module captures were subsequently retained; they are correctness diagnostics, not timing comparisons. Final native comparison contains no diagnostic hooks or profiler samples. An initial build failed because its copied RPC fixture dependency was missing; it was fixed before any native key and retained here. No uncertain native action was repeated.

Patch baseline CRDT SHA: `fa018ceddb23a671cc2364e324c11f06a184058e2c58a959c769b9bc39586833`.
Candidate SHA: `e61d7819830f0a6ab9adb4ed15b58870c50e912bc4f9564d56ab3379bdb6bc2b`.

Written with gpt-6 in codex.

Root integration uses the production public replica.forkEffect method rather than the outside-only Session.forkReplica helper. Archived public contracts are inert .ts.txt witnesses; executable production tests remove diagnostic environment branches and cache-reference assertions. An initial root check caught the API/import mismatch and was retained outside the repository; corrected public cases passed before the full check rerun.

Production integration: full bun run check passed 735 tests / 16323 assertions, six module integration suites, fast app journeys, types/lint/format. The CRDT source is byte-identical to the reviewed candidate; worker UI is not cut over.

written with gpt-6 in codex
