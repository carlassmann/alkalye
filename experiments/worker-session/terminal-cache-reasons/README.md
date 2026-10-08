# Terminal cache refusal diagnosis

Three separate fresh six-key diagnostic runs on the adopted source-view-string cache baseline (`4401f54` behavior), not comparative performance trials. Actual corrected EditorElement/worker prototype, 1 MiB multiline body with leading frontmatter. Three trusted native keys, observable local queue drain, explicitly synchronized peer prefix before frontmatter, then three more keys. Each run passed six trusted keydowns/beforeinputs, exact editor/worker/server snapshot hash, receipt 1→8, zero pending/rejected/unsaved and offline primary reopen. No CPU sampler.

Test-only phase marks isolate submitEdit's eager unchanged read, apply and successful return read. Private cache marks expose only booleans and numeric replica ordinals, never IDs or content. Each worker owns its ordinal sequence independently. The final run marks the first actual prepareTerminalPeerEdit refusal branch without changing its conditions or order. External source-map assets and full traces remain outside Git.

Before the peer prefix, primary successful result reads took 0.002–0.006 ms and the validated terminal cache stayed warm. Afterwards, each primary result read took 160–175 ms; the source/raw/string caches were cold immediately after apply. Unchanged reads were approximately 0.004–0.056 ms except the first post-peer string materialization (~10 ms). These diagnostic intervals include instrumentation and are not A/B latency claims.

Warm pre-apply cache, fresh fieldless scalar insertion, exact current source/raw tail anchor, sourceViews relation and absence of stale preparedEdit were verified. Initial hypothesis that the target-wide legacy flag rejected canonical header rewrites was **refuted**: legacyTarget remained false. Duplicate, text-owner, field and inactive-visibility flags were also false for the three post-prefix primary submissions.

The final enum confirmed all three hit `projected-source-without-leading-header-or-body`. The existing guard is `raw !== atoms && (!header || content.length <= header[0].length)`. Prefixing the former leading header leaves canonical source/raw views distinct while the visible source has no leading header. A later ordinary tail insertion therefore skips the terminal derivative cache and its successful source return reconstructs the whole document.

Other recorded refusals belong to duplicate echoes or cold durable replicas, not the same optimistic source read. Refusal counts and raw phase ordering are retained; do not infer command ownership from aggregate counts or sum overlapping durations.

A source-only one-line exception for projected source without a leading header is being reviewed separately. It retains legacy, identity, Unicode-scalar, exact raw/source tail, fence and header-only safeguards. No production eligibility change was made for this diagnostic. Reconstruction, future Unicode edits and undo/cancellation contracts plus matched actual sustained input must pass before adoption.

Read-only Opus review identified missing pre-read warmth/replica identity and malformed-input failure-order risks in the initial instrumentation. These were corrected before the first executed run: Array.isArray guards, catch-protected observation, numeric ordinals, pre-read states and bounded scalar signature checks. Direct first-refusal marks were then added. The diagnostic source is retained outside `/tmp/alkalye-worker-cache-reasons/runtime`; all three managed server runs and browser contexts stopped.

written with gpt-6 in codex
