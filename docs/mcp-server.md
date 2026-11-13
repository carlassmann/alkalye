# Alkalye MCP server

Alkalye exposes an OAuth-protected remote MCP server at `https://www.alkalye.com/mcp`. Paste this URL into ChatGPT, Claude, Cursor, or any other MCP-compatible client. It uses MCP TypeScript SDK v2 and the modern `2026-07-28` protocol. Legacy 2025-era HTTP traffic is rejected.

## Security model

1. A client starts OAuth; the user signs into Alkalye and approves.
2. The browser sends a signed, short-lived Jazz device proof to the approval route. The recovery phrase and device secret stay on the device.
3. The server records an account-bound grant in `mcpConnections`. Its credential is SHA-256 hashed in Jazz; OAuth tokens wrap the account ID, connection ID and client ID with `ALKALYE_MCP_TOKEN_KEY`.
4. Each MCP request, tool invocation and token exchange checks the grant, including revocation. Tools use `jazz.forUser(accountId)` with the user's policies and account authorship. They never use `withAttribution`.

There are no MCP roles or separate document/space grants. Connected clients have the user's permissions, including future shared documents. The eleven tools below retain their Classic names and input/output schemas.

Jazz v2 sync is server-readable. Alkalye's backend and Jazz Cloud can read synced content independently of MCP. Tool results are disclosed to the connected client/provider. Disconnect stops future requests; it cannot erase content already disclosed. It does not expose or revoke the user's device secret.

The pinned alpha.61 package patch in `patches/jazz-tools@2.0.0-alpha.61.patch` supplies two missing backend operations. `forReqUser` verifies device proofs, audience, expiry, origin and registry admission; `forUser` scopes trusted account delegation through Jazz policies. The patch delegates under `jazz:backend` with the account ID as subject, so writes retain the user's account but identify backend execution. Upstream alpha.61 rejects device accounts in `forReqUser` and exposes `forUser` only for trusted remote backend clients. Remove this patch when upstream supports these operations.

OAuth uses PKCE S256 and binds client ID, redirect URI, resource, and scope. Clients from any provider can authorize. CIMD metadata must use HTTPS, resolve to public addresses, and register the redirect URI.

## Endpoints

| Endpoint                                  | Purpose                                           |
| ----------------------------------------- | ------------------------------------------------- |
| `/mcp`                                    | Modern stateless Streamable HTTP MCP (2026-07-28) |
| `/.well-known/oauth-protected-resource`   | RFC 9728 resource metadata                        |
| `/.well-known/oauth-authorization-server` | RFC 8414 server metadata                          |
| `/.well-known/openai-apps-challenge`      | OpenAI domain-verification token                  |
| `/oauth/authorize`                        | Authorization entry                               |
| `/oauth/token`                            | Code and refresh-token exchange                   |
| `/api/mcp-connections`                    | Disconnect one user connection (DELETE)           |
| `/api/oauth-approve`                      | Approve user-account execution or deny consent    |

## Tool surface

- `list_documents`
- `get_document`
- `create_document` personally or in a writable space
- `update_document` with mandatory revision precondition
- `rename_document` with mandatory revision precondition
- `archive_document`
- `list_comments`
- `add_comment`
- `reply_to_comment`
- `set_comment_resolved`
- `rename_space`

Tool names are action-specific and include MCP read-only/destructive/idempotent/open-world annotations. Local CLI authentication, local file/stdin input, and sync diagnostics are transport concerns, so they are not remote model tools.

## Deployment

Set:

```dotenv
JAZZ_PUBLIC_URL=https://www.alkalye.com/jazz
ALKALYE_MCP_BASE_URL=https://www.alkalye.com
ALKALYE_MCP_TOKEN_KEY=<32 random bytes encoded as base64url>
ALKALYE_OPENAI_APPS_CHALLENGE=<OpenAI portal challenge token>
```

Generate the token key:

```sh
openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
```

Use the same token key across every deployment instance. Rotating it disconnects every client and invalidates outstanding OAuth tokens.

## Replay and revocation

Authorization codes and refresh tokens are protected against immediate reuse within one warm server instance. PKCE binds authorization codes to the requesting client. Because Vercel can run multiple instances, replay detection is best-effort rather than globally serialized.

Disconnect marks only the connection as revoked in `mcpConnections`. The browser authenticates with its device proof; connection rows reject direct client writes. MCP requests, tools, and token exchanges validate that record. The user's documents, memberships, and other connections remain intact. Cross-instance revocation follows Jazz synchronization; requests already running can finish.

Old dedicated-agent connections cannot authorize with the new credential format. Reconnect clients through OAuth. Existing collaborator memberships are left intact; document admins can remove those old accounts through normal sharing controls.

Exercise OAuth, discovery, personal creation, shared non-admin editing, reader rejection, revision conflicts, comments, and disconnect against the deployed origin.

Run `bun run qa:mcp:user <origin>` with that server's token key to exercise OAuth and MCP as a fresh QA user. Set `ALKALYE_QA_DEVICE_KEY_FILE` to a local test-device key file to exercise an account created in the browser. It creates test documents and connections; the remaining connection is intentionally kept to prove revocation is independent.

Run the public endpoint checks after every deployment:

```sh
ALKALYE_OPENAI_APPS_CHALLENGE=<token> bun run qa:mcp https://www.alkalye.com
```

The challenge response is exact plain text with no newline. Set the token supplied by the OpenAI portal, deploy, verify the domain, and keep the value configured during review.

Submission also requires verified developer or business identity, **Apps Management: Write**, and a global OpenAI Platform project. Use the copy, fixtures, and reviewer tests in `docs/chatgpt-plugin-submission.md`.

References: [OpenAI MCP server guide](https://developers.openai.com/plugins/build/mcp-server), [OpenAI authentication guide](https://developers.openai.com/plugins/build/auth), [MCP 2026-07-28 specification](https://modelcontextprotocol.io/specification/2026-07-28).

## CLI

The CLI keeps its command names, flags and JSON envelope. `alkalye auth login --passphrase-file <file> --server <origin>` restores a v2 device account. `auth signup` creates one; `auth passphrase` exports its recovery words. The local `auth/state.json` holds the device key and origin with mode 0600. The key never leaves the CLI: each `/api/cli` request carries a signed Jazz proof for that origin's `/jazz` endpoint. The backend uses `forReqUser`, and checks policies for document, comment, space, theme and asset operations.

The v2 CLI requires an online backend. `--offline` and `--local` fail explicitly; there is no local CLI replica yet. `--sync-peer` remains accepted for command compatibility, but the deployment's `/jazz` endpoint supplies authority. File/stdin input and HTML/PDF rendering run locally. Mutations wait for server durability. Asset transfer currently uses base64 JSON, which remains subject to the host's request-size limit.

CLI invitations are one-use, expire after seven days, and put the token in the link fragment. Only its hash is stored. The resulting membership/grant uses the invite UUID, so revoking an invite removes that grant without affecting other access. CLI document moves and leaving a membership use guarded backend operations because client policies protect those fields. The sharing feature must reuse or reconcile these helpers in `src/cli/sharing.ts`; its browser invite screen is outside this port.

written with gpt-6.1-sol in T3 Code (Codex)
