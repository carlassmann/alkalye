# Bounded native input experiment

Unshipped prototype. No production editor changes.

Question: can a full-document native textarea fit an 8.3ms interaction budget, or must native input contain only the visible document region?

Run `bun experiments/performance/viewport-editor/serve.ts`, then open http://127.0.0.1:4331/?size=1048576&fixture=long&mode=bounded in a background agent-browser session. `measure.ts` runs trusted input, scrolling and source-offset selection checks. `trace.ts` records Chrome traces through agent-browser.

## Results

Nine trusted single-character edits per cell: three each at the beginning, middle and end. `results.json` stores every sample. All 72 edits preserved the expected complete source; all eight short selection-replacement checks passed. Bounded native input contained at most 3,456 characters, including the 1MiB single wrapped paragraph.

| Source | Fixture               | Bare native median / maximum | Bounded median / maximum |
| ------ | --------------------- | ---------------------------- | ------------------------ |
| 128KiB | Many paragraphs       | 14.7 / 70.5ms                | 0.5 / 0.7ms              |
| 128KiB | One wrapped paragraph | 2.8 / 3.9ms                  | 0.6 / 1.0ms              |
| 1MiB   | Many paragraphs       | 834.9 / 3296.4ms             | 1.3 / 2.5ms              |
| 1MiB   | One wrapped paragraph | 17.6 / 27.0ms                | 0.7 / 0.9ms              |

These timings span `beforeinput` through `input`, including native editing. The bare control's input listener only records timing and schedules RAF: it does not read the value, index, rewrite or reset selection during input. Source equality is checked afterwards. Bounded timings also include its application work. RAF delay is recorded separately; neither measurement proves a displayed 120Hz frame rate.

Single Chrome trace examples for middle edits in wrapped paragraphs (`trace-results.json`):

| Source / mode  | Maximum event dispatch | Layout total | Paint total |
| -------------- | ---------------------- | ------------ | ----------- |
| 128KiB bare    | 2.876ms                | 0.865ms      | 0.468ms     |
| 128KiB bounded | 0.393ms                | 0.175ms      | 0.126ms     |
| 1MiB bare      | 20.511ms               | 6.938ms      | 0.759ms     |
| 1MiB bounded   | 0.997ms                | 0.273ms      | 0.134ms     |

The slow bare event is native `textInput`; its timing listener is negligible. Layout may be nested within dispatch; do not add these columns. Traces count events starting within 100ms after `beforeinput`; later work can be excluded. These are individual examples, not percentile guarantees. Raw trace paths are recorded in the JSON.

An earlier run including an application-bookkeeping full-textarea arm timed out waiting for input readiness. That failed arm is excluded from the table. The final bare/bounded matrix completed. Shared-machine contention and headless Chrome limit interpretation.

## What this establishes

A full textarea is viable for the 128KiB long-paragraph fixture, but native editing alone exceeds 8.3ms for the tested 1MiB fixtures. Virtualizing only a syntax overlay cannot remove that floor. Bounded native input removes this measured size-dependent native layout cost without replacing native text entry in this slice.

The bounded editor keeps canonical source outside the DOM, computes a virtual scroll height and places one native textarea over a window of 48 visual rows with overscan. Trusted edits update the canonical source; scrolling replaces only the window. CSS is scoped with `data-viewport-editor`.

## Prototype limits

- Wrapping assumes 72 monospace ASCII characters per visual row. Zoom, proportional text, tabs, bidi and Unicode grapheme widths need measured layout and a viewport index.
- `index()` scans every paragraph after each edit. This O(n) scan and string slicing are prototype accidents; an incremental text/paragraph index is required for production bounds.
- Only short selections within one window are tested. Cross-window selections, keyboard boundary navigation, multicursor and undo need a canonical selection model independent of the native fragment.
- Composition pauses window replacement, but real IME interaction is unverified. Accessibility currently exposes only the fragment; whole-document reading/navigation is unresolved.
- Syntax overlays, CRDT, persistence, collaboration, decorations, links and application lifecycle are absent. This measures a native input floor, not app parity.

Continue as a reversible editor-input slice, with IME, accessibility, cross-window selections and real font/wrap geometry as acceptance gates. Keep the production editor until those gates pass. No production cutover follows from this benchmark.

written with gpt-6 in codex
