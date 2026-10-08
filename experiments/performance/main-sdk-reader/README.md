# Original SDK independent server reader

Frozen original `a749728a8f9a1cb984c980a5ea2daf984d60ae68`; actual installed Jazz SDK and original model schemas. One existing Welcome document, 1,813 UTF-16 units. This proves independent reader/schema/import compatibility, not a 2 KiB seed adapter or performance comparison.

The successful arm captures the existing public editor source, keeps its normal browser connection alive, then starts a NEW Bun SDK worker process. It uses default in-memory storage and a fresh SDK session, with `asActiveAccount: false`. The public Document.load/deep subscription reads the actual sync server and matches both exact string and SHA-256. No browser IndexedDB/profile clone supplies reader state. The worker naturally exits zero after shutdownWorker, then browser and both own managed servers close. No explicit content edit, account or document creation occurs in this read arm. Existing pending browser publication can complete normally.

Receipt: `22cead3570892ac612c124d5005d49f99d50dfa15db178bbf625adb5ccb2268c`, 1,813 units, exact source.

Failures preserved: account creation navigated away from settings, so a settings-only readiness selector was wrong; generic `/app` did not establish the expected sidebar new-button gate; the automatic Welcome document is deliberately nonempty and correctly refused empty-source seed eligibility. Most importantly, initial own sync port 4226 did not match the pinned bundle's embedded 4220. Earlier UI account observations were local only. The successful arm retains the exact same account/profile/doc and starts own port 4220, without rebuilding or rewriting the original assets. These are harness readiness/configuration failures, not original application crashes or measured latency.

Credentials, private configurations, profiles and databases are excluded. Logs contain phase/digest summaries only. Source/script hashes are retained as provenance, not a claim that every emitted module has an execution hash. Archives remain outside production type inclusion. The public SDK reader actually executed; seed-empty did not. No performance timers or twenty-client workload ran. Phone processes/data stayed untouched.

Next gate: controlled one-time public SDK creation/seeding, retaining its known ID, followed by the same independent read. Only then can the original adapter seed matched larger fixtures and join the interaction comparison.
