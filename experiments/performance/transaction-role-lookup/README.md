# Transaction-local role lookup

Outside candidate, frozen679f04c. accessRole reuses one authorized lookup only for identity.subject===requestedsubject and identity.access===undefined. Same existing read transaction; no cache. Other-subject/scoped admission and unscoped result lookup unchanged.

Strict PASS. Real public SQLite/HTTP/WebSocket/poll suites:28PASS/1657assertions, including self/cross-subject/scoped/excluded authority, revoke/regrant, queued presence revocation/demotion, invitations/departure/account-agent attenuation/workspace deletion. Exact Claude Opus5.5 semanticPASS; formatting-onlyHOLD resolved by repo Prettier.

One matched instrumented20writer pair, all sessions ready before phase reset; every peer consumes readiness/new presence. Both arms786assertionsPASS,120commits,4offline/reconnect,independentreader refusal/final snapshot. All server scopes closed. Instrumentation only uses installed Effect Statement.CurrentTransformer, returns unchanged statement, counts SQL text without parameters. No scoped-advanced patch.

Actual SQL counts: edit-only9360→4680 for1200advanced; presence-only14192→7100 for1140presence; combined21956→10986 for1200advanced+1140presence. Session authentication remains near-identical. Workspace SELECTs dominate: edit4680→2340, document2400→1200,grant2280→1140. Small difference in poll batching changes check totals; fixed broadcast/notice stages halve exactly. No stale authorization cache.

Instrumented n1 HTTP commit p95~237→218ms,max324→286ms; not unmarked baseline or robust speed claim. Phase durations contain real synchronization; aggregate authorization elapsed durations overlap and are not CPU. Presence sender cadence honors existing40ms admission and waits actual all-peer consumption: not25Hz saturation. Raw offeredAt timestamps retained. Actual productionBrowserLibrary/phone20writer capacity remains unmeasured.

Diagnostic future candidates must preserve fresh sender/recipient ACL and queued revocation. No production adoption/migration in this evidence. Initial prior mixed-startup20writer699proof is separate and not a pure presence measurement.

written with gpt-6 in codex
