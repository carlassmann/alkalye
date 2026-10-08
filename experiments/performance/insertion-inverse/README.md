# Middle insertion Undo: retained inverse views

Outside prototype; production adoption belongs to the parent agent. Current production `da0714c8924af5781f7ea0d837cb2868621582d8` versus exactly that source plus the reviewed CRDT/editor patch. Effect 4.0.0. Both actual local server and production browser builds switch with the arm. Three trials per arm, alternating order, independently restored identical browser/database seeds.

One trusted `x` in the middle of a rich 1 MiB document, accepted durable save, then trusted Undo. Each input and Undo observes all main tasks over three seconds. No CPU sampling in these six trials. All six pass exact accepted seed/input/Undo hashes, advancing server cursor, exact native cursor and bounded native textarea.

| Main-thread measurement            | Baseline median / maximum | Candidate median / maximum |
| ---------------------------------- | ------------------------: | -------------------------: |
| Input enclosing task               |        19.741 / 19.798 ms |         18.061 / 19.657 ms |
| Input aftermath largest task       |        13.222 / 13.473 ms |         14.085 / 14.266 ms |
| Undo entire-window largest task    |      256.885 / 261.632 ms |         20.420 / 22.764 ms |
| Undo entire-window busy task union |    1657.261 / 1730.884 ms |     1440.763 / 1445.577 ms |
| Main heap after input              |          643.1 / 649.2 MB |           610.8 / 639.0 MB |

Candidate still exceeds the 8.33 ms frame budget. Input aftermath maximum worsens modestly. Heap samples are observed endpoint process state; they do not identify retained allocation owners. Headless 60 Hz cannot demonstrate physical 120 fps. The three-second window includes persistence/refresh work; overlapping trace children are not additive.

The private last insertion receipt restores exact immutable pre/post source/raw views and strings after ordinary identity/visibility validation. It survives only identity-validated all-known acknowledgement with exact prior generation/views. New operations clear it. Forks carry one bounded receipt. Exact source-view pairs also carry the deleted scalar's UTF16 position, eliminating the full editor anchor scan. Existing terminal removal behavior is unchanged. Legacy weighted text, special framing atoms, orphan descendants and unproven placement fall back.

Strict outside types and 19 public contracts, 199 assertions pass. The real SQLite DocumentSession proof uses the actual native editor's public `replace` boundary: accepted original ACK, Undo restores the exact pre-view/offset, Redo restores exact post-view, final Undo/save/reopen preserves document and discussion in cooperative/plain modes. Direct public Replica contracts cover ASCII/Unicode/frontmatter, peer/sibling operations, hidden child, forged identity, mixed acknowledgement, detached fork, cold restore and pre-arrival cancellation.

Failures remain:

- Initial types lacked the copied `build.ts` dependency; corrected strict candidate check passes. A separate accidentally invoked root type check is not candidate evidence.
- Initial tests incorrectly assumed `prepareReplacements` accepts lone surrogates; the existing boundary rejects them. Corrected public contract verifies rejection and unchanged state.
- A pre-arrival cancellation cannot be restored from a checkpoint before its target exists; the corrected oracle checks the interim source and reconstructs after target arrival.
- Both real Session full-source Unicode `edit` eligibility checks failed. Source remained exact, but this older full-source path does not prepare an insertion splice. Those failures are retained. This optimization is restricted to eligible published insertion receipts; no full-source-edit speed claim.
- Work setup initially lacked its standalone Git root, then port 4461 was occupied by the retained managed allocation fixture. Both are setup-only failures, without trusted input. Corrected run is `timing-corrected.log`. The known predecessor was restored afterward as PID 19740.

Opus 5.5 initially found ASCII index eligibility and shared-fork certificate overwrite blockers. Both were fixed; follow-up found no semantic blocker and approved proceeding to runtime contracts. Tests then assert actual ASCII receipt use and distinct fork post-views.

Separate earlier frozen 5c sampled diagnostic established the motivating rAF work: 208.208 ms largest task, rawVisibleSteps 117.080 ms self and editor positions 15.417 ms self. Sampling/inclusive timings overlap; it is not part of the six current-production timings. Full raw traces remain in `/tmp/alkalye-rich-undo-certificate/app`; their hashes and compact phase summaries are retained here. Archives contain the exact runner, parsers, candidate patches and public fixtures, not production imports.

written with gpt-6 in codex
