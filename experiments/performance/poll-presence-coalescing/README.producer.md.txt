# Coalesce queued polling presence

Frozen a7bca94. Existing Effect Queue.takeAll; one temporary actor→document set per returned batch. Reverse scan discards superseded presence only within contiguous presence runs; every non-presence control resets keys. Retained order unchanged. All retained recipient/sender session, ACL,10s expiry,presentation attenuation,own flag checks unchanged. No cache/new service/queue redesign.

Actual signed owner+reader, two sender actors/two documents, WebSocket acceptance witness. Six40ms relay-admission-paced rounds24cursorstates; slow polling consumes once. Exactlatest4actor/document states, gone before/after cursor, oneadvanced realmetadata commit/bodyunchanged, queued recipientrevocation→no cursor/twounavailable, allHTTPclose204/serverEffectclose. Baseline39PASS delivers24; candidate39PASS delivers8.

One poll's actual instrumentation counts: sessionSQL25→9; roleSQL58→26. Fresh recipient checks retained; reduction entirely16superseded sender checks. No timingclaim. These are statement counts from installedEffect CurrentTransformer returning unchanged statements/SQLtext withoutparameters. Instrumentation absent from clean2filehandoff. Raw result.after contains later revocation activity; sql-summary derives immediate before/after actualpoll from corresponding logged record.

Strict PASS. Clean new-case39PASS. Clean finalpublicsuite28PASS/1683assertions includes existing queuedrevocation/demotion/presentation/departure/invitations/account-agent attenuation/workspacedeletion. The same instrumented publicsuite also28PASS/1683. Finalclean runtime adds only outside afterAll stoppedDBcopy; permanent test has original publicfixture lifecycle. No users' data/profiles/keys. All owned servers/scopes closed; no browser started.

Exact ClaudeOpus5.5 canonicalfirstParty PASS, no blockers. Reviewer read actualserverbaseline/candidate; did not independently review/run tests. No overflowprevention: Queue.dropping256 still closes1013 beforetake. WebSocket delivery unchanged. Existing fastpoll20writer consume-every-round does not show backlog benefit; no120fps/servercapacity claim. Fullsuite legacy swarm timing lines occurred during untimed correctness and are not performanceevidence.

Initial setup non-gitcwd failure and missingcandidateworkdir failure happened beforeprocess/runtime. Firstpublicfailure20assertions: metadata action actor bareaccountsubject rejectedDocumentConflict; stoppedDB preserved outsideGit, corrected actor suffix on freshisolatedserver. No uncertainmutationreplay. Originalfailuredetails/log retained; SQLtables/cookies/privateDB never copied here.

Production-candidate patch/sourceSHA/testSHA exact in pins.json. Instrumented snapshots/logs separately identified. No production edits/staging by this agent.

written with gpt-6 in codex
