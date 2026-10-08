# Residual worker profile — UNRUN

One separately sampled candidate Undo using the same frozen core/marked fixture and fresh known seed. Preserve trusted z, exact source/all ranges/caret/API acceptance, worker URL and loaded-byte pins. Do not mix sampled timings with the no-sampler pair.

First reuse existing agent-browser profiler categories devtools.timeline,disabled-by-default-devtools.timeline,toplevel,blink.user_timing,v8,disabled-by-default-v8.gc,disabled-by-default-v8.cpu_profiler (already used in repository diagnostic runners). Parse Profile/ProfileChunk on the actual dedicated-worker pid/tid and confirm samples/worker-editor.js frames are present. If none are captured, retain that failed attribution rather than reading page samples as worker cost. A subsequent explicit-target CDP Profiler session is a fallback, requiring installed/tooling verification first; preserve target URL/session identity. No alternative engine instrumentation or architecture. Check available installed tooling before launching.

Correlate profile timestamps with retained trace's unmarked worker RunTask at~132ms after z. Report sampled self/inclusive stacks separately; do not sum ancestor and descendant costs. Distinguish Undo command, projection/replay, source materialization, fork/copy, checkpoint/codec and GC only when samples identify them. Add minimal stage marks to the existing fixture only if callback attribution remains opaque. Main-thread sampler does not establish worker costs; callback name alone is not attribution.

No runtime or profile launched; explicit CPU lease required.
