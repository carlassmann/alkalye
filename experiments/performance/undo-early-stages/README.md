# Early Undo latency

One diagnostic native one-MiB typing/Undo journey against production `754c9d6`; no behavior optimization. Exact source, native caret, advancing independently accepted receipts and reload passed. The freshly built control graph matched production across 51 corresponding executable/source-map assets; requested marked scripts were pinned before input.

Undo wall-clock stages: initial replay 10.762 ms; history read 5.585 ms; three history decodes about 0.383 ms; accepted-basis cache 0.007 ms; candidate selection 0.236 ms; compensation construction 0.194 ms; journal write 3.343 ms. Durable completion was 22.281 ms, inverse projection 23.485 ms, native render return 29.227 ms, and first exact-state frame opportunity 30.890 ms.

These spans include asynchronous waiting; they are not CPU costs and nested spans must not be added twice. This fixture contradicts the hypothesis that duplicate opening-checkpoint decoding explains the delay. Initial replay is not yet split finely enough to identify its cause. Narrower IndexedDB request, transaction, copy and decode markers are prepared separately and remain unrun.

This is attribution, not a latency improvement or physical-paint measurement. The diagnostic does not prove the 8.33 ms interaction target. Diagnostic markers stay outside production. Proof excludes private accounts, profiles, databases and bulk traces; `mapping.json.txt` preserves the supplied producer bytes and hashes. Existing render-phase marker sources and fixture infrastructure are described in the earlier `undo-snapshot-attribution` archive.
