# Deleted editor anchors

The public EditorElement fixture replaces a large document with an empty document or two reordered surviving atoms. Source and both canonical selection endpoints must remain exact. Inputs use the actual Chunk-backed `immutableAtoms` view.

One sample per cell, frozen minified browser modules, 1280×800 background Chromium. Initial mount and selection settle outside the measured interval. `synchronous` measures `editor.update`; `frameOpportunity` ends at the next requestAnimationFrame. These are component measurements, not trusted keystrokes, actual paint, app convergence or proof of 120 Hz rendering.

| Old source | Replacement         | Baseline update | Empty-only | Native exhaustive |
| ---------- | ------------------- | --------------: | ---------: | ----------------: |
| 128 KiB    | Empty               |         22.0 ms |     0.7 ms |            0.7 ms |
| 128 KiB    | Reordered survivors |         22.0 ms |    20.4 ms |            9.4 ms |
| 1 MiB      | Empty               |        170.6 ms |     1.1 ms |            0.6 ms |
| 1 MiB      | Reordered survivors |        156.1 ms |   177.3 ms |           70.1 ms |

Both changes were adopted. Empty replacement needs no old-atom traversal. The exhaustive path scans native atom iterators once, retaining the nearest predecessor in old order and its UTF16 end in new order. It remains O(old atoms + surviving atoms); the 70.1 ms result still exceeds an 8.33 ms frame budget.

`results.json` retains all twelve samples. `probe.ts` exposes `window.fallbackProbe(characters, empty)`; bundle it as a browser entrypoint, serve with the app editor and viewport styles, then call through agent-browser. Compare frozen baseline9e5b303, an empty-return-only arm and the adopted source. Use fresh page loads per cell; verify `exact` before accepting a timing.

Ten public component contracts include reordered survivors, distinct exhaustive range endpoints, variable-width Unicode legacy atoms, empty replacement and real Replica undo. Run `bun tests/browser-editor-anchors.ts`.

## Verified sparse generated survivors

A second experiment uses actual `Replica.edit`/`visible` atom IDs, rather than the manually named atoms above. Three alternating pairs per size compare the adopted native scan with an ordinal prediction. Initial construction and selection remain outside the measured interval; every sample verifies source and both caret positions.

| Old source | Native update median | Verified ordinal median |
| ---------- | -------------------: | ----------------------: |
| 128 KiB    |               5.5 ms |                  0.4 ms |
| 1 MiB      |              20.6 ms |                  0.7 ms |

The different native baseline belongs to this different generated-ID fixture; do not compare it directly with the earlier 70.1 ms manual-ID sample. Median next-frame opportunity is 16.3→18.0 ms at128KiB and21.2→15.2 ms at1MiB. Headless frame cadence is not a120Hz display measurement.

The shortcut derives at most three owner/ordinal base hints. It accepts a predicted old position only when `old[index].id` exactly matches. Every surviving atom must verify before any result is published. Choosing the largest verified old index below each endpoint then gives the exact old predecessor, with its UTF16 end in the new text. Unknown IDs, gaps, legacy formats or more than256 survivors use the native exhaustive fallback. This optimization helps sparse remnants of large deletions, not ordinary large-document editing.

`ordinal-results.json` contains all twelve samples; `ordinal-probe.ts` exposes the same browser boundary using real Replica atom IDs. Sixteen public contracts include generated Unicode, two insertion owners, unhinted gaps, foreign IDs, duplicate survivor offsets and legacy exhaustive behavior.
