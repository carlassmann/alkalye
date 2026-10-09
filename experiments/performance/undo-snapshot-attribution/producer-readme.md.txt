# Production marked Undo / snapshot chronology

One instrumentation-only actual production 1MiB input+Undo diagnostic, fixed7d7df3dcfb8179915c5b214e1392e955e63d7430. Exact native/source/caret, independent advancing HTTP seed/edit/Undo receipts and reload PASS. Source/Undo hash0ba3f77995fce57ab0142bbb058e5413468afd515c1b2592079091656a89091b; input hash7be7ff8f2d74dbaa5e1642cb1197b5d62ded5450b3dc09654285a6dd696ebe4d. No latency comparison, physical paint or retained-allocation ownership claim. No sampling/forcedGC. All owned resources closed.

Common Chrome clock, milliseconds from trusted action:

| Undo milestone | Time |
| --- | ---: |
| Durable Undo completion | 20.048 |
| Inverse projection cache hit | 21.231 |
| Model source assignment | 21.335 |
| Native render return | 26.800 |
| Exact frame opportunity observed | 28.782 |

Undo took the existing inverse cache; no full Projector fallback or certified token/link metadata construction. Native render occupied5.465ms after model assignment; observer opportunity is separate. Earlier unmarked n3 cannot assign its entire readiness regression to parsing/GC.

| Snapshot stage, ms | Input | Undo |
| --- | ---: | ---: |
| Borrowed atom-array wall span | 26.413 | 31.565 |
| Largest overlapping MinorGC in borrowed stage | 0.712 | 1.082 |
| Compaction wall span | 171.880 | 185.656 |
| MinorGC events overlapping compaction | 9 | 9 |
| Largest overlapping MinorGC span | 9.587 | 10.709 |
| Ownership output span | 0.114 | 0.039 |
| Materialization encode span | 0.089 | 0.034 |

Input certified token/link metadata interval2.070ms, no overlapping MinorGC. Snapshot compaction starts430.601ms after input,418.983ms after Undo; late GC overlaps this phase. This identifies execution/GC overlap, not retained allocation owner. The temporary borrowed array may survive into later collection; its observed stage has no >8.33ms GC. Avoid promoting the speculative streaming-array candidate solely from this trace. Current Schema.Unknown checkpoint encoding is not a full checkpoint traversal. Previous expected-ID/pieces/ordinal variants remain held/rejected.

Full3s maximum main task input10.056ms, Undo11.346ms; main busy interval unions725.395/684.063ms. Whole-task durations include nestedGC, do not add GC events or stage durations. Marker spans include cooperative scheduling, not pure self CPU. Checkpoint cooperative() yields through Effect.yieldNow only; it does not consult BackgroundWork.betweenChunks. The16ms timeout belongs to stats work. BeforeSnapshot gates admission with idle100ms / timeout10s; no mid-checkpoint input pause exists. One-key aftermath cannot establish sustained-input starvation/admission; a separate marked paced-input witness is needed before scheduling policy changes.

Three setup failures preserved: direct unmarked root entry digest mismatch,4499 origin mismatch against4498 profile, missing copied block-sockets.js dependency. All occurred before trusted keys. Corrected known4498 origin, dependency guards and isolated fresh copy; no account/doc creation or uncertain mutation replay. First parser attempted an optional Undo sourceSelection field; KeyError retained in tool history; final parser uses optional retained field while actual native Undo gate remains executed.

Root reference entry975b170156faf1a3118288ac61a5f3d6f0a64bc37b5745a27e0a98a038b67a48 differed from the freshly built frozen source f4d144e9b354382cc2b69154440bf79c71f1c9de5dc6878a3fdcd26063c8f931. Gate passed only after51 JS dependencies mapped bijectively: exact executable bytes after normalizing quoted relative hashed JS references and nonexecuting debugId comments; each corresponding source map's sourcesContent AND mappings identical. Source/map/path-derived hashes differ, not source behavior. Actual marked source/dist and fetched route-resource digests retained independently. Requests are not execution coverage.

Producer-manifest maps source/proof files to SHA256/bytes. Raw traces, private keys/profiles/DBs/manifests excluded. Raw traceSHA/bytes retained in marked-analysis. Source-only prep README's4499 intent was corrected before successful run; final wrapper/server producer uses4498. This is an inert evidence archive, not a standalone runtime.
