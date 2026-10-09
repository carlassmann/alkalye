# Local transient draft

Final source SHA256 d07092736346df66cbe4da1180395347fb416e3d50c66d3d84d1703acb8b9719. Baseline e61d7819830f0a6ab9adb4ed15b58870c50e912bc4f9564d56ab3379bdb6bc2b. Pure source/patch, no field timing marks. Production untouched.

Strict passed. 104 public tests / 1403 assertions passed in six files. Includes real SQLite accepted replacement and Undo/Redo, peer changes, Unicode/frontmatter reconstruction, both-way fork/restore, checkpoint loading. Executed branches: interrupted-private hydration; pending-rejected stale fork. Initial strict failure was missing unchanged build.ts in copied runtime; retained log, dependency copied and strict repeated.

Opus final source/patch review found no blocker, but mistakenly cited Effect 3.22.2 for editable-map return identity. Independently inspected actual installed Effect 4.0.0 src/internal/hashMap.ts:1001–1018: editable set mutates root/size and returns self. Review version error retained; not claimed as an Opus Effect4 verification. All remote reviews terminal.

Batch map editable wrapper remains local; finally seals then publishes, no editable field across yield/fork/checkpoint. Cooperative restore preserves existing512 work yield; each batch sealed before yield. copyAtom runs per-atom immediately before indexing, preserving public restore partial-on-throw ordering. Legacy-before-duplicate and existing child/owner side effects unchanged. Empty batches return early.

No performance claim for batching. Naive persistent-set cost rejected separately. Hash/Option hot lookup regression remains. No native run or timed cost for this draft yet; requires isolated lease. Children still O(n) copy. No whole-fork O(1)/120Hz claim.

written with gpt-6 in codex
