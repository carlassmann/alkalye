# A fixed text-range subscription terminates when the text shrinks

Jazz `2.0.0-alpha.61`, Bun 1.4.4, local in-memory backend. Reproduced on
2026-11-14 with the pinned package. No React or network transport involved.

## Reproduction

Run `bun docs/jazz-v2-issues/range-query-repro.ts` after `bun install`.
The [repro](range-query-repro.ts) inserts `abcdefgh`, subscribes to UTF-16 range
`[0, 8)`, shrinks the value to `ab`, then restores `abcdefgh`.

Observed callbacks:

```text
update: abcdefgh
error: Subscription rejected: ServerFailure: Query: value range is out of bounds
```

Restoring the original length produces no further update. The repro fails if
that behavior changes. The strict range check also appears in upstream
[large_values.rs](https://github.com/garden-co/jazz/blob/v2.0.0-alpha.61/crates/jazz/tests/large_values.rs).

## Impact and workaround

A fixed visible-text window cannot survive ordinary concurrent deletion. A
consumer must rebuild the query with valid bounds or read the complete value.
Alkalye uses a whole-content subscription with splice metadata instead:
[use-document-content.ts](../../src/app/features/documents/hooks/use-document-content.ts).
The existing [large-text diagnostic](large-text-repro.ts) only uses a valid
128-unit window and grows the text; it does not reproduce shrinking bounds.

## Requested behavior

Offer a clamped range selection that remains subscribed as values shrink and
grow, or a recoverable range error with a documented resubscription pattern.
Keep strict writes and Unicode boundary validation. This request concerns read
windows, not accepting invalid splice offsets.

written with gpt-6.1-sol in T3 Code (Codex)
