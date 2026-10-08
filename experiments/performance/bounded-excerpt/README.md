# Bounded document excerpts

Frozen production `2ccca63`, versus the same source with only excerpt extraction changed. The later SourceTextarea projection cache is excluded from both arms.

The previous excerpt transformed the entire Markdown body, trimmed it, then took 72 UTF-16 units. The candidate searches for the first surviving character and transforms at most 72 units. When that prefix ends in whitespace, it checks whether later nonblank text survives; interior boundary spaces stay, genuine trailing spaces disappear. Frontmatter body extraction uses the existing block matcher, including malformed YAML. All-leading whitespace, all markers, and unclosed headers can still require full scans.

Three trials per arm, alternating B0/C0/C1/B1/B2/C2, each from identical disposable backend/profile seeds. Both actual local backends and production assets switch together. The 1 MiB rich Markdown document has real line breaks and 1,030 projected links. Trusted `x` inserts at the middle-body caret, then trusted Undo restores it. Every trial passes exact source, independent HTTP snapshot acceptance, increasing accepted cursors, original caret, and bounded native textarea gates. Input and Undo each have a three-second main-thread trace window. No CPU sampler runs during comparisons.

| Metric                       | Baseline median / maximum | Candidate median / maximum |
| ---------------------------- | ------------------------: | -------------------------: |
| Native input enclosing task  |        18.055 / 18.573 ms |         16.581 / 18.444 ms |
| Input aftermath largest task |        11.430 / 11.472 ms |         12.049 / 12.076 ms |
| Undo window largest task     |        19.506 / 21.208 ms |         17.792 / 18.014 ms |
| Undo 3 s busy task union     |  1,216.610 / 1,226.355 ms |   1,163.627 / 1,262.765 ms |
| Main heap after input        |          611.6 / 613.8 MB |           634.5 / 643.8 MB |

Input and Undo medians improve modestly. Input aftermath, heap, and Undo busy-work maximum worsen. This is no consistent total-work or memory improvement, and tasks still exceed the 8.33 ms budget. Headless frame opportunities do not establish physical 120 Hz rendering. Heap endpoints do not establish retained allocation owners.

Correctness: candidate strict types pass. A real IndexedDB LocalDocuments fixture checks 20 corpus cases through creation, projection, persisted catalogue reads, and storage close/reopen: 41 assertions pass. Cases include prefix whitespace followed by later text versus a blank remainder, CRLF, ECMAScript trim whitespace, malformed/unclosed/BOM frontmatter, astral boundaries and lone UTF-16 units. Production registration reuses the existing document API module journey, without a new test server. Read-only Opus review finds no semantic blocker; its performance statements are not measurement evidence.

`analysis.json` preserves every traced task/window metric and raw trace hashes; `results.json` and six result files preserve the full gates. Raw large traces remain under the private path in metadata. Initial setup/type/config failures are retained and classified as harness setup failures. No failed app interaction was discarded. Existing foreground phone data/processes were untouched; the retained disposable allocation server was restored after the lease.
