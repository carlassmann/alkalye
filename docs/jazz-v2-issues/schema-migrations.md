# Document schema branch convergence and history-mode deployment

Jazz `2.0.0-alpha.61`. Unsubmitted migration workflow request.

## Divergent lenses

Alkalye developed sharing and its Classic importer on separate schema branches.
A combined graph added lenses from both snapshots to one target. Startup rejected
`classicAccess.classicId` because its column origins differed between paths.
The integration record contains the exact error and source snapshot IDs:
[migration log, schema decision](../jazz-v2-migration.md#schema-decision).
The guard is in upstream
[names.rs, `lenses_agree`](https://github.com/garden-co/jazz/blob/v2.0.0-alpha.61/crates/jazz/layers/db/src/names.rs).

To reproduce the constraint, make two schema lineages introduce the same target
column independently, then join them with lenses that preserve those distinct
origins. `lenses_agree` rejects the differing stored names even if the final
TypeScript column shapes agree. This is narrower than all divergent graphs
being unsupported.

No production v2 data existed, so Alkalye regenerated a combined foundation
snapshot and reset disposable v2 stores. The final contract retains an additive
security migration. See [migration graph](../../src/jazz/migrations/index.ts) and
[foundation snapshot](../../src/jazz/migrations/snapshots/20261113T155418-b7b44e9a8d51.json).
This reset is a development workaround, not a production upgrade strategy.

## Full history to latest-only

Switching an existing table to `.history("latest")` requires deployment with
`allowDroppingHistory: true`. The SDK deliberately rejects deployment otherwise,
since the next write drops past row versions. See upstream
[deployment confirmation test](https://github.com/garden-co/jazz/blob/v2.0.0-alpha.61/packages/jazz-tools/src/backend/create-jazz.integration.test.ts)
and [deployment check](https://github.com/garden-co/jazz/blob/v2.0.0-alpha.61/crates/jazz/src/tools/deployment.rs).

Alkalye's [schema](../../src/jazz/schema.ts) uses latest-only presence, laser
and import chunks; its [server](../../src/jazz/server.ts) does not opt into
history dropping. Reusing an older development DB with a full-history version
therefore needs an explicit deployment decision or a disposable-store reset.
We have source/test confirmation of this constraint, not a retained Alkalye
runtime failure for this particular deployment error.

## Requested workflow

Document supported branch-convergence patterns and how to repair conflicting
column origins while preserving data. Detect the conflict in schema validation
before backend startup. Explain history-mode changes and their destructive
confirmation alongside ordinary migration generation.

written with gpt-6.1-sol in T3 Code (Codex)
