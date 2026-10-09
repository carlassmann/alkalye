# Production bounded visibility memo

Adopted as `18dbb76` for lower total main-thread work, not a proven latency gain. Twelve production trials passed exact text, native caret, accepted edit/Undo and reload checks. On the 1MiB fixture, median three-second main-thread work fell from 857.548ms to 781.657ms for typing and from 772.455ms to 682.088ms for Undo. Every candidate sample was below every control sample for those total-work metrics.

Feedback timings are mixed. The three-trial Undo frame-opportunity median increased from 22.7ms to 31.7ms. A separate diagnostic pair observed exact DOM/native/caret agreement at 25.2ms versus 19.5ms; its frame-opportunity gap was only 1.3–1.6ms. That pair does not explain or erase the earlier result. We do not claim faster Undo, a physical paint measurement or 120Hz presentation. Main task peaks remain above 8.33ms.

The runtime memo keeps one operation identity, clears it on new cancellation or restore, and copies it on fork. The existing cancellation-graph cache remains. The exact source passed 747 repository tests, static/module/browser checks and 62 focused public contracts including 14 real SQLite cases before adoption.

Producer archives retain their capture-time pending status unchanged. Exact source/asset pins, trial windows, observable agreement predicates, receipt gates, setup failures and byte/SHA256 maps are preserved. Databases, browser profiles, credentials and raw traces are excluded.

written with gpt-6 in codex
