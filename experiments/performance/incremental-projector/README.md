# Incremental editor projection

Three alternating comparisons of trusted midpoint typing in the same rich 1MiB document. Links remain in the edited paragraph. The initiating input task fell from 11.017 to 11.981ms to 7.859 to 8.110ms; median 11.073ms to 8.004ms. All six journeys verified full source, caret, accepted edit and Undo, and durable reload.

Undo remains mixed: exact-state frame opportunity median 22.1ms to 25.1ms, total main work +5.9%. Background tasks still exceed 8.33ms. These captures establish a smaller typing task, not sustained 120Hz paint.

`README.producer.md.txt` contains the complete procedure and limits. `archive-witnesses.json.txt` preserves the producer allowlist; `archive-paths.json` maps it to this archive. Producer files retain their original bytes. Raw traces remain at witnessed temporary paths; hashes and parsed results are archived. No private profiles, databases or credentials are included.

The production patch changes only Projector and SourceTextarea. It reparses one changed line and reuses projected text when syntax and token mappings remain unchanged. Uncertain edits use the existing full parser. Permanent checks use public projection contracts and the actual editor prettification journey.

Root `bun run check` passed 751 tests with 41,728 assertions, static checks and seven browser module journeys. The additional prettification, multicursor and selection journeys passed. The first full check failed only formatting; that log is retained. `production-formatting.json` verifies the formatted production files emit identical minified code to the measured candidate. The local preview serves the new app bundle and report.

written with gpt-6 in codex
