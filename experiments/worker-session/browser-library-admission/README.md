# Worker admission/FIFO native proof

Outside reversible experiment. 38 fixture assertions passed across two real browser workers; strict types passed after two retained compiler failures. Native SourceTextarea, IndexedDB worker authority, real HTTP accepted-source oracle and same editor FIFO.

First phase: typed text, authoritative Undo, metadata after pending native edit, old-epoch queued edit followed by writer refresh, independent connectivity hints, reader→writer fresh notice, clean scoped Close. Second: metadata adoption held by a Deferred; reader admission immediately froze and retained exact native draft before held command resolved; late candidate refused; Close preserved recovery.

These admission changes are main hints under one owner account. They do not prove separate-owner server ACL revocation. Standalone factory is not production BrowserLibrary/document-app cutover. Full EditorElement commands, peer merge, actual offline reopen, worker death, main-tab crash and performance remain unproved. Known Undo receipt replay after epoch refresh/eviction remains untested.

Source: frozen production2cc core plus changed src files refreshed from1b630c8; explicit worker connectivity/Editor/scheduler/sourceDifference adaptations retained. Old runtime23 and its final rejected review remain immutable. Earlier source reviews found blockers; executed review1917 terminal0 found one blocker: Undo/metadata could execute while native draft differed from FIFO after a refused replacement. This executed variant remains HOLD. A successor guard was written outside, but is not certified by these38assertions.

Commands: `bunx tsc --noEmit --project /tmp/alkalye-browser-worker-open/runtime-admission/tsconfig.json`; managed `work run web`; `WORKER_LIBRARY_URL=<disposable URL> bun tests/browser-worker-admission.ts`; `work down`. Stable background agent-browser timeout20000. No production changes.

written with gpt-6 in codex
