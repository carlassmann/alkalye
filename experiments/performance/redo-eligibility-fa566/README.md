# Terminal Redo eligibility

Untimed actual production editor probe, frozen `fa56600`, on a retained 1 MiB wrapped document. No production change or speed comparison. The probe logs Replica cache identity and generation without changing operation semantics. A separate outside certificate candidate remains unadopted.

Both accepted source hashes, surviving-predecessor caret and bounded viewport passed. Undo source/caret: 1,048,576; Redo source: 1,048,577, caret: 1,048,576. Served diagnostic entry SHA: `977b6ddae4177d015ab2cb9d62f55ec75c3c733365078518ca07aed666c8d3d6`. Main/staged paths received duplicate Undo acknowledgements: generation advanced while exact raw/canonical cache views and cached source persisted. A strict global-generation certificate would miss these paths.

## Diagnostic limitations

Operation-history arrays were borrowed: later events mutated earlier log rows. Generation and cache-identity fields are independent scalar snapshots. Event ordering cannot be reconstructed unconditionally from those borrowed arrays. The corrected reproducer snapshots histories; it was not rebuilt or rerun. Its original source snapshot was reconstructed by reverting only this snapshot correction; it is not claimed as a pre-build captured hash. First launch failed before browser boot because the disposable work root lacked Git registration; preserved.

## Outside candidate correctness

The private one-slot certificate survives only validated duplicate-only commits; every genuinely new operation and restore clears it. Redo still requires exact cached views/source, same target, indexed frozen terminal atom, cancellation provenance, visibility, structural guards, schema and generation/signature preflight. Fresh append views avoid identity reuse. Public Projector/editor behavior is unchanged.

Strict types passed. The final suite reports 25 passing cases/286 assertions: 24 valid-state checkpoint/replay contracts plus one narrower wrong-target source-isolation gate using independent operation replay. The original wrong-target checkpoint oracle failed, also reproduced in production. This is not 25 valid durable-state proofs. Existing action validation rejects cross-target cancellation during normal server acceptance and browser action replay; no HTTP exploit was demonstrated. Direct Replica application can still admit cross-target cancellation and later reject its checkpoint. Separate failing atomic-rejection contracts retain known, same-batch and reverse-arrival cases for a correctness fix.

Readonly Opus reviews found no semantic blocker in the narrowed candidate; formatting was corrected before types/contracts. No native candidate publication or performance proof yet. Do not adopt from this artifact.

Replay snapshots have `.ts.txt` suffixes to stay outside project TypeScript compilation. Use a disposable copy with the recorded source layout. Existing gate requires retained disposable profile/data paths; it never touches the user live server.
