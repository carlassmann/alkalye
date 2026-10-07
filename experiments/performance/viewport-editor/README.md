# Bounded native input experiment

Unshipped prototype. No production editor changes.

Question: can bounded native input keep typing below 8.3ms while a worker persists real document edits?

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

## Connected slice

Open http://127.0.0.1:4331/?mode=session&size=131072 after starting `serve.ts`. This uses the real Bun backend, browser account, IndexedDB journal and DocumentSession. Production code is unchanged.

The main thread owns a balanced UTF16 text index and a bounded native textarea. It sends replacement ranges through Effect Worker/RPC. The worker owns the document session and acknowledges strictly durable writes. Effect scopes own workers, fibers and callbacks. Initial 1MiB sources are seeded in bounded, durable chunks.

`connected-journey.ts` exercises nine trusted edits at the beginning, middle and end, checks exact source equality and reloads from IndexedDB. `--local-large` measures 1MiB local persistence separately.

| Source | Native input median / maximum | Worker durable median / maximum | Reload | Server sync               |
| ------ | ----------------------------- | ------------------------------- | ------ | ------------------------- |
| 128KiB | 0.3 / 0.5ms                   | 5.4 / 9.5ms                     | Passed | Passed                    |
| 1MiB   | 0.7 / 1.5ms                   | 30.8 / 62.7ms                   | Passed | Not measured successfully |

Each row has nine samples. `connected-results.json` and `connected-large-local-results.json` contain the samples. Both ran concurrently on the same machine. RAF delays still reach 16.3ms in headless Chrome; these results establish a small input path, not displayed 120fps.

The public text-index integration has 2,812 assertions over Unicode edits and 1MiB documents. The renderer journey checks canonical select-all/copy/delete, external caret shifts, repeated-character edit offsets, viewport boundary navigation, grapheme deletion and readonly guards.

Two real workers sharing one journal pass 13 checks, including stale revision rejection and durable reopen after termination. Foreign edits cause an explicit rejection before unsafe offsets are applied. The UI keeps the rejected draft and can save it as a separate document. The recovery journey verifies that copy survives reload.

## Prototype limits

- Wrapping assumes 72 monospace columns. Proportional fonts, bidi, tabs and actual grapheme widths need measured layout.
- The worker still uses whole-source CRDT APIs. A 1MiB durable write takes up to 62.7ms here. Keeping it off the input path does not solve sustained edit throughput.
- A 1MiB server sync did not complete within the journey's 20-second readiness deadline. Local persistence passed; large-document sync remains unresolved.
- Foreign edits are rejected, not rebased. Remote collaboration, multicursor and undo still need a canonical selection and transaction model.
- Real IME and accessibility remain unverified. Synthetic composition preparation is not an IME test.
- Explicit sync returns a full snapshot and resets the viewport. Automatic reconnect, idempotent retry and worker crash recovery are not implemented.
- Pending edits are protected by an unload prompt, not a durable main-thread outbox. A rejected draft becomes durable only when its recovered copy is saved.
- Syntax overlays, links and application parity are outside this slice.

Next experiment: patch-oriented CRDT writes with durable group commit, then remote edit rebasing. Keep the production editor until composition, accessibility, collaboration and real 120Hz display tests pass.

written with gpt-6 in codex
