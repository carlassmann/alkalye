# Mobile pointer placement

A coarse-pointer device uses the complete native input to retain native selection handles and composition. Pointerdown unnecessarily rebuilt that same input and aligned it against estimated block heights. Three trusted taps in a 128 KiB document moved the page by 36, 69 and 69 pixels.

The guard retains the complete input and native pointer placement. The same taps moved zero pixels; synchronous pointer handling fell from 13.4–14 ms to 0.1 ms. Typing remained 16.5–23.4 ms. Subsequent frame opportunities still exceed 8.33 ms: this does not establish 120 Hz mobile editing.

[Raw observations](mobile-pointer-results.json) retain every sample. [Probe](mobile-pointer.ts) accepts session, disposable profile and document URL: `bun experiments/performance/mobile-pointer.ts SESSION PROFILE URL`. Use identical frozen builds and cloned storage, clear copied service-worker/browser caches before first boot, and run sequentially during a CPU-quiet window. Output goes to `/tmp/SESSION.json`. Baseline is `1bbe9da`; candidate adds only the already-full pointer guard. The emulator reports `(pointer: coarse)` and uses a 393-pixel iPhone 15 viewport; it cannot establish physical-device selection-handle, WebKit or real IME parity.

`browser-editor-mobile` checks large-document tap placement, exact saved edits, complete Markdown select-all/copy, composition-event completion and pointer cancellation. Existing viewport and prettification journeys retain desktop drag, geometry and composition contracts.
