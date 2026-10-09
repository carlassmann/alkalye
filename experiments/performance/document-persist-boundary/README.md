# Document persistence interruption boundary

Public DocumentSession plus a transparent DocumentJournal/EventJournal adapter, real Bun SQLite client journal and independent WorkspaceStore transport. Deferred barriers hold before or after the actual journal `withLock` returns. No production hooks, replacement journal, fake clock or masks. Two cases passed 20 assertions; strict types passed. Sources and logs remain outside as well as this archive.

Before commit: interruption leaves the edited source intact; sync and cold reopening retain it, and the accepted position does not advance. After commit: the interrupted caller initially sees the edited source, but replay/sync/cold reopening recover exactly one Undo. The accepted position advances once; repeated sync adds nothing. These checks establish the local/durable boundary, not physical paint or complete worker recovery behavior.

The first probe paused after `write` but still inside SQLite's outer `withLock` transaction. Its assumed post-commit outcome failed because interruption rolled the transaction back. That invalid assumption and the initial unused-import type failures are preserved outside; their paths, sizes and hashes are retained. The corrected probe pauses after the enclosing lock returns. No uncertain mutation was repeated: each case has a fresh temporary store and client directory.

An interrupted fiber is not proof that a committed action was unapplied. Callers must retain unknown-completion identity and reconcile before retrying. Experimental Worker UndoQueued source classifies interruption as unknown; its end-to-end behavior at this exact boundary is not yet proved. Opus review of the adapter and caller policy is pending. No production persistence change adopted.

Written with gpt-6 in codex.
