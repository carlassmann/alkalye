# Raw Markdown and native textarea newline offsets

Experiment only. Production unchanged by this artifact.

Browser textareas normalize CRLF and lone CR to LF. The old viewport painted raw projected text but treated native offsets as raw offsets. The existing 109-character projected fixture therefore returned source caret 84 at requested EOF 109. Cached and fresh Projector versions reproduced it; projection itself was correct.

The candidate keeps raw Markdown and projected offsets unchanged. Existing TextIndex summaries count normalized lengths and line breaks, including CR/LF across tree leaves. The viewport maps native offsets through that index and normalizes only the painted fragment. LF offsets retain an identity fast path. Nonrepresentable offsets inside CRLF canonicalize after LF.

Native edits widen the entire adjacent CR run when inserting or deleting would otherwise merge visible newlines into raw CRLF. Adjacent blocks rebuild to avoid splitting a new CRLF. Native measurements normalize CRLF and lone CR to LF; DOM-range offsets use the existing TextIndex mapping. No invisible measurement placeholders remain. Public TextIndex line APIs retain their prior behavior; the viewport uses explicit native-line methods.

Strict types passed. The final formatted-source runtime passed 145 public SourceTextarea assertions, eight trusted native edit cells with exact raw source/caret and reconciliation back to the original source, and 14 actual EOF geometry pairs (three EOL cases and 11 hard-break widths 56–66). CRLF, lone CR and LF produced identical visible mirror caret rectangles and scroll maxima with production editor CSS. Different raw block partitions produced no extra reachable blank end.

Before the fixture-only global border-box correction, a separate 1MiB LF journey admitted eight trusted characters. Source, caret and bounded EOF fragment remained exact. SourceTextarea input-listener durations were 0.3–0.7ms in this one journey; these exclude complete browser tasks, CRDT and app refresh work. They are not app performance or 120fps evidence.

Initial failures remain: missing copied build module, non-module fixture server, missing trusted-input focus and a changed managed server port. Earlier viewport geometry and LF measurements lacked the real `#editor`/`data-editor`/`editor-wrap` CSS host. Those visibility and timing claims are invalidated. Final geometry additionally includes production global border-box. Its absence caused an apparent LF/CRLF hard-break wrapping failure at width 61; the corrected host passes every width. Earlier placeholder and incomplete CR-run variants are rejected, with their source snapshots retained separately.

Reconciliation is not CRDT Undo. Actual app Undo, persistence, multicursor and OS IME remain production gates. Source hashes identify the exact executed snapshots. Final source uses the repository formatter before the final native runs. Read-only Opus review 82913 completed: no blockers. Earlier review 96269 rejected incomplete consecutive-CR handling and placeholder measurements; those findings are corrected in the final candidate.

Run the copied fixture server through `work run web`, then use its actual direct HTTP port:

```sh
CRLF_URL=http://localhost:PORT/ bun tests/browser-crlf.ts
CRLF_URL=http://localhost:PORT/ bun tests/browser-geometry.ts
CRLF_URL=http://localhost:PORT/ bun tests/browser-lf.ts
bun x tsc --noEmit
```

written with gpt-6 in codex
