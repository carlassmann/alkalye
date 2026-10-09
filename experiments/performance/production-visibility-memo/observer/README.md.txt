# DOM agreement diagnostic

One fresh rich 1 MiB control/memo pair, same frozen production sources and backend as the n3 comparison. Only runner instrumentation differs. Scoped types and both actual input/Undo/independent accepted source journeys passed; owned servers and browser scopes closed.

MutationObserver watches the actual Editor subtree. At callback delivery it evaluates the same exact source/native fragment/caret predicate as the unchanged RAF witness. Records first successful callback only; one check per phase in this pair. Timestamp is a post-task DOM agreement opportunity, before physical paint, not exact application setter time or durability latency.

Input agreement control 9.6 / memo 9.9 ms; RAF 11.1 / 11.2 ms. Undo agreement control 25.2 / memo 19.5 ms; RAF 26.8 / 20.9 ms. DOM-to-RAF gaps 1.3–1.6 ms. No missing observer witnesses. This n1 result reverses the earlier n3 Undo readiness regression; it cannot establish vsync as its cause or justify a reliable latency improvement.

Observed JavaScript paths are verified through refetched bytes against emitted assets, not original response body capture. Raw traces/closed profiles/DB remain outside Git. Receipts omit private logs and identifiers.

Written with gpt-6 in codex.
