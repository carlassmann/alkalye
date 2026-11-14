# Document latest-only limits and retain unchanged selected query results

Jazz `2.0.0-alpha.61`. Unsubmitted SDK contract requests from Alkalye.

## Latest-only snapshot reads and large values

A serializable transaction cannot read `.history("latest")` tables because
its snapshot may reference a pruned version. Large chunked values are also
rejected in latest-only tables. Upstream
[latest_only_tables.rs](https://github.com/garden-co/jazz/blob/v2.0.0-alpha.61/crates/jazz/tests/latest_only_tables.rs)
contains both reproductions, including the snapshot error for `presence` and a
value above the 64 KiB inline threshold.

Alkalye keeps presence/laser rows latest-only and does not read them in the
serializable space-deletion transaction. Stale rows become inaccessible through
the deleted document; the presence UI filters stale sessions. Import uploads
use 48 KiB decoded chunks, below the inline threshold, and overwrite bytes before
deletion. See [schema](../../src/jazz/schema.ts),
[sharing operations](../../src/jazz/sharing/operations.ts),
[presence](../../src/app/features/sharing/lib/presence.ts) and
[upload storage](../../src/app/features/classic-import/uploads.ts).

Please document these restrictions next to `.history("latest")`, with a pattern
for transactional cleanup of ephemeral rows and a supported way to stage larger
ephemeral payloads without retaining their history.

## Unchanged projections

Stock subscriptions can recreate selected rows whose selected values did not
change. Alkalye retains equivalent arrays at its React boundary so React
Compiler can reuse dependent results. Equality includes nested data, Dates,
bytes, removed fields and row order. See
[use-stable-rows.ts](../../src/app/hooks/use-stable-rows.ts),
[equality test](../../src/app/hooks/use-stable-rows.test.ts) and
[benchmark account](../benchmarks/jazz-classic-vs-v2.md#app-changes-and-limits).

The removed experiment changed SDK snapshot reuse; its implementation is in
[the historical SDK patch](https://github.com/carlassmann/alkalye/blob/94fc4ed/patches/jazz-tools@2.0.0-alpha.61.patch).
It is not installed now. Please preserve unchanged selected result identities
or document the intended invalidation contract. Subscription resets still need
to notify consumers.

## Empty transactions and restores

Empty mergeable transactions reject rather than commit as no-ops. Restoring a
live row also rejects with `row not deleted`. Upstream reproductions are in
[db.transaction.test.ts](https://github.com/garden-co/jazz/blob/v2.0.0-alpha.61/packages/jazz-tools/src/runtime/db.transaction.test.ts)
and [binding_host.rs](https://github.com/garden-co/jazz/blob/v2.0.0-alpha.61/crates/jazz/tests/binding_host.rs).
Alkalye skips empty asset/comment transactions and uses `update` for live assets,
`restore` for deleted assets. See
[time-machine restore](../../src/app/features/time-machine/lib/time-machine.ts)
and [comment import](../../src/app/features/comments/lib/comments.ts).
Please include these contracts in transaction/restore examples.

written with gpt-6.1-sol in T3 Code (Codex)
