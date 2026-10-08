# Snapshot partition diagnostic

One frozen c922a8d instrumented cold 2 KiB → 128 KiB switch. Exact native source/route/editability and independent HTTP receipt gates passed. No optimization, speed comparison or whole-app/FPS claim. Servers and browser scopes stopped.

Rich request 3: ResourceTiming TTFB 254.100 ms, body transfer 1.000 ms; decoded 137,686 bytes, encoded 1,777 bytes. Server restore checkpoint 210.409 ms, checkpoint read 13.503 ms, compact serialization 28.255 ms; router/response encode 253.634 ms. No tail rows. Nested spans must not be summed. Existing ACL, validation, cache, durable-log and transaction semantics unchanged.

Client custom transport markers were absent: BrowserLibrary overrides snapshot through the account API. Client JSON/Schema decode remains unmeasured. Router instrumentation does not measure physical gzip: Effect registers compression in a later pre-response hook.

Scoped trace: CrRendererMain only, interaction:start → interaction:end (3,001.074 ms). Ready 499.374 ms; maximum enclosing RunTask 18.280 ms; clipped main-thread GC interval union 20.543 ms. Heap measurements are initial/final points, not peaks. Earlier all-thread/entire-trace summary (24.749 ms GC) is superseded; raw evidence stays outside Git, hash retained.

Initial strict failure shadowed Web Crypto with Effect Crypto.randomUUID; corrected request correlation uses a process-local counter. Corrected strict, build and one runtime gate passed. Logs and exact instrumentation snapshots retained; no source/account identifiers or credentials packaged.

Storage inspection, separately: the target durable head used expanded v2, 32,116,142 UTF-8 bytes; the compact response was 137,686 decoded bytes. This motivates a separately validated compact-writer experiment. It does not prove bypassing validation or modifying existing heads is safe.

written with gpt-6 in codex
