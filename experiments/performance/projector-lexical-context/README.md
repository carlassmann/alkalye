# Projector lexical context experiment

HOLD. The candidate caches entry/exit frontmatter and fence context on unchanged lines. It starts from production 5c5b6aa; only `projection.ts` changes. Public projections remain fresh. Source splitting, token output and regex invalidation remain synchronous.

The actual SourceTextarea corpus passed 332 assertions and trusted native input. The full editor prettification journey passed, including large wrapping, shifted links and bidi hit rectangles. A preexisting CRLF EOF mapping defect reproduces on both controls: requested 109, public 84, native 62. Those comparisons preserve baseline behavior; they do not establish correct CRLF caret semantics.

Six alternating matched actual-app cells used the same stopped rich database/profile history, reset for each arm. Source contains 1,048,576 UTF-16 characters, SHA 8b55d9981225b3b19b39ac9d36ea9bccdc38c053a28bf04aac2ba4383c41697f. Each cell verifies served entry SHA, native midpoint input, HTTP accepted edit and Undo, exact source/caret and bounded native fragment. Both arms use the same frozen Bun backend. Initial cached readiness is reported separately, around 2.2 seconds.

Input enclosing RunTask median fell 18.800 to 17.027 ms; maximum 19.220 to 18.903 ms. However baseline input trials 1/2 contain 1.776/1.992 ms MinorGC, whereas only candidate trial 1 contains 2.115 ms. Trial 0 gains just 0.058 ms. Whole three-second busy time rises 1012.248 to 1028.145 ms; deferred maxima remain 13.072 versus 13.016 ms. Undo largest-task median rises 221.337 to 228.162 ms. Sampled main heap is not peak heap or allocation proof. This does not establish a useful causal improvement, GC reduction or 120 Hz performance.

Trace windows begin at trusted beforeinput and include the complete enclosing task, microtasks and three seconds of deferred main-thread work. Undo has a separate three-second scope. Layout/Paint totals and union busy intervals are in `analysis.json`; nested durations are not additive. Three samples cannot establish p95.

Initial setup failed before input because the outside runner resolved globally cached Effect 4.0.2 while production models used installed 4.0.0. An installed dependency symlink corrected resolution. Failure logs remain; no failed setup is counted as performance evidence. A separate initial launch failed before process creation because its requested working directory did not yet exist.

Replay snapshots use `.ts.txt` deliberately: copy into an isolated production 5c5b6aa tree, preserving imports and installed dependencies. `measure.ts.txt` references retained disposable fixtures and must be adapted to a stopped coherent data/profile snapshot. Browser uses background agent-browser and stable timeout 20000. Raw traces remain at recorded absolute paths; `hashes.json` records original bytes. Entry bundle SHA was checked during each trial; dynamic loaded chunk URLs occur in raw traces.

Readonly Opus review found no semantic blocker; its three allocation suggestions were applied before formatting and all proofs. Production remains unchanged.
