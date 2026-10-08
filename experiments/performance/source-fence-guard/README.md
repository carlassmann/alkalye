# Source-fence checks during multicursor editing

`Replica.prepareReplacements` checks whether edits touch Markdown source fences. For multiple ranges it previously scanned the surrounding line and ran a regex twice per range, even when neither source contained a literal `---`. The guard proves those matches impossible before skipping the loop. One replacement retains the original direct checks. Frontmatter, bounds, Unicode, identity and permission validation remain intact.

A matched production-browser comparison froze `74fd39f` and changed only this guard. Both clients used the same native `660423c` backend. Every phase restored identical SQLite/blob and browser profile seeds; HTTP, service-worker and code caches were removed. Five corrected trials per variant and case used trusted keyboard input, exact source checks, causal undo and strictly newer fully accepted checkpoints with zero pending/rejected actions.

| Enclosing trusted input task, ms | Baseline median / max | Guard median / max |
| -------------------------------- | --------------------- | ------------------ |
| 128 KiB, one selected token      | 3.24 / 3.28           | 3.10 / 3.19        |
| 1 MiB, one selected token        | 3.75 / 3.85           | 3.82 / 4.43        |
| 1 MiB, 2,048 selected tokens     | 29.02 / 29.16         | 26.73 / 28.22      |

The multicursor task improves by about 2.3 ms median. The ordinary 1 MiB control varies slightly upward despite retaining the original single-edit path. Five trials are a small sample. This is a narrow gain, not a 120 fps result.

| Largest task including three-second aftermath, ms | Baseline median / max | Guard median / max |
| ------------------------------------------------- | --------------------- | ------------------ |
| 128 KiB                                           | 10.01 / 10.24         | 10.19 / 10.92      |
| 1 MiB, one token                                  | 9.96 / 10.74          | 9.55 / 10.10       |
| 1 MiB, 2,048 tokens                               | 52.80 / 53.97         | 52.27 / 53.30      |

Deferred tasks still exceed 8.33 ms. The trace captures whole enclosing `RunTask` intervals, including the trusted beforeinput dispatch; nested durations are not added. No CPU sampling profiler ran. The headless browser provides approximately 60 Hz frame opportunities.

Six initial setup attempts hit the browser driver's textarea-center visibility deadline before timing. Virtual textarea centers can be covered or outside the viewport. Setup was corrected once to focus and select through the public source interface, then await the focused selected token. All failures and the three successful earlier controls remain in `results.json`, excluded from the common-setup comparison. Included phases are before 1/2/3/4/6 and after 2/3/4/5/6. No timing outcome determined inclusion.

The nine public Replica contracts passed on both versions, 28 assertions each; types passed. Cases cover separators assembled by disjoint edits, literal body fences, frontmatter creation/removal, BOM/CRLF, Unicode, checkpoint restoration, stale atom bases, multiple writers and causal undo. Opus 5.5 confirmed that the guard cannot change fence results: every regex match requires literal `---` in the same previous or next string.

`results.json` preserves all samples, failures and frozen hashes. Observed hashed CRDT module URLs matched expected files; expected file hashes are not cryptographic retrieval of loaded browser bytes. No allocation claim follows.

Run `bun experiments/performance/source-fence-guard/journey.ts CONFIG OUTPUT` against an isolated production server and already launched background agent-browser session. CONFIG follows `editor-critical.ts`; a fixture name containing `single` selects one token, otherwise all occurrences. Set `CRITICAL_TRIALS=1` for each reset phase. Restore both backend and browser seeds between phases. Every browser command must use `AGENT_BROWSER_HEADED=false` and `AGENT_BROWSER_DEFAULT_TIMEOUT=20000`. Never use the live app's data. Chrome trace files remain under `/tmp/alkalye-fence-guard`.

Production source and public contracts: `37c90a5`.

written with gpt-6 in codex
