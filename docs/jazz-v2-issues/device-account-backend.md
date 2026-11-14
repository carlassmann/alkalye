# Support device proofs and account delegation on custom backend routes

Jazz `2.0.0-alpha.61`. Unsubmitted API request. Alkalye uses
`authenticate: acceptDeviceAccounts` and local-first device accounts. Custom
sharing, import and CLI routes need the requesting account's policy-scoped
DB. MCP needs the same scope after checking its own revocable OAuth connection.
See [backend configuration](../../src/jazz/server.ts),
[sharing route](../../src/pages/api/sharing/[action].ts) and
[MCP connection handling](../../src/mcp/jazz.ts).

## What fails

In the unpatched SDK, `createJazz().forReqUser(request)` calls the external
`authenticate` callback. `acceptDeviceAccounts` returns null there, so a valid
device proof admitted through sync still gets a signed-out error on a custom
route. `accountFor` and `withAttribution` use that same callback. The in-process
`Jazz` interface has no `forUser(accountId)`.
See upstream [create-jazz.ts](https://github.com/garden-co/jazz/blob/v2.0.0-alpha.61/packages/jazz-tools/src/backend/create-jazz.ts).

The remote trusted client's `forUser` resolves backend identities. Alkalye needs
to delegate to an existing device account UUID after authenticating an MCP
connection. Attribution alone does not supply a policy-scoped user database.
See upstream [backend clients](https://github.com/garden-co/jazz/blob/v2.0.0-alpha.61/packages/jazz-tools/src/backend/create-jazz-session.ts).

## Current workaround and evidence

Our [Bun patch](../../patches/jazz-tools@2.0.0-alpha.61.patch) adds:

- Device-proof handling in `forReqUser`: allowed origin, device admission,
  configured audience, SDK signature/expiry verification and registry lookup.
- Trusted in-process `forUser(accountId)` through `backendDbForSession`, retaining
  policy enforcement. Callers must authorize the delegation first.

Both paths attribute the account using backend identity `jazz:backend` with
account UUID as subject. They do not attest a device signature on each backend
edit. The patch and upstream `backendDbForSession` establish this behavior.

[Device route tests](../../src/jazz/device-routes.test.ts) exercise actual
approval/sharing handlers with valid, forged, expired, foreign-audience and
foreign-origin proofs. [MCP tests](../../src/mcp/server.test.ts) cover policy
isolation and revocation. Reproduce from Alkalye with `bun install`, then
`bun x vitest run src/jazz/device-routes.test.ts src/mcp/server.test.ts`.
Removing the patch removes the APIs those tests exercise.

## Requested API

Support device proofs on custom routes through `forReqUser`, and trusted
account-UUID delegation on the in-process backend. Keep the same audience,
origin, admission, policy and attribution guarantees. This would let Alkalye
remove its only Jazz SDK patch.

written with gpt-6.1-sol in T3 Code (Codex)
