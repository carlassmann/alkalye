# Same-source editor projection

Production candidate retains Projector's last source and collected private link tokens. Same source and document id/title key reuse tokens; the existing output builder still applies current selection and icon spacing. Source edits and title changes use the existing parser. Returned projections remain fresh mutable outputs.

Copied source baseline: 679da31f0d2027736ea4518c386bc402f29e8690. Only shared/projection.ts changed in the disposable copy. Backend, storage and sync are absent from this isolated editor fixture. The fixture uses the existing EditorElement, SourceTextarea, viewport and production editor CSS, an 800px container, monospace font and immutable rich Markdown. This is an editor slice, not a full app comparison.

Public corpus passed 4,693 projection, source/view mapping and native replacement assertions against fresh project() calls, which exercise the unchanged cold parser in the candidate module. It is not an independently implemented parser oracle. Sources cover media, wiki links, same-array title changes, Unicode, frontmatter, indented code and closed/malformed fences. Exact inclusive token endpoints across every token kind and CRLF frontmatter are not fully covered by this corpus. Existing native prettification passed 48 gates, including composition simulation, source editing, durable reload, wrapping geometry, bidi link fragments, hover and focus navigation. Candidate types passed. Physical IME, mobile and accessibility devices were not tested here.

Timing used n3 matched baseline/candidate trials at 128KiB and 1MiB, alternating arm order. Every arm opens a fresh fixture page. Trusted ArrowRight moves one source character outside a link at the middle and inside an expanded active link in the last complete row near the end. Neither key crosses a link boundary: the active link set stays unchanged. All 24 observations passed source equality, exact source caret, projected offset, 800px height and native fragment below 32KiB. Each trace includes a 3s aftermath; no CPU sampling was enabled.

| Size / position | Baseline median largest interaction task | Candidate |
| --------------- | ---------------------------------------: | --------: |
| 128KiB middle   |                                  1.259ms |   0.593ms |
| 128KiB end      |                                  0.651ms |   0.896ms |
| 1MiB middle     |                                  4.226ms |   2.526ms |
| 1MiB end        |                                  4.517ms |   2.317ms |

The largest complete main-thread task across every trace was 6.003ms baseline and 4.429ms candidate. No observed task exceeded 8.333ms. 128KiB results are inconclusive. Two-rAF opportunities stayed around 26–30ms, with inconsistent changes. These small n3 results support a narrow 1MiB task reduction; they do not establish full app latency or 120Hz performance.

`interactionLargestTaskMs` is the entire RunTask overlapping the trusted keydown mark through the second-rAF mark, including microtasks and subsequent frame tasks. It is not an input listener duration. `completeTraceLargestTaskMs` includes all tasks on the marked renderer main thread between profiler start and stop, including driver observation work. The mapping gate uses the current public projection; parity comes from the separate corpus and existing native journey. Position order is fixed middle then end, while arm order alternates, so warm-up bias remains. Layout and Paint are separate duration totals; their nested durations are not added to task time. No Layout events occurred inside the key windows. Startup and fixture construction happen before timing. The raw cells retain actual source/native lengths and readiness data.

Snapshot files are `.ts.txt` to avoid entering repository compilation. Replay in an independent copy of the stated baseline, restore `src/shared/projection.ts` from `projection.ts.txt`, install the existing dependencies, copy corpus/selection fixture/server/timing snapshots to their `.ts` names, then run `bun corpus.ts` and `bun selection-timing.ts`. The runner uses background agent-browser and closes its own session/server. Complete traces are retained under `/tmp/alkalye-projection-selection`; the committed cells preserve the measured summaries. Compiled bundle bytes were not persisted during this run, so there is no retrospective loaded-bundle hash claim.

Preparation failures were outside the product: corpus initially called the replacement API with the wrong shape; the first type copy omitted build.ts; initial native fixture copy used relative paths from the disposable directory; selection-server needed a module marker for top-level await. Each was corrected before its applicable successful validation. The final server module marker is type-only and was added after timings; fixture/projection runtime code was unchanged.

A separate readonly pointer review found no proven-safe lazy full-input expansion during native drag. That hypothesis is unimplemented and is not part of these results.

written with gpt-6 in codex
