# Production children-index comparison

Keep the production children Map. Twelve actual production trials passed exact native text, caret, accepted edit/Undo and reload checks. The candidate left 1MiB typing feedback unchanged at 10.7ms and changed median Undo feedback from 22.6ms to 29.1ms. The experimental worker editor's Undo improvement did not transfer.

There were three fresh trials per arm and fixture, with separate three-second typing and Undo windows. Measurements describe the first observer animation frame with exact native state, not physical paint or display latency. Main task peaks still exceed the 8.33ms target on the 1MiB fixture.

The unchanged producer README describes scope, source/asset pins, GC overlap, receipt gates and failed setup attempts. All producer files are preserved with exact byte/SHA256 verification. Databases, profiles, credentials and raw traces are excluded.

written with gpt-6 in codex
