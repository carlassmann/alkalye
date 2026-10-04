# Causal text undo

This experiment tests the missing text half of whole-document compensation. It does not change the browser controller, server acceptance or wire format.

`document.ts` is a correctness oracle. It keeps insertion and removal provenance, evaluates contributions in descending causal order, then feeds visible identities into the existing Replica renderer. It deliberately rebuilds that renderer; production should keep its existing incremental indexes.

`visibility.ts` is the candidate visibility index. Atom identities already encode insertion ownership. Each deletion records its operation identity, and each cancellation names the operation it cancels. An atom is hidden when its insertion is inactive or any active deletion removes it. An operation is active when none of its active cancellations cancel it. Redo cancels the undo; it does not reinsert copied characters.

A cancellation's clock must exceed its target's clock. The graph is therefore acyclic, and iterative evaluation handles deep histories. Concurrent cancellations remain independent: redoing one cannot disable another. The index allows out-of-order facts for convergence tests; production acceptance must require known targets in the same document and appropriate current authority. Acceptance must reject an already inactive target; an exact retry returns its original receipt rather than accepting another cancellation. The projection still handles branching cancellation facts deterministically.

Snapshots merge immutable facts before replacing state. Effect Schema validates identities, safe clocks and nonempty deletion facts. Canonical output treats removed identities as a set. A malformed batch or conflicting snapshot leaves current state unchanged.

Old snapshots have no deletion attribution. Their deletion marks remain permanent, and a replicated floor disables cancellation of older contributions. The floor affects evaluation regardless of arrival order. Production must fix the floor on the server during migration, before accepting any cancellation, and reject later attempts to raise it. Raising it after accepted cancellation would silently reverse older undo. Legacy deletion owners cannot exceed the floor. Server acceptance must refuse undo below it; silently restoring such deletions could resurrect text removed by another writer. Rebuilding attribution from a retained complete journal is a separate migration option.

Run:

```sh
bun test ./experiments/causal-text-undo/*.test.ts
```

Every real-text scenario compares both implementations through Replica's visible atoms. Tests include overlapping peer deletions, peer anchors inside cancelled insertions, replacements, cold JSON snapshots, frontmatter frame changes and peer edits to the same key. Two hundred seeded graphs combine insertions and removals from three concurrent actors, shuffled delivery and snapshot reopening. A further 100 seeded real-edit sequences restore exact source text and visible identities through cancellation and redo, interleaving earlier cancellations and cold snapshots. A 20,000-step cancellation chain verifies iterative evaluation.

Conscious adoption requires a new cancellation operation kind; per-target CRDT snapshot attribution; same-document target validation; historical reconstruction and revision hashing; compatible client migration; register-only compensation guards; reference checks after text compensation; and server verification that no required part of the original action was omitted. The native HTTP API now fetches original register beforeimages by action identity on demand, without downloading all historical events; the session still needs to adopt it.

Snapshots avoid historical event downloads. They still retain causal state, so their size can grow with editing history. Compacted deletion runs, retention and safe garbage collection require separate measurements and policies.

written with GPT-6 in Codex
