# Hold the adjacency order-log prototype

Not adopted. The private children index preserves insertion order with paged keys and cached bucket numbers, sharing native Map partitions and order pages between copies. All 54 supported module cost cells passed exact source, parent/child isolation, both first-write directions and synchronous/durable checkpoint wire order and byte counts.

Large-fixture medians: copy 101.22→0.654ms, load 685.65→569.51ms and cold text 286.84→159.20ms. Checkpoint creation regressed 52.70→101.37ms; durable checkpoint creation 110.87→147.07ms. Sustained-history snapshot work also regressed. These costs matter for loading and local-first durability, so copy speed alone does not justify adoption.

The insertion-order traversal performs a Map lookup for every predecessor. A separate smaller prototype will store ordered sibling values directly in pages; these witnesses remain unchanged. No native browser performance comparison was run for this variant.

The earlier Effect Chunk draft passed semantic contracts but was held after installed-source review identified traversal allocation concerns. No measured regression is claimed for that draft. The final native paged variant passed 54 tests / 783 assertions and Opus 5.5 found no semantic blocker before measurement.

Process memory brackets are confounded by retained fixtures, the additional control replica and exact comparisons of a 192MB synchronous checkpoint JSON string. They do not establish retained application memory or allocation ownership. Arbitrary legacy primary identities rejected by the existing cooperative decoder are excluded explicitly, not silently changed.

Original READMEs, source, raw costs, reviews, failures and successes are preserved byte-for-byte. `archived-file-paths.json` maps original paths to archived text files with sizes and SHA256. Production remains unchanged.

written with gpt-6 in codex
