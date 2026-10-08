# Cooperative action staging

Action builders copied every atom through synchronous checkpoint encoding and restoration. They now use the existing `Replica.forkEffect` to copy detached state cooperatively. Untrusted checkpoint restoration and action validation stay intact.

A matched production-browser comparison used the 1 MiB document with 512 lines. Each of six phases restored the same disposable SQLite/blob data and browser profile. Phase order alternated. Both clients used the same native `660423c` server. The candidate changed only action staging and the document view's detached-copy capability.

| Trusted undo, milliseconds | Baseline median / max | Fork median / max |
| -------------------------- | --------------------- | ----------------- |
| Two paint opportunities    | 1259.8 / 1312.0       | 626.6 / 700.7     |
| Fully accepted checkpoint  | 3008.3 / 3207.6       | 2605.1 / 2985.3   |
| Largest main-thread task   | 853.7 / 867.7         | 290.3 / 361.5     |
| Layout phase sum           | 4.2 / 4.4             | 4.5 / 4.8         |
| Paint phase sum            | 2.9 / 3.2             | 3.0 / 3.3         |

All six phases verified trusted undo, exact original text, a strictly newer accepted checkpoint, zero pending/rejected actions and durable save readiness. No failed samples. This removes one large JavaScript stall. The remaining tasks exceed the 8.33 ms frame budget by a wide margin. Headless Chromium supplies approximately 60 Hz frame opportunities; these measurements do not prove 120 fps.

Independent Bun module trials, three per phase, measured 128 KiB undo at 70.29→22.85 ms median and 1 MiB undo at 1005.93→386.07 ms. These trials exclude DOM and persistence and must not be added to browser values. Existing undo, register restoration, history and replica-copy suites plus interruption/concurrent-copy, legacy-atom and real durable-view contracts passed. Opus 5.5 found no source blocker.

`results.json` keeps every timing and frozen file SHA. ResourceTiming confirmed each changed hashed chunk URL and its decoded size in all trials. The SHA hashes describe expected files, not cryptographic retrieval of loaded browser bytes. CPU-sampled attribution belongs to separate experiments, not this timing run.

Run `bun experiments/performance/undo-fork/journey.ts CONFIG OUTPUT` against an already launched background `agent-browser` session. CONFIG contains `url`, `session`, `path`, `characters`, and `occurrences`. Copy isolated data/profile seeds and clear service-worker/HTTP/code caches before every phase. Use `AGENT_BROWSER_HEADED=false` and `AGENT_BROWSER_DEFAULT_TIMEOUT=20000` for every browser command. Shared example fixture preparation lives in `editor-critical-setup.ts`; never use the live app's data.

The owned-operation token experiment was rejected. Its final bounded issuer variant regressed module medians and required six source files. `rejected-command.json` retains the final samples. No runtime bypass or token architecture was adopted.

## Empty register inverse

A second, independent pair compared the adopted fork `41716e4` with one guarded argument. When a text undo has no register inverses, `protectedRecords` still checks provenance but receives an empty source. Its returned protection set is unused. This avoids materializing the whole staged document only to discard the result.

| Trusted undo, milliseconds | Fork median / max | Fork + guard median / max |
| -------------------------- | ----------------- | ------------------------- |
| Two paint opportunities    | 672.0 / 699.2     | 545.6 / 560.7             |
| Fully accepted checkpoint  | 2659.6 / 3000.8   | 2241.4 / 2284.4           |
| Largest main-thread task   | 316.1 / 343.8     | 332.3 / 358.9             |

The guard reduces total undo latency. It does not improve the largest task, which remains far above 8.33 ms. Each phase restored identical backend/profile seeds, three trials per variant, no index changes. Every trusted/exact/accepted-checkpoint check passed. `empty-inverse-results.json` retains samples, hashes and the independent module comparison. Do not add medians from the two separate rounds.

The 32 undo/register/history integration contracts passed with 170 assertions; types passed. Opus 5.5 confirmed that BirthRoot, BelowFloor and error ordering remain intact. Production commit `2d95381` changes one argument only. The staged source is still read when register inverses need asset protection.

## Deleted caret anchor

A third independent pair compares `2d95381` with bounded predecessor lookup in the editor. Undo removes the atom at the caret. The previous fallback builds positions for every atom before looking for a surviving neighbor. The candidate resolves nearby anchors first and retains the original global ranking for distant fallbacks.

| Trusted undo, milliseconds | Guard baseline median / max | Caret candidate median / max |
| -------------------------- | --------------------------- | ---------------------------- |
| Two paint opportunities    | 487.1 / 590.2               | 373.8 / 405.3                |
| Fully accepted checkpoint  | 2478.7 / 2501.6             | 2236.5 / 2651.0              |
| Enclosing trusted key task | 0.71 / 0.74                 | 0.69 / 0.70                  |
| Largest main-thread task   | 281.0 / 332.4               | 180.7 / 210.2                |
| Layout phase sum           | 4.2 / 4.3                   | 4.3 / 4.8                    |
| Paint phase sum            | 2.8 / 2.9                   | 2.8 / 3.1                    |

Three trials per variant, alternating phase order, identical backend/profile resets, native server `660423c`. All six phases passed exact text, trusted undo, strictly newer accepted checkpoint and zero pending/rejected actions. The candidate improves main-thread tasks and paint opportunities; its worst accepted-checkpoint latency regresses. Remaining tasks exceed 8.33 ms. Cold document materialization remains a separate blocker.

`caret-results.json` preserves every sample and frozen editor/module hashes. No allocation profiler ran. Minor GC duration totals for the whole undo interval were 177.0/162.6/184.0 ms before and 153.4/166.0/153.2 ms after; these do not isolate caret allocation costs. Public runtime fixture contracts cover caret semantics separately. Do not combine medians across these three independent experiments.
