# Twenty authenticated HTTP writers

Frozen application: `78e89af`. Bun 1.4.0, local macOS, separate server and driver processes. Production unchanged. No CPU sampling during measured requests.

Twenty accounts authenticate through public challenge/signature/bearer endpoints. Owner creates one 128 KiB document and writer invitation; nineteen accounts accept it. Each writer privately prepares three causal append actions before timing. Three cohorts target 1 second spacing; each writer has at most one request in flight. The fixture is the existing rich performance fixture with literal backslash-n separators. Markers contain real newline characters.

Sixty requests accepted in 2,495.5 ms: **24.04 completed operations/s**, latency median **258.13 ms**, nearest-rank p95 **471.04 ms**, max **492.58 ms**. Max dispatch lateness 4.35 ms. This short paced journey does not establish sustained saturation capacity.

All receipt positions were contiguous (2–61). Public snapshot and history reached cursor 61; each of sixty markers appeared exactly once. Errors and excluded setup failures remain in the artifacts. No persisted client-session, browser responsiveness, presence, reconnect or 120 Hz claim.

Driver process CPU: 90.7 ms user + 16.3 ms system, RSS 774.8 MiB. Server resource samples bracketed requests with 678 ms before and 883 ms after: 1,946.8 ms user + 109.5 ms system across 4,055.9 ms; max RSS 725.2 MiB. These include boundary slack and are separate process observations, not precise request-stage CPU.

## Reproduce

Freeze the selected checkout and dependencies first. Use a new disposable data directory. Start the server through `work` with this command, then wait for its `server-ready` log before launching the driver:

```sh
bun experiments/performance/twenty-writer-http/server.ts /tmp/twenty-writer-data
bun experiments/performance/twenty-writer-http/experiment.ts http://127.0.0.1:4470 /tmp/twenty-writer-results.json
```

The driver requires a fresh dataset: request IDs are fixed. Server resource JSON records cumulative CPU and RSS once per second; retain samples around the driver's Unix timing boundaries. Authentication material is never emitted into results. The complete driver has a 120 second deadline and each commit a 20 second deadline.

written with gpt-6 in codex
