# Alkalye MCP server

Alkalye exposes an OAuth-protected remote MCP server at `https://www.alkalye.com/mcp`. It uses MCP TypeScript SDK v2 and the `2026-07-28` protocol, with the SDK's 2025 compatibility path enabled.

## Security model

```text
Human Alkalye account
  └─ encrypted AgentConnection metadata
       └─ server-wrapped Jazz credentials for “My ChatGPT”

Document or space Group
  ├─ human: admin
  └─ My ChatGPT: reader or writer
       └─ remote MCP tools run as this Jazz account
```

- The human account secret and passphrase never leave its device.
- The agent is a normal Jazz participant, one per user and provider.
- Jazz group membership is the only document/space authorization system.
- A personal-document policy can grant read or write access to all current and future personal documents.
- The connector decrypts granted content in memory. Tool results are sent to the model provider.
- Removing membership blocks future decryption. It cannot erase content already disclosed to a provider.
- The credential stored in the user's Jazz root and OAuth tokens is AES-256-GCM wrapped with `ALKALYE_MCP_TOKEN_KEY`.
- OAuth authorization codes use PKCE S256 and bind client ID, redirect URI, resource, and scope.
- CIMD client metadata is fetched only from configured client-host suffixes and its registered redirect URI is enforced.

## Endpoints

| Endpoint                                  | Purpose                                         |
| ----------------------------------------- | ----------------------------------------------- |
| `/mcp`                                    | Streamable HTTP MCP                             |
| `/.well-known/oauth-protected-resource`   | RFC 9728 resource metadata                      |
| `/.well-known/oauth-authorization-server` | RFC 8414 server metadata                        |
| `/.well-known/openai-apps-challenge`      | OpenAI domain-verification token                |
| `/oauth/authorize`                        | Authorization entry                             |
| `/oauth/token`                            | Code and refresh-token exchange                 |
| `/api/agent-connections`                  | Provision an isolated Jazz agent                |
| `/api/agent-grants`                       | Maintain the agent's discoverable resource list |

## Tool surface

- `list_documents`
- `get_document`
- `create_document` in a granted space
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
ALKALYE_MCP_ALLOWED_CLIENT_HOSTS=chatgpt.com,openai.com
ALKALYE_OPENAI_APPS_CHALLENGE=<OpenAI portal challenge token>
```

Generate the token key:

```sh
openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
```

Use the same token key across every deployment instance. Rotating it disconnects every agent and invalidates outstanding OAuth tokens.

## Replay and revocation

Authorization codes and refresh tokens are protected against immediate reuse within one warm server instance. PKCE binds authorization codes to the requesting client. Because Vercel can run multiple instances, replay detection is best-effort rather than globally serialized.

Access revocation does not depend on server memory. Disconnect marks the dedicated Jazz agent account as revoked and clears its grant index. Every MCP and grant operation rejects revoked accounts, so old access and refresh tokens become inert.

Then exercise provisioning, grants, OAuth, MCP discovery, read, concurrent-edit rejection, comment, revoke, and disconnect against the deployed origin.

Run the public endpoint checks after every deployment:

```sh
ALKALYE_OPENAI_APPS_CHALLENGE=<token> bun run qa:mcp https://www.alkalye.com
```

The challenge response is exact plain text with no newline. Set the token supplied by the OpenAI portal, deploy, verify the domain, and keep the value configured during review.

Submission also requires verified developer or business identity, **Apps Management: Write**, and a global OpenAI Platform project. Use the copy, fixtures, and reviewer tests in `docs/chatgpt-plugin-submission.md`.

References: [OpenAI MCP server guide](https://developers.openai.com/plugins/build/mcp-server), [OpenAI authentication guide](https://developers.openai.com/plugins/build/auth), [MCP 2026-07-28 specification](https://modelcontextprotocol.io/specification/2026-07-28).
