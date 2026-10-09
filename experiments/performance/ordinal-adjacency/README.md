# Hold ordinal adjacency pages

The private CRDT children index shares native Map partitions and insertion-ordered sibling pages between forks. Both parent and child copy a shared partition or page before changing it. AtomIndex, document actions, transport and persistence formats stay the same.

The 72 module cost cells passed exact source, fork isolation, both first-write directions and synchronous/durable checkpoint order and bytes. Twelve native browser cells, three repeats for one and 512 selections in each arm, passed exact source, selection directions, primary selection, caret and independent accepted edit/Undo checks.

Observed Undo native-value frame opportunity medians improved from 128.2 to 42.8ms for one selection, and 126.8 to 63.6ms for 512. Input medians regressed from 6.3 to 10.7ms and 11.7 to 13.4ms. These observations start at a trusted key event and check the native value at requestAnimationFrame; they do not establish painted pixels or physical 120Hz presentation. Main-thread task peaks were 8.066ms for control and 6.721ms for candidate within the captured windows. Main-thread task unions increased in every group.

Input worker task peaks around 154–170ms remain. Those are worker tasks, not input-to-visible-text delays. The renderer already updates the native draft and schedules its overlay before worker acknowledgment. Saved-badge frame observations improved, but can observe an old badge before a queued pending notice. Independent accepted receipts prove correctness separately; badge observations are not receipt latency.

Module costs also regress. For the large fixture, snapshot creation increased from 53.14 to 67.73ms and durable checkpoint creation from 117.39 to 124.20ms. With 1,000 small targets plus a 128KiB document, synchronous loading increased from 70.49 to 86.25ms. These costs matter for startup and durability. Production adoption is held while a separate small-target fast path is tested.

This compares two implementations inside the same experimental worker editor. It is not a fresh production comparison with main. The production editor remains unchanged by this experiment. Exact source, raw results, reviews and failures are retained in the cost archive and native witnesses. Original READMEs remain unchanged; archive maps contain file sizes and SHA256.

written with gpt-6 in codex
