# Two actual browser writers

One successful pilot, frozen production `1b630c8`, two independent browser profiles/accounts, one shared 2 KiB document. This differs from the earlier signed HTTP twenty-writer workload: both participants here use the actual production app, SourceTextarea, durable client journal and live transport. Twenty actual browser writers remain unmeasured.

Setup follows the existing native app test: owner creates source publicly, authenticates a workspace writer grant for the second account, and both real editors become writable with exact accepted source. Native selection keys establish actual remote presence labels. Each editor receives one trusted native insertion. Both visible sources and a separately reconstructed authenticated HTTP snapshot converge exactly, preserve the seed, contain both additions, and advance the accepted cursor. Local pending/busy gates settle. There are no synthetic text input events. Setup fill is untimed.

| Observation                                       |    Result |
| ------------------------------------------------- | --------: |
| Primary native input enclosing task               |  2.062 ms |
| Primary largest task across 3 s                   |  3.389 ms |
| Primary aftermath largest task                    |  3.389 ms |
| Primary 3 s busy task union                       | 87.963 ms |
| Writer 0 → writer 1 source next-frame opportunity |   67.0 ms |
| Writer 1 → writer 0 source next-frame opportunity |   72.7 ms |

These are one small-document pilot, not sustained capacity or a physical 120 Hz guarantee. Peer timestamps indicate source observed on a subsequent rAF opportunity, not completed paint. The final snapshot request is outside the interaction window and does not measure server commit latency. Separate primary/peer heaps are endpoint observations, not allocation ownership.

Strict types, production build, native event-count/trust/type gates, permissions, real presence and exact convergence all pass. Both browser contexts and the own managed server close at completion. User phone data/processes are untouched.

Resource provenance has a limitation: the script-initiator ResourceTiming filter records the entry and stats worker, but misses dynamic document imports. Their emitted file hashes are retained separately as build provenance; they are not claimed as loaded execution hashes. New session-unique profiles use immutable assets on a private origin.

`result.json` retains exact gates, receipts and epoch observations; `analysis.json` retains all task/window metrics. `two-writers.trace.json.txt` preserves the full raw timeline exactly, archived as text to avoid formatter mutation. No CPU sampler ran. The runner is archived source, requiring its copied frozen runtime and private standalone work directory. Production code is unchanged by this experiment.

Next gate: repeat the same genuine editor/accounts path with twenty active browser writers, independent interactive latency, accepted lag/convergence, separate server CPU and browser/host resource observations. Twenty Chromium contexts may contend on this host; that must remain explicit.
