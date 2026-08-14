# Jazz Patterns

## Type Helpers

Use Jazz-tools' built-in type utilities for loaded data:

```ts
type ReminderData = Parameters<typeof Reminder.create>[0]
type LoadedUser = co.loaded<typeof UserAccount, typeof query>
type NotificationSettings = NonNullable<
	LoadedUser["root"]["notificationSettings"]
>
```

- `co.loaded<Schema, Query>` - type for loaded CoValue with specific depth
- `ResolveQuery<>` - resolve query types

## Bounded Replay

Jazz CoValues retain immutable transaction history. Any CoValue resolved during
startup must therefore have bounded history, independent of total editing time.

- Keep account root values limited to stable references and rare preferences.
- Store device navigation state locally instead of syncing it through the root.
- Trigger synced writes from stable user-intent IDs, never from a subscription to
  the same CoValue being written.
- Rotate a bloated CoValue by creating its current snapshot as a new CoValue and
  swapping the parent reference. Jazz history cannot be compacted in place.
- Version rotated roots, but also re-rotate current roots that exceed a fixed
  replay budget because stale clients may continue writing them.
- Never carry a migration version between roots during recovery. The version
  describes the physical replay history of that specific CoValue.
- Load document content, comments, assets, and presence only after routing.

Tests for startup CoValues should create large histories, rotate them, and assert
that the replacement's transaction count stays within a fixed replay budget.

### Document Content Generations

- Keep the `Document` identity stable. Links, sharing, comments, and list
  membership depend on it.
- Rotate only its active `CoPlainText` after 2,000 transactions.
- Store retired content in `archivedContent`; normal routes must not resolve it.
- Time Machine follows the archive chain ending at the active content and hides
  each successor's seed transaction.
- Preserve comment ranges by rebuilding their operation anchors against the new
  content before editing resumes.
- Wait for sync and reject cutover while another cursor is active.
- Reconcile late archived writes after startup with a three-way merge. Apply
  non-conflicting changes only; conflicting content remains available in Time
  Machine.
- Write document timestamps on editing idle, not for every content transaction.
  Derived title/path/tag fields may write only when their values actually change.
