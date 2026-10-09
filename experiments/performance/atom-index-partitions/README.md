# Partitioned document atom index

Adopted the private atom-index change after public module contracts and twelve fresh browser comparisons. The production change preserves the existing Replica and Effect application architecture; it does not adopt the experimental worker editor.

Native Maps share immutable entries across 256 partitions. Forking marks both replicas' partitions shared. Each writer copies its affected partition first. Nearby insertion ordinals use the same partition, limiting the cost of the first write after a copy. Arbitrary legacy identities retain a full-string fallback. Other replica maps remain unchanged.

Production source SHA256: `4a0aa7553a0de7fbfc2d8eb9a6332313b04bcf0dc68e558de6add25ea6e71b7d`. Compared candidate: `937455a1bd75faa8fce9ded888b45db2a5fb6e977bf9b198012533aec305ab62`. Production differs only by formatting, the descriptive `ownedBuckets` name and two ownership/partitioning comments. The public tests exercise sibling and parent independence, convergence, cold checkpoints and arbitrary legacy identities.

Module medians on the large fixture: copy 194→94ms, restore 733→679ms. Smaller and legacy fixtures have modest loading/lookup regressions. The original 66-cell plan stopped when the baseline cooperative decoder rejected arbitrary legacy primary identities; retain that failure. Its 54 completed normal cells and six separately supported direct legacy cells are distinct evidence.

Browser comparisons used the same experimental worker/editor in both arms, with only the atom index changed. All twelve trials passed exact source, selections, directions, primary caret and independent server acceptance of edits and Undo. Undo text-update opportunity medians: 159→135ms for one selection; 170→117ms for 512. Main-thread task maximum: 7.103ms. Single-selection Saved timing was slightly worse, and the 512-selection Undo worker peak increased. Input worker peaks remain 159–172ms. This does not prove physical 120Hz presentation or full worker parity.

`cost/` and `native/` preserve the supplied evidence byte-for-byte. Their path maps record original names, archived names, bytes and SHA256. Original READMEs, failed setup and strict checks are retained separately. Raw trace hashes are retained; private accounts, API keys, databases, browser profiles and oversized raw traces remain outside Git. Scripts and JSON witnesses are archived as text, not added as executable product or test infrastructure.

Large JSON witnesses use lossless gzip to keep review diffs readable. Path maps retain the original byte count and SHA256, plus compressed byte count and SHA256. Every compressed witness passed an exact decompression round trip.

Production validation: `bun run check` passed 739 tests / 16,403 assertions, six browser module suites and the fast app journey, with static checks passing. The build passed. The restarted Tailnet server served JavaScript byte-identical to `dist/app.js`. These checks cover production correctness, not the experimental worker timing claims above.

written with gpt-6 in codex
