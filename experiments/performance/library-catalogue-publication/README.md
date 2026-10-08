# Unchanged catalogue publication

Two authenticated HTTP refreshes through BrowserLibrary, real IndexedDB and the local SQLite server produced four new catalogue references before this change and zero afterward. The observer deliberately compares references: Effect 4 Stream.changes uses structural equality and hid this distinction in the initial diagnostic.

Schema.toEquivalence compares the complete catalogue shape, including optional remote log/position, workspace avatars, document metadata and links. SubscriptionRef.updateSome suppresses exact unchanged publications; refresh/failure state still publishes separately. Current schema coverage was inspected against mergeCatalogue: its only top-level fields are workspaces/documents; remote document fields differ from CatalogueDocumentSchema only by log/position; local directory rows introduce no undeclared fields. State consumers refresh views or derive permissions; none waits for compose as a completion acknowledgement.

The same observer receives a real workspace rename. Integration also covers authenticated failure/clearing, permissions, durable rejected edits, offline reload, reconnection and interrupted transport. Full check: 706 tests, six integration suites, types/lint/format passed; the final observer-live assertion was rerun through the integration journey afterward.

This is a publication-count result, not a measured latency or frame-rate improvement. Merge/allocation still occurs, and the added equality comparison is linear in catalogue size. Opus review and raw public journey outputs are retained here.

written with gpt-6 in codex
