# Skip unchanged editor repainting

Frozen baseline: `85c0ba9`. Candidate changes only `src/client/editor-viewport.ts`: refine later blocks without repainting the current source window unless selection, scroll position, or full-document mode requires it. Height-only resize still reads selection and paints.

Three alternating control/candidate pairs: eight trusted wheel events on a rich one-MiB document. All six source, caret, unchanged durable API and capture gates passed. Every cell still refined 181 blocks.

Median main-thread busy time over three seconds: 223.183 → 206.779 ms (7.35% less). Highlight callbacks: about 168 → 8. Worst enclosing task: 4.727 → 4.849 ms; no peak-task improvement claimed. All six cells had zero tasks over 8.33 ms. This headless capture does not prove physical 120 Hz rendering.

Exact Opus 5.5 review accepted the resize-corrected candidate and recommended reading native selection before painting. Final standalone public checks passed 13 assertions; existing viewport journey passed 17. Root adds same-width height-growth coverage and validates the production change separately.

Archived files preserve producer bytes; `mapping.json.txt` records hashes. Private fixture configs, account keys, databases, browser profiles and bulk traces are excluded. Candidate source SHA256: `7351252e7c6cf596d250de56c19b685a4a96efb097a698f280b9ea98e643788a`.

Root validation: 752 integration tests / 41,767 assertions passed; fast app and seven module browser journeys passed; selected viewport (including new height-growth case) and selection journeys passed. The combined check reported a formatting failure while the new test was being edited; the subsequent standalone format check passed. Production candidate bytes match the reviewed SHA256 above. No snapshot or undo-grouping change is included.
