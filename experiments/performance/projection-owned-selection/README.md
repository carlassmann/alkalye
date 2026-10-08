# SourceTextarea-owned projection reuse

SourceTextarea reuses its borrowed projection when source, document id/title key, mode and inclusive touched-token set are unchanged. Projector exposes only a token-set equivalence query; its public project() still builds fresh mutable outputs. Empty token sets compare equal across gaps. A changed title, source or mode takes the existing path. Undefined active differs from a present selection; NaN misses conservatively. sync avoids scanning all projected links when its owned current reference is reused.

The getter documents borrowed read-only state and marks top-level fields readonly. This is shallow TypeScript documentation, not runtime freezing. Existing callers only read it; mutating this internal object already corrupts source/native mapping. Public Projector callers retain independent mutable outputs.

This slice builds on the adopted f094700 token-collection cache. The copied source tree originated at 679da31; EditorElement, baseline SourceTextarea and baseline Projector were compared byte-for-byte with current production before testing. The baseline is the five-line cache, not the earlier uncached parser. The immutable fixture omits later unrelated document-properties service changes.

Public corpus passed 14,285 assertions across 7,110 reusable range pairs. It covers every public web/wiki/media token endpoint ±1, adjacent links, gaps, reversed/out-of-range/Infinity/undefined selections, conservative NaN misses, same-array titles, source changes, Unicode and literal/fenced/frontmatter syntax. Fresh project() output is the unchanged parser oracle. Mutating a returned Projector link does not poison its next output. Types passed; the existing native editor prettification journey passed all 48 gates including composition simulation, durable edits/reload, strict wrapped geometry, bidi fragments and link focus. Physical IME, mobile and accessibility were not tested here.

The native timing fixture uses the actual EditorElement and production CSS in an 800px root. Source literals and a small document list are immutable. Each page creates a fresh fixture; n3 baseline/candidate arms alternate order. ArrowRight at the middle stays in plain text without touching a link. ArrowRight in the last complete row stays inside an expanded active link label. Neither timed key crosses a link boundary. Position order is always middle then near-end and is confounded with warm-up. Every one of the 24 cells passed trusted input, source equality, exact caret, source/projection offset agreement and bounded native fragment checks. Overlay geometry parity comes from the separate native journey, not that mapping self-consistency check.

| Fixture / position           | Baseline median largest interaction task | Owned reuse |
| ---------------------------- | ---------------------------------------: | ----------: |
| 128KiB plain text middle     |                                  0.555ms |     0.586ms |
| 128KiB active label near-end |                                  0.542ms |     0.458ms |
| 1MiB plain text middle       |                                  2.873ms |     0.596ms |
| 1MiB active label near-end   |                                  2.551ms |     0.588ms |

1MiB median main-thread task time dropped consistently for these same-token-set movements. 128KiB is inconclusive. Link-boundary crossing was tested for correctness, but its speed was not measured. Skipping projectTokens output assembly is the source-backed mechanism; no heap, allocation or GC reduction was measured.

Traces include the complete enclosing main-thread RunTask, microtasks and a 3s aftermath. The interaction interval runs from the trusted keydown mark through the second-rAF mark; its largest task is not a listener span. The maximum complete main-thread task across all traces was 8.415ms baseline and 5.947ms candidate. One baseline task exceeded 8.333ms; none of the 12 candidate traces did. This is confined to this isolated slice and does not prove 120Hz or full app behavior. Two-rAF durations are frame-bound and inconclusive. No Layout event occurred inside the key windows. Driver observation work appears in the full trace and its maximum is secondary evidence. Layout/Paint totals are separate and are not added to enclosing task durations.

Both compiled fixture bundles were persisted outside the repo. `bundle-hashes.json` records their SHA256 values. Each cell fetched its immutable script URL before profiling and verified the served bytes matched the corresponding build. There is no service worker on this new fixture origin. Source snapshots and raw trace hashes are in provenance.json; complete traces and bundle bytes remain under /tmp/alkalye-projection-allocation.

Replay in an independent checkout with existing dependencies. Restore baseline/candidate source snapshots to the disposable src paths; restore corpus and selection fixture/server/timing snapshots to their .ts names. Run bun corpus.ts, then bun tests/browser-editor-prettification.ts and bun selection-timing.ts. The harness switches only its own two source files while building and restores them in finally; browser and server cleanup is scoped. Snapshot artifacts use .ts.txt so repository compilation does not consume exploratory source.

written with gpt-6 in codex
