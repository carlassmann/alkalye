# Source text experiment

Run `bun test ./experiments/source-text/*.test.ts`.

The source remains the only metadata authority. This experiment combines a character CRDT with bounded minimal splices, deletion ownership, operation cancellation for undo, causal slots for structured field actions and shared first-header fences. Effect Schema defines events and snapshots; native EventLog and SqlEventJournal persist them through Bun SQLite. Twenty tests include exhaustive short-string diff checks, seeded multi-writer delivery, peer deletions, immutable atom identities, stale editor bases, slot ancestry and native event replay in both orders.

Only the bounded splice calculation is adopted by the application's ordinary body-edit path. Distant edits now retain untouched atom identities, comment anchors and intervening peer edits. The experimental cancellation, slots and fences remain outside production.

Opus rejected the structured-header seam for full parity. A deleted generation can hide unseen peer-created fences while leaving its fields in the body; fences depend on a local BOM anchor; undo does not cancel shared fence creators; first-header creation loses CRLF style; a character diff can cross entry boundaries when deleting similar keys; flow-map rewrites need one shared conflict scope. Conflicting duplicate atoms now fail before mutation instead of making replicas diverge, and snapshots and returned changes cannot mutate live atoms. Shared-fence identity conflicts still need actual merge semantics rather than rejection. Arbitrary raw typing against structured field actions, header deletion/recreation and incomplete YAML remain integration gates.

The application's current frame implementation separately retains four known failing concurrency specifications in `tests/frontmatter.test.ts`. Passing this experiment does not resolve them. The native replay fixture covers successful slot and undo cases, not the rejected header lifecycle cases. Source tombstones and causal bookkeeping still grow; snapshot loading and history compaction need separate measurement and review.

written with GPT-6 in Codex
