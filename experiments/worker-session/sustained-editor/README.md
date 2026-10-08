# Sustained actual editor worker proof

The main thread stayed responsive. Worker work did not keep up with human typing: 72 keys left 38 queued edits, then needed another 8.6 seconds to drain. This finite experiment does not establish a bounded backlog.

Production unchanged. Tested the corrected actual `EditorElement` worker prototype from `71eac8c`, copied to `/tmp/alkalye-worker-sustained/runtime`. Its main editor, SourceTextarea, bindings, queue and worker source hashes are retained. Native Bun backend, IndexedDB journal, signed browser account and two actual worker DocumentSessions; both sessions share one origin/account/journal. This is not a 20-client or production-app performance result.

| Arm              | Events                                 | Actual interarrival median/max | Enclosing input task p95/max | Largest main task through drain + 3 s | Worker task max | Queue peak | Post-command local drain |
| ---------------- | -------------------------------------- | ------------------------------ | ---------------------------- | ------------------------------------- | --------------- | ---------- | ------------------------ |
| Human keyboard   | 72 trusted keydowns + beforeinputs     | 103.9 / 106.1 ms               | 1.51 / 2.70 ms               | 2.70 ms                               | 399.20 ms       | 38         | 8.60 s                   |
| Rapid text entry | 72 trusted beforeinputs, zero keydowns | 0.90 / 2.30 ms                 | 1.07 / 2.16 ms               | 2.80 ms                               | 395.83 ms       | 68         | 11.27 s                  |

One run per arm; event-level quantiles are correlated within each run. Human input used one background agent-browser command batch: native `press` characters, each followed by a requested 100 ms timer. Burst used one `keyboard type` command. Installed agent-browser 0.38.1 claims key events for that command, but the retained small public DOM probe observed only trusted beforeinput/input events. The burst is accurately scoped as native text entry, not a keyboard-event proof. No synthetic input events were dispatched.

Every run used the actual 800 px viewport, bounded native textarea (2,080 characters), 1,048,606-character source and real line breaks. Input tasks are complete enclosing top-level RunTasks, including microtasks. All main tasks include typing, observable local queue drain and three seconds of aftermath. Worker tasks are separate. Trace categories have no CPU sampler. Headless rAF ran at approximately 60 Hz; these measurements do not establish 120 Hz presentation.

Main heap observations (approximate `performance.memory`, not total process or worker memory): human 23.5 MB initially, peak 156.4 MB, final 97.1 MB; burst 55.3 MB initially, peak 216.5 MB, final 17.4 MB. Each pending command retains its expected source, and the unchanged prototype returns a complete source per acknowledgement. These costs remain in the experiment. Queue depth/ack lag are sampled every 50 ms; drain time is a driver/polling upper bound, not exact journal commit latency.

Four peer prefix edits ran through a second real worker. One peer request was in flight during typing; peer completion and final adoption happened later. This does not establish peer acceptance or visible delivery during typing. `peerTimes.replaced` was recorded after peer Sync, so it is a completion timestamp, not an action-mutation timestamp. Main thread tasks during final peer merge and verification are outside the timed window.

After timing stopped, both arms passed exact editor/worker source, all four peer markers, zero pending/rejected/unsaved, independently reconstructed public server snapshot SHA-256 and exact receipt-position increment of 76. Human server position 1→77; burst 78→154 (global backend positions). Both actual worker sessions then closed with network blocked; primary worker reopened the shared-origin journal and reconstructed the exact source. Network unblocked in `finally`. This proves the journal reopen, not independent per-peer storage isolation. The compact snapshot endpoint forwards ordinary signed authorization to the public snapshot API; graph decoding/hashing runs in the server process after timing.

Retained failure: the first paced `keyboard type` run preserved every character and passed source/server/reopen gates, but its combined assertion failed because keydown count was zero. It is not included as a successful keyboard arm. A single corrected human-keyboard run used native `press`. The key probe, original result/failure and Opus review remain alongside the successful runs. Opus review identified these measurement boundaries; no production protocol was changed to improve numbers.

Reproduce from the corrected runtime copy, verify its source hashes, replace only the included fixture/server/driver files, then:

```sh
bun node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
WORK_STATE_ROOT=/tmp/alkalye-worker-sustained-work-state work run web
# Use the complete localhost URL printed by work logs web.
bun sustained.ts 'http://localhost:PORT/?size=1048576' ../human-peer-keys.json human-peer
bun sustained.ts 'http://localhost:PORT/?size=1048576' ../burst-peer.json burst-peer
python3 ../parse.py ../human-peer-keys.json
python3 ../parse.py ../burst-peer.json
WORK_STATE_ROOT=/tmp/alkalye-worker-sustained-work-state work stop web
```

Agent-browser defaults remain 20,000 ms for every command. Observable queue/gate waits are bounded, without replaying actions on observation timeouts. Types passed. Both browser contexts closed and managed server stopped. Full traces remain at the paths/hashes in `traces.json`; compact raw observations and top-level summaries are committed.

Next gate: a deliberately longer load must show bounded admission/backlog and durable lag under sustained typing. UI task isolation alone is insufficient. The prototype needs measured queue/acknowledgement improvements before production adoption.

written with gpt-6 in codex
