# Provide a supported device-account persistence recipe for Node and Bun CLIs

Jazz `2.0.0-alpha.61`. Unsubmitted integration request, not a claim that Jazz
has no native persistent storage.

Alkalye's browser uses `createJazzClient` with `localFirst: "now"` and
`jazz-tools/local-first`. Its CLI currently calls authenticated HTTP routes and
rejects `--offline` / `--local`. See [browser setup](../../src/app/main.tsx) and
[CLI runtime](../../src/cli/runtime.ts). Offline CLI editing from the Classic
implementation remains unported.

The default Wasm runtime uses a durable SharedWorker in the browser. Its Node
path opens a direct runtime; a persisted node-identity lease does not itself
persist application rows. See upstream
[default-runtime-source.ts](https://github.com/garden-co/jazz/blob/v2.0.0-alpha.61/packages/jazz-tools/src/runtime/default-runtime-source.ts)
and [DB construction](https://github.com/garden-co/jazz/blob/v2.0.0-alpha.61/packages/jazz-tools/src/runtime/db.ts).
Separate native backend clients do support persistent drivers, as exercised in
[backend-clients.integration.test.ts](https://github.com/garden-co/jazz/blob/v2.0.0-alpha.61/packages/jazz-tools/src/backend/backend-clients.integration.test.ts).

A direct copy of the browser session setup also fails outside the browser with
`createAccountManager requires an AccountStore outside the browser`. The guard
is in [account-manager-core.ts](https://github.com/garden-co/jazz/blob/v2.0.0-alpha.61/packages/jazz-tools/src/accounts/account-manager-core.ts).
This is a missing host configuration, not evidence that supplying an
`AccountStore` is enough to persist rows.

## Current workaround

CLI phrases become device keys stored in a mode-0600, origin-bound auth file.
Each command mints an audience-bound device proof for `/api/cli`; the backend
uses `forReqUser`. Local file rendering works without a replica.
[Runtime](../../src/cli/runtime.ts), [handler](../../src/pages/api/cli.ts).

## Requested recipe

Show how a Node/Bun CLI can reopen a device account, retain rows and pending
writes across process exits, edit while disconnected, then synchronize with
browser clients under the same policies. Include account-key storage and the
supported native client entry point. Alkalye has not validated that complete
path; its CLI error's blanket statement about Node/Bun persistence is too broad.

written with gpt-6.1-sol in T3 Code (Codex)
