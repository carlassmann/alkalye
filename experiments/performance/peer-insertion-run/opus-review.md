The patch is small and falls back safely in most cases, but I wouldn't call it a sound experiment yet: no oracle, unproven gain, one contract break. I found no hole that would leave a wrong cache in the scenarios you listed. This was a read-only source review; nothing was run.

The diff against production is minimal: one private method, plus one extra `??` in `prepareApplication` (production `src/shared/crdt.ts:158`).

## Blockers

1. **Input is read before the Schema check runs.** `preparePeerInsertionRun` (`/tmp/alkalye-peer-run-source/crdt.ts:347-374`) runs before `prepare()` calls `parseOperation`. Malformed input throws a `TypeError` instead of the Schema error that `apply`/`applyTogether` throw today: missing `remove`, `insert` as a non-array object with `length`, or a `null` atom. State isn't corrupted (the throw happens before any commit). Fix: copy the terminal path's `Array.isArray`/`typeof` guards (`:233-238`, `:278-279`).
2. **No oracle that proves soundness.** It's source-only with no runtime check. The minimum: in tests, after `cachePreparedText`, rebuild through `invalidateText` + `visible` + `text` and assert the same `atoms`, `raw`, `content` and `TextIndex` offsets. Run that across a random concurrent-header/hidden/emoji corpus.
3. **The gain isn't measured and coverage looks narrow:**
   - The single-atom mid-document insert (probably the most common peer keystroke) still rebuilds, because of `insert.length < 2`.
   - Emoji documents without a cached `TextIndex` always fall back (`:393`).
   - The work is still O(n): two backward scans from the end, `content.slice` + concat, `replaceAtoms`. Only the constants shrink compared with a rebuild.

   Measure how often real peer ops hit this path before keeping it.

## Edge risk (same gap exists in `prepareReplacements` today)

- `touchesSourceFence` uses the regex `^---`, so it misses lines starting with `\uFEFF---`. `sourceHeadersSteps` detects header frames at any root `\uFEFF` atom in the raw text, not only at the start. Example: a second root chain (two offline first writers) has a `\uFEFF--` line and a later `---` line. Inserting `-` after the BOM creates a mid-body header frame. The view would then move it to the top, but the `sourceHeader(next)` check only looks at the start of the text. Fix: use `^\uFEFF?---` in the guard.

## Public contract matrix

| Case                                                                | Correct RGA / view                             | Run path                                                                    | Verdict                                              |
| ------------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------- |
| Run outranks every sibling of the anchor (hidden siblings included) | right after the anchor                         | `anchorPosition+1`                                                          | ✅                                                   |
| Higher siblings hidden, but their descendants visible               | after their subtrees, before the lower sibling | splices at the visible lower sibling                                        | ✅                                                   |
| Next lower sibling is hidden                                        | before its first visible descendant            | `rawStart<anchorPosition` → fallback                                        | ✅ fallback                                          |
| Run is lower than every sibling                                     | after the last sibling's subtree               | `boundary` undefined → fallback                                             | ✅ fallback                                          |
| Anchor hidden, or anchor is root `""`                               | —                                              | anchor not found → fallback                                                 | ✅ fallback                                          |
| Pending descendants of run atoms                                    | they join the run's subtree                    | `children.has(atom.id)` → fallback                                          | ✅                                                   |
| Removal arrived before the insert                                   | atoms hidden                                   | `hidden(atom.id)` → fallback                                                | ✅                                                   |
| Cancellation arrived before the insert                              | op inactive                                    | `active(op.id)===false` / `hidden` → fallback                               | ✅                                                   |
| Duplicate or self-anchored atom ids in the run                      | rejected                                       | `validateIdentities` throws, edit discarded                                 | ✅                                                   |
| Concurrent canonical headers (raw frames before or after the body)  | view merges them at the top                    | neighbour check on unique ids at the displaced index; misaligned → fallback | ✅ (sound only for a head-only shift; misses safely) |
| Insert at or before the header end, or into an empty body           | header/close rules change                      | `offset <= header.length` → fallback                                        | ✅                                                   |
| Insert creates or breaks a `---` fence                              | header set changes                             | fence check on old/new lines + header-length equality                       | ✅ except the BOM case above                         |
| Deleted-header view (body only, `raw !== atoms`)                    | body shifts                                    | neighbour check stands in for the terminal path's header requirement        | ✅ by argument; needs a test                         |
| Emoji / surrogate pairs                                             | code-point offsets                             | per-atom 1–2 unit check; `TextIndex` or the all-BMP fast case; index forked | ✅ (falls back without an index)                     |
| Legacy multi-character atoms                                        | rebuild                                        | `legacyTextTargets` → fallback                                              | ✅                                                   |
| Parse changes the op (atom expansion, normalisation)                | —                                              | signature mismatch → no cache                                               | ✅                                                   |
| Leftover local `preparedEdit`                                       | —                                              | run path skipped; id/generation check                                       | ✅                                                   |
| `applyTogether` / forks sharing arrays                              | no cross-replica mutation                      | new arrays; WeakMaps keyed per array; index forked                          | ✅                                                   |
| Malformed input                                                     | Schema error                                   | `TypeError`                                                                 | ❌ blocker 1                                         |

## Smallest sound reversible experiment?

Structurally yes: private, additive, one call site, everything else falls back. It becomes a sound experiment once you:

- add the input guards (blocker 1),
- add the BOM fence fix,
- add the differential rebuild oracle in tests (blocker 2),
- measure hit rate and latency on real peer traces before keeping it (blocker 3).

If the hit rate is low, extending the path to single-atom mid-document inserts is the real lever. That would change the scalar path you wanted to keep as is, so treat it as a separate decision.
