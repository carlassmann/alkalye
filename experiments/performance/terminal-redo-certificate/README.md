# Terminal Redo certificate

Actual production editor comparison: frozen `fa56600` browser versus one private Replica certificate, same native `fa56600` backend. Three alternating trials per arm; each restores identical retained data/profile state. Trusted terminal append and accepted Undo precede trusted Redo. Each Redo captures its complete enclosing main-thread tasks plus 3 seconds of aftermath, without CPU sampling or publication instrumentation.

Largest Redo task median: **197.968 → 13.511 ms**, maximum: **203.152 → 14.251 ms**. Three-second main-thread busy union median: **1,443.924 → 883.453 ms**. Candidate still has 13–14 ms MinorGC tasks; neither the interaction nor the app is proven to meet 120fps. Initiating key task is approximately 0.45 ms in both arms and does not represent deferred application work.

Each cell verifies exact local source, durable save state, independently observed accepted Undo/Redo hashes, surviving-predecessor caret, bounded native input and viewport ending at the document tail. Redo source has 1,048,577 characters; caret remains at predecessor offset 1,048,576. Entry bytes are 253,391 in both arms; entry hashes differ and are checked per cell. Sampled main JS heap median was 1.234 → 1.143 GB; this is not total process memory or causal GC proof. Paint median 6.162 → 6.251 ms; do not claim a paint improvement.

## Narrow mechanism

Existing proved terminal Undo publication creates one private inverse certificate. It survives only exact validated duplicate-only commits. Every genuinely new operation, including another target or metadata, clears it before publication; restore clears it and fork copies it last. Redo requires exact raw/canonical cache identities, source, frozen indexed terminal atom, target and active cancellation provenance. Structural guards and existing schema/signature/generation preflight remain. Fresh append views avoid identity reuse. There is no generalized cancellation-chain shortcut; intervening peer work safely falls back.

Separate instrumentation proved four actual successful Redo cache publications, including post-ACK main/staged replicas, with fresh raw/canonical views. Diagnostic source and bundle hashes are distinct from uninstrumented timings. The preceding eligibility investigation and its borrowed-log limitation remain in `../redo-eligibility-fa566`.

## Correctness and known defect

Strict types passed. Final contracts: 24 valid-state checkpoint/replay cases plus one narrower wrong-target source-isolation case, 25 passing cases/286 assertions overall. The original wrong-target checkpoint oracle failed and production reproduced it. Direct Replica application can admit cross-target cancellation and later reject its checkpoint; separate atomic-rejection cases remain red for a correctness fix. Normal server acceptance and browser action replay check cancellation target provenance, so no HTTP exploit was demonstrated. This artifact does not claim 25 valid durable states.

Readonly Opus reviews found the narrowed certificate logic safe. Formatting was corrected before contracts and timing. Real OS IME, mobile platform behavior, general Redo chains and whole-app sustained performance are not proven by this slice.

Raw six traces remain at the paths recorded in provenance with exact hashes. Source/runner snapshots use `.ts.txt` to avoid TypeScript project compilation. Replay in a disposable tree with the retained fixture paths; never use user live data.
