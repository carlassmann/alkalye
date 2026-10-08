# Bounded compaction string assembly: hold

Production unchanged. The candidate replaces per-atom output string concatenation with joins of at most 512 pieces, then one final join per compacted run. It retains the existing identity, anchor, flag, surrogate and 2,000,000 UTF-16-unit limit checks. Singleton runs skip joins. Checkpoint ownership, schemas and Effect scopes remain unchanged.

Three read-only Opus reviews found no typed-Atom correctness blocker. The final review recommends holding until fragmented-run performance and the many-line pending-save asymmetry are understood.

## Runtime proof

Candidate: 15 deep checkpoint/session tests, 1,651 assertions; strict types pass. Both cooperative modes use real SQLite and public DocumentSession operations. Four middle insertions create fragmented runs with supplementary Unicode. After save and scope close, the test independently reads DocumentJournal.cache and decodes its checkpoint with Replica.fromCheckpointEffect before reopening; journal fallback cannot conceal a corrupt snapshot. Source, discussion and cancellation survive reopening. Existing checkpoint tests cover ownership, concurrent mutation, interruption and lone-surrogate atom identities.

The initial session fixture inserted lone surrogates. Both baseline and candidate failed identically during sync with `Operation identity is immutable`. Logs and reconstructed input specification are retained. The original failed source snapshot was not retained; no original source hash is claimed. Valid Unicode replacements pass. This separate baseline defect remains unresolved.

## Native experiment

Twelve cells: three alternating matched baseline/candidate trials for each retained 1 MiB fixture. Browser sources frozen at bf517046; identical frozen 0e13876 native Bun backend. Each arm restores the same stopped database/profile snapshots. Histories are retained, not fresh graphs. Each trusted native append and Undo passes exact source hashes, save-state gates and an independent observer read with cleared local document journals. No CPU sampling during these timings.

`long1m` is a long wrapped paragraph. `mc1m` is a many-line TOKEN source control; this experiment appends one character, not a multicursor edit. Its raw graph fragmentation was not counted.

The traces separately cover native input and Undo through three seconds of aftermath. Metrics use the owning main thread and complete RunTask intervals, including microtasks. Busy time is the union of top-level task intervals. Nested child durations are inclusive and must not be added together. Entry app.js SHA was checked per cell; dependency hashes describe persisted builds, not individually verified loaded responses. Raw traces remain at paths recorded with SHA in provenance.json.

| Median                           | Long baseline | Long candidate | Many-line baseline | Many-line candidate |
| -------------------------------- | ------------: | -------------: | -----------------: | ------------------: |
| Input task, ms                   |         7.408 |          7.030 |              4.289 |               4.792 |
| Input aftermath largest task, ms |        20.073 |         20.324 |             19.700 |              10.018 |
| Undo largest task, ms            |       253.649 |        227.710 |             29.543 |              29.647 |
| Undo busy union, ms              |     1,648.784 |      1,408.164 |            780.465 |             769.289 |

Long input tasks above 8.33 ms: baseline 20/17/18, candidate 0/3/3. Long Undo: 21/24/22 versus 4/8/5. These counts and busy unions separate at n=3; worst-task ranges overlap. No robust worst-case Undo or input-latency improvement is established.

All three many-line baseline post-input observations still show one pending action; candidate observations show zero. Subsequent accepted edit/Undo gates pass, but the measured aftermath work may differ. Treat that comparison as confounded.

Heap samples are main JS heap after input, not total process memory or peak: long medians 700→643 MB, many-line 635→815 MB. No consistent heap improvement. RAF arrays do not agree with trace stalls and are unsuitable for frame-budget conclusions.

The largest Undo task is almost entirely a script callback. Its FunctionCall location maps to document-app.ts:2658, scheduleRefresh, in both frozen builds. Nested minor GC is small; compaction is not directly attributed by these unsampled traces. A separate sampled diagnostic is needed. Lower task counts cannot establish reduced allocation or GC causality.

The final run join remains opaque up to 2 million UTF-16 units. Truly fragmented atom runs and that upper boundary lack performance proof. These are headless observations, not physical 120 Hz or full-app cutover proof.

## Replay

Snapshots are `.ts.txt` to keep exploratory code outside production type checking. Copy into a disposable source tree with real mutable directories and read-only node_modules dependency link. Apply candidate-model.ts.txt only to src/shared/model.ts; keep both arms otherwise identical. session.test.ts.txt lives at that tree's root. The browser harness uses retained disposable authenticated profiles/database fixtures under /tmp/alkalye-production-allocation-oct8; these credentials and databases are not committed. Use `work` for servers and background agent-browser with stable 20000 ms default timeout. Preserve failures; never retry an uncertain mutation.

written with gpt-6 in codex
