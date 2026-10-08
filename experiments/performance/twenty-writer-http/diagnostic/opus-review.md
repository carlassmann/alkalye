I've read the relevant code and am writing up the assessment now. Nothing was run or changed.

**Short answer:** extending the terminal cache to a whole run is safe and needed, but on its own it gets almost no hits in this workload. The useful version lets the run attach to any visible anchor atom, with an RGA position rule. Neither one alone fixes your case. There isn't a better incremental mechanism to reuse.

## Why it misses today

- `prepareTerminalPeerEdit` (`src/shared/crdt.ts:225`) only accepts a single atom (`insert.length === 1`, `:244`). Your commits append several characters, so they're always rejected, even when they land at the exact tail.
- It also requires `inserted.after === last.id` (`:280`). With 20 writers appending after the common original tail T, each new run becomes a sibling under T. Siblings are stored in descending id order (`indexAtom`, `:1669`) and traversal is depth-first (`:984`). So a run with the highest id lands right after T, in the middle of the text, not at the end.
- On a miss, `prepare` calls `invalidateText` (`:453`). The next `replica.text()` call in `projectDocument:418` / `sourceDetails:473` then does the full `rawVisibleSteps` + `sourceHeadersSteps`/`sourceAtomsSteps`. That's about 7.5k of the 10.9k samples.
- The server keeps the replica warm between commits (`document-store.ts:2202`, `checkpointInterval=100`), so a hit would actually save that work. Every 100th version restores into a fresh replica and always misses.

## Existing capability

I found no better incremental mechanism. `cachePreparedText` + `replaceAtoms` + `rawEditSplices` + `TextIndex.fork` already handle general splices, including mid-text inserts and raw/source displacement. Only the peer-side prediction is limited. The experiment should reuse that path and add no new structure.

## Smallest experiment

Generalize `prepareTerminalPeerEdit` in place: one private method, revert by deleting it. Hit criteria:

1. `input.length === 1`, kind `text`, no `field`, no `remove`, `1 ≤ insert.length ≤ 1024`.
2. It's a strict chain: `insert[0].after = A`, and each later atom points to the one before it. For every atom, keep the existing checks: fresh id, not in `children` and not `hidden`, no metadata flags, one code point.
3. Find the position by scanning `raw` backwards for A, at most ~8k atoms, otherwise fall back. A must be visible.
   - **Rule 1:** if A has no children, or `children[A][0].id < insert[0].id` (that list includes hidden siblings), insert at `index(A) + 1`. This includes today's exact-tail case.
   - **Rule 2 (optional):** otherwise, if the next lower-id sibling S exists and is visible, insert at `index(S)`.
   - Otherwise fall back. The case "lowest sibling, insert at the end of A's subtree" needs subtree extent, and walking the chain is O(depth).
4. Source mapping: build one raw splice and run `rawEditSplices` the opposite way. Require alignment, which in practice means the run lands after the last header block.
5. Content offset: the source index if `atoms.length === content.length`, otherwise `sourceOffsets.get(atoms)?.offsetAtCodePoint`. Missing index means fall back.
6. Frontmatter: offset must be greater than the header length. `touchesSourceFence(content, off, off)` and `touchesSourceFence(next, off, off + len)` must both be false. `sourceHeader(next)` must keep the same length.
7. Add diagnostic-only hit/miss-reason counters, then rerun the same 20×3×60 benchmark and compare the `rawVisibleSteps` sample counts.

**Oracle:** in an integration test, compare `replica.text()` on every commit against `new Replica().restore(checkpoint).text()`, plus the metadata/sourceDetails output.

## Semantic pitfalls

- **Hit rate depends on clocks:** a writer that hasn't seen its peers' runs gets a lower id, so Rule 1 misses. Rule 2 only helps when S is visible. Measure the hit rate before trusting the gain.
- **Hidden siblings and anchors:** the max-id check has to include hidden children. If S is hidden, the position is unknown, so fall back. A hidden A isn't in `raw`, so fall back.
- **Removal arriving before the insert:** check `hidden()` on every run atom, not just the first. Keep the `active(operation.id) === false` guard for cancels that arrive first.
- **Concurrent header blocks:** `sourceAtoms` concatenates body ranges that sit between headers. A raw position before a later header block doesn't map by displacement, so `rawEditSplices` alignment must reject it.
- **Fence creation:** a run that contains `\n---` or completes a `--` line has to be caught by the line-level fence check on `next`.
- **Surrogate pairs:** offsets must come from `TextIndex`. `cachePreparedText` already forks the index, so this only matters when computing `next`.
- **Batched commits:** if a commit's `changes` holds more than one op (e.g. text + set), it falls back. Count those misses.
- **Stale prepared edits:** `preparedEdit ?? …` takes priority. A leftover one is safe because of the id/signature guard, but it hides the peer path. Log it.
- **Permissions/summary:** these are unaffected, since `projectDocument` still derives everything from `text()`. The guard is only correct if the oracle passes.

## Remaining cost after a hit

- `content` slice+concat and the `replaceAtoms` copy are both O(n), but cheap.
- `documentMetadata` + `frontmatter()` parse the full 131k text twice per commit. `sourceDetails` also runs `body.replace(...)` over the whole body just to get a 72-character excerpt (`workspace-projection.ts:485`), and `wikiTargets(body)` scans it all. That's the next target, separate from this change.

## Tests to add

- Two writers appending at the same tail in both id orders and both arrival orders.
- A run whose lower sibling S is hidden (should fall back).
- A doc with two concurrent header blocks plus a body append.
- A run containing `---`.
- A remove that arrives before its insert.
- A run with surrogate pairs.
- A multi-op batch.
- The version-100 restore boundary.
