# Per-paragraph bidi alignment CSS review evidence

One outside CSS change: `[data-editor-line] { unicode-bidi: plaintext }`. Production untouched by this agent. Native textarea already uses plaintext; block overlay children previously reset paragraph resolution. First partial line's explicit inline isolate/direction remains authoritative.

## Verified scope

Original **six** long-RTL static points, not twelve: full-control horizontal errors 9.67/42.47/9.23px. Same outside static six after CSS ≤0.5px. Separate 12-point CSS corpus with baseline production viewport: long RTL and mixed Latin/RTL/frontmatter/bold/code, full and regular window; all source exact, max horizontal 0.406px/vertical0.5px. Source pins distinguish actual runtime and unchanged production modules. Fixture is a public EditorElement with real Replica seed; no app storage/HTTP/permission/durability or performance claim.

Coherent trusted-click corpus with prototype outer lifecycle listeners passed12; after restoring exact production EditorElement,14789 was **11/12**. Long-RTL regular65536 clicked65597 (61 units late), despite computed alignment<0.5px. This failure remains HOLD. Earlier sequential11/12 mixed-rich vertical drift preserved separately. Do not aggregate these into all-pointer parity.

Isolated fresh65536 click96802 passed. Actual textarea inner scroll remained0, native2181 preserved, host and window top compensated≈551px before pointerdown. No full native-value expansion. This non-reproduction is not a fix; capture can flush layout/change timing.

Sequential isolation25610: eleven clicks exact, last refused before keys because geometry changed across RAFs. Observable readiness57800: ten clicks exact, next recheck unstable before keys. Pending viewport idle/reveal behavior remains unassigned; no unknown document mutation (selection-only fixture). All processes and browsers closed.

Opus17238 terminal0: no CSS source blockers. Known separate risks: directionMark skips bidi marks/isolates/scripts; inherited RTL neutral lines; run/wrap boundary affinity; local-caret border side. Bounded pointer successor remains rejected/HOLD for held native direction and gesture coverage. No full interaction,120fps or clipboard claim.

## Reproduction

Use outside runtime with production baseline viewport resolver (server without `--ordered`). `bun pointer-visible-css-coherent-click-run.ts` serves real editor CSS and SourceTextarea. Waits same-task native/visible alignment stable across two RAFs before trusted clicks. `pointer-isolation-*` captures actual native/default/RAF states; no setters wrapped or native selection fabricated. Original source archive lineage36f6a76; viewport/overlay/editor/CSS unchanged through roote7d5661 before this proposal. Core Replica fixture remains runtime-pinned; no application cutover claim.

written with gpt-6 in codex

Parent adopted only the one CSS property after reviewing native paragraph alignment and unchanged textarea/viewport code. This corrects the demonstrated horizontal mismatch; the independent viewport idle/reveal handoff remains unresolved. JSON witnesses retain their original bytes with `.json.txt` names; `archived-file-paths.json` maps the original manifest names. No pointer lifecycle prototype adopted.
