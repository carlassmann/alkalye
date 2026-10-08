# Fresh-open duplicate restoration diagnostic

One real2KiB→128KiB cold library switch, frozen72dd6f5 production core plus source instrumentation. Exact native route/source/editability and independent HTTP accepted source passed. No new import/edit. Passive lookup missed and initial journal was empty. Browser and managed server stopped. First strict compile exposed a diagnostic Crypto dependency leak; captured existing service fixed it, strict and frozen build passed. No production change or reuse implemented.

Built-in Effect EventLog supplies the handler's encoded entry before journal commit. Record and replay both fingerprint the copied identity and payload bytes with existing Crypto service. Both marks identify the same entry SHA88407aeaefe4736136687dfe888747430fbc7a92d35cf7c3f8069bb3ae00cd07 and same134956-byte payload SHAcb7e97fd3e2ca4d5206a079557116cf4ae69866c4540ed1ec1b009cd3689719e.

Record check invokes restoreSnapshot157.1ms; journal replay invokes it again133.5ms. These are distinct sequential spans on the same committed entry. Library624.6ms/session609.7ms contains HTTP snapshot267.5ms, EventLog write161.1ms (including record restore), replay restore133.5ms, materialization23.7ms and forks10.4/9.1ms. Mount18.1ms/editor16.3ms follows acquisition. Nested spans overlap and must not be summed. Hash/mark/CPU-sampling overhead means attribution only, not an unsampled speed comparison or FPS result.

Potential removal of duplicate restoration needs private immutable encoded-byte provenance, not payload identity or document/log/position alone. EventLog encodes before invoking handler; caller mutation during cooperative validation can make raw payload diverge from encoded journal bytes. A future reuse must validate detached decoded bytes, require unchanged empty projection/generation, consume only a committed exact byte match, and discard on write failure/interruption/competing state. Public persistence/mutation/isolation/interruption proof is still required. No shared accepted-replica cache proposed or adopted.

Full marks/spans, exact source/receipts and source instrumentation retained. Full sampled trace remains outside repo with digest. Private keys/profiles/configuration omitted. Work-managed server and background agent-browser stable timeout20000. Command: bun experiments/performance/interaction-matrix/runner.ts /tmp/alkalye-first-open-replay/manifest.private.json from outside frozen runtime.

written with gpt-6 in codex
