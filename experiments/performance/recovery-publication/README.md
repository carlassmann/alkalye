# Recovery publication and durable draft lifecycle

Two-file candidate on frozen059da17. Recovery updateSome/modifySome suppress healthy success and same-instance failure no-ops, preserving real failure/clear and newer-failure rejection. After actual dequeue/removeDraft, protection updates and public session.changes emits the existing content revision. No content-version bump, reactive abstraction, catalogue comparison or timer added.

Strict PASS. Real SQLite public DocumentSession corpus:15PASS/180assertions, including25new assertions. Public EventJournal.withLock wrapper holds AFTER the delegated transaction returns; independent SQL reader finds the exact proposed edit entry and public operation identity before saved fiber interruption. Hidden-page lifecycle signal triggers retry: no duplicate receipts; pending→Saved notifications have the same content revision; protection clears. Controlled real journal-write failure retains source/protection, explicit retry emits real failure clear, scope releases protection, independent offline reopen matches recovered source.

Prior protection-only variant fails with expected MissingSavedSignal at3s: updating protection alone leaves public Saved status unwitnessed. Original failures retained: wrong actor/account fixture; version comparison across legitimate replay; holding journal.write inside the enclosing SQL transaction (interruption rolled back, not a durable duplicate bug); incorrect diagnostic binary schema; optional operation narrowing. Corrected gate explicitly verifies actual after-commit provenance before interruption. No physical transaction interruption claim.

Existing IndexedDB/HTTP browser module runner passes exact321 assertions: projection/snapshot/notification recovery, optimistic navigation protection, interrupted journal-lock action, failed-close recovery, ACL, offline replay, native Undo and resource release. This existing corpus is not the specific production DOM hidden-after-durable-commit Saved/beforeunload case. That focused gate remains separate. The runner's incidental MEASURE output is retained raw, not a speed comparison.

Opus11359 held protection-only version for missing Saved signal; focused85868 terminal0 found no source blockers after the explicit same-version notification. Installed Effect4 APIs independently verified. Root owns adoption/full checks. Snapshots formatted with repository config after executed proof; semantic delta unchanged. No benchmark/frame/120fps claim; separate matched059 publication count gate required.

written with gpt-6 in codex
