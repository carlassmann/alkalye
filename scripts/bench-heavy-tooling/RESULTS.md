# Deferred tooling results

Baseline `9e82548`, candidate `codex/defer-heavy-tooling`. Production builds, same browser and synthetic library. See [README](README.md) for reproduction and conditions; raw samples are in `evidence/`.

Plain editing no longer evaluates Shiki, its 19 grammars, Mediabunny or JSZip. Shiki loads on highlighting use and retains a shared highlighter/theme cache; preview renders readable code while loading or after a load error. Native AVC/AAC capability probes share one cached promise, recover from probe errors and avoid importing the converter. Video conversion imports Mediabunny after validating input. Markdown export stays independent of ZIP tooling; archive import, export and theme upload import JSZip when needed.

## Initial JavaScript

Bytes below come from Resource Timing on a cold HTTP-cache run, including the document-save worker. Gzip uses the benchmark server's default compression, not a production CDN's Brotli policy.

| Payload                 |      Before |       After | Change |
| ----------------------- | ----------: | ----------: | -----: |
| All initial JS, gzip    | 1,671,832 B | 1,347,725 B | -19.4% |
| All initial JS, decoded | 5,916,489 B | 4,098,842 B | -30.7% |
| Main JS, gzip           | 1,584,709 B | 1,260,602 B | -20.5% |
| Main JS, decoded        | 5,658,937 B | 3,841,290 B | -32.1% |

Deferred chunks: Shiki 1,331,350 B decoded / 195,898 B gzip; Mediabunny 387,402 / 97,040 B; JSZip 97,535 / 30,479 B. They are absent from every plain-editor resource list and appear in the corresponding first-use samples. All three remain in the service-worker precache. This reduces initial page downloads and evaluation, but does not reduce the complete offline installation download.

## Startup usability

All times in milliseconds. Each cell shows median / p95; seven samples per row. p95 is the maximum at this sample count. Negative percentages mean shorter times.

### Correct editor content visible

| Condition         | Before median / p95 | After median / p95 | Change median / p95 |
| ----------------- | ------------------: | -----------------: | ------------------: |
| 1× cold-http      |           297 / 432 |          292 / 357 |      -2.0% / -17.4% |
| 1× cached-http    |           248 / 319 |          250 / 308 |       +1.0% / -3.5% |
| 1× service-worker |           231 / 315 |          215 / 256 |      -6.9% / -18.7% |
| 4× cold-http      |         1206 / 1721 |          796 / 895 |     -34.0% / -48.0% |
| 4× cached-http    |         1234 / 1586 |          770 / 911 |     -37.6% / -42.6% |
| 4× service-worker |         1351 / 1534 |          762 / 798 |     -43.6% / -47.9% |

### Editor unobstructed by hit testing

| Condition         | Before median / p95 | After median / p95 | Change median / p95 |
| ----------------- | ------------------: | -----------------: | ------------------: |
| 1× cold-http      |         1078 / 1087 |        1050 / 1071 |       -2.6% / -1.4% |
| 1× cached-http    |         1106 / 1151 |        1072 / 1073 |       -3.2% / -6.8% |
| 1× service-worker |         1102 / 1153 |        1066 / 1079 |       -3.2% / -6.4% |
| 4× cold-http      |         1724 / 2325 |        1430 / 1565 |     -17.1% / -32.7% |
| 4× cached-http    |         1389 / 1666 |        1502 / 1663 |       +8.1% / -0.2% |
| 4× service-worker |         1522 / 1856 |        1432 / 1574 |      -5.9% / -15.2% |

### Unique edit confirmed

| Condition         | Before median / p95 | After median / p95 | Change median / p95 |
| ----------------- | ------------------: | -----------------: | ------------------: |
| 1× cold-http      |         1979 / 2125 |        1868 / 1918 |       -5.6% / -9.7% |
| 1× cached-http    |         1980 / 2082 |        1873 / 1897 |       -5.4% / -8.9% |
| 1× service-worker |         1979 / 2074 |        1845 / 1892 |       -6.8% / -8.8% |
| 4× cold-http      |         3294 / 3921 |        2234 / 2436 |     -32.2% / -37.9% |
| 4× cached-http    |         2748 / 3083 |        2345 / 2483 |     -14.6% / -19.5% |
| 4× service-worker |         3113 / 4179 |        2223 / 2420 |     -28.6% / -42.1% |

Native-speed editor readiness barely changed. The unchanged splash still holds access near 1.05–1.10 seconds, masking most potential startup benefit. Verified editing includes browser CLI round trips; its small native-speed change is not a clean measure of human typing latency. The 4× editor-ready observations improved, but other tasks shared the host and the runs were sequential, so timing deltas cannot be attributed solely to this change.

## Cached document switching

Destination content and a typed edit were required. Seven switches at each CPU setting. This change does not improve navigation architecture; the 4× runs regressed and provide no basis for claiming a switching gain.

| Condition / endpoint | Before median / p95 | After median / p95 | Change median / p95 |
| -------------------- | ------------------: | -----------------: | ------------------: |
| 1× ready             |           152 / 286 |          115 / 144 |     -24.1% / -49.6% |
| 1× interactive       |           597 / 714 |          553 / 613 |      -7.3% / -14.1% |
| 4× ready             |           621 / 651 |          729 / 804 |     +17.5% / +23.5% |
| 4× interactive       |         1106 / 1186 |        1394 / 1454 |     +26.0% / +22.6% |

## First use

Seven samples per operation, fresh page realm, native CPU, warm HTTP cache, worker bypassed. Times include the operation, not just loading its module. No cold mobile-network first-use claim is made.

| Operation                             | Before median / p95 | After median / p95 | Change median / p95 |
| ------------------------------------- | ------------------: | -----------------: | ------------------: |
| Highlight TypeScript code             |           142 / 215 |          149 / 222 |       +5.3% / +3.2% |
| Export 101 documents as ZIP           |         2352 / 4134 |        1253 / 1681 |     -46.7% / -59.4% |
| Convert 1-second AVC/AAC video        |           170 / 231 |          131 / 239 |      -22.7% / +3.3% |
| Import one Markdown document from ZIP |             34 / 36 |            55 / 84 |    +60.1% / +131.2% |

Syntax first use adds about 8 ms at the median. Archive and conversion variation includes Jazz loading, codec execution and shared-host scheduling; lazy loading is not evidence of faster ZIP generation or encoding. ZIP import ends when the new sidebar entry appears, followed by verification of the imported editor content. Its disposable document is moved to trash before the next sample; those final import-only runs retain tombstones and were performed after all startup/switching measurements.

## Correctness and offline checks

- All measured startup/switching runs confirmed a unique edit in the requested document.
- Baseline and changed exports contain 101 identical filenames and contents: SHA-256 `5571a1333721ceb5880934cd1c4395d6ad3f2624c57f100c5000262e0bfe9846` (ZIP timestamps excluded).
- Offline reload, hit-tested editor access and typing passed with a controlling service worker.
- First-use highlighting, ZIP import/export and video conversion passed offline after precaching, each from a fresh page realm.
- Blocking the highlighter chunk left readable code; a subsequent fresh visit restored colored highlighting.
- `bun run build` and `bun run check` passed: 79 test files, 949 tests, zero type/lint errors. Existing lint warnings remain.

Unit coverage includes all existing syntax themes and language aliases, archive import/export and theme parsing, plus new capability-cache concurrency, rejection/retry, unsupported-browser and invalid-input tests.

written with GPT-6 in Codex
