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
