# Alkalye MCP server

Alkalye exposes an OAuth-protected remote MCP server at `https://www.alkalye.com/mcp`. Paste this URL into ChatGPT, Claude, Cursor, or any other MCP-compatible client. It uses MCP TypeScript SDK v2 and the modern `2026-07-28` protocol. Legacy 2025-era HTTP traffic is rejected.

## Security model

1. A client starts OAuth; the user signs into Alkalye and approves.
2. Alkalye sends the user's Jazz account ID and secret to the hosted server over HTTPS. The passphrase stays on the device.
3. The server encrypts the credentials with `ALKALYE_MCP_TOKEN_KEY` and creates a private, revocable connection in the user's Jazz root.
4. MCP tools open that same Jazz account. Existing group permissions apply, including documents shared with a non-admin user. Edits and comments belong to the user.

There are no MCP roles or document/space grants. Connected clients have the user's permissions, including future shared documents. The available tools cover documents, comments, and space renaming; they do not expose every app feature.

The server can decrypt the wrapped account secret and content. This is remote execution, not browser-only end-to-end encryption. Tool results are disclosed to the connected client/provider. Disconnect stops future requests; it cannot erase previously disclosed content or revoke a secret already copied by the server operator.

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
PUBLIC_JAZZ_SYNC_SERVER=wss://your-sync-server.example
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

Disconnect marks only the connection as revoked in the user's private Jazz root. MCP requests, tools, and token exchanges validate that record. The user's documents, memberships, and other connections remain intact. Cross-instance revocation follows Jazz synchronization; requests already running can finish.

Old dedicated-agent connections cannot authorize with the new credential format. Reconnect clients through OAuth. Existing collaborator memberships are left intact; document admins can remove those old accounts through normal sharing controls.

Exercise OAuth, discovery, personal creation, shared non-admin editing, reader rejection, revision conflicts, comments, and disconnect against the deployed origin.

Run `bun run qa:mcp:user <origin>` with that server’s token key and `PUBLIC_JAZZ_SYNC_SERVER` to exercise OAuth and MCP as a fresh QA user. It creates test documents and connections; the remaining connection is intentionally kept to prove revocation is independent.

Run the public endpoint checks after every deployment:

```sh
ALKALYE_OPENAI_APPS_CHALLENGE=<token> bun run qa:mcp https://www.alkalye.com
```

The challenge response is exact plain text with no newline. Set the token supplied by the OpenAI portal, deploy, verify the domain, and keep the value configured during review.

Submission also requires verified developer or business identity, **Apps Management: Write**, and a global OpenAI Platform project. Use the copy, fixtures, and reviewer tests in `docs/chatgpt-plugin-submission.md`.

References: [OpenAI MCP server guide](https://developers.openai.com/plugins/build/mcp-server), [OpenAI authentication guide](https://developers.openai.com/plugins/build/auth), [MCP 2026-07-28 specification](https://modelcontextprotocol.io/specification/2026-07-28).

written with GPT-6 in Codex
