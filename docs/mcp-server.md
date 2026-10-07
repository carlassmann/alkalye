# Alkalye MCP server

The Bun server exposes MCP at `/mcp`. Settings → Connections (`/app/settings?category=connections`) shows that URL to copy into a client and can create a bearer connection or approve OAuth consent. Connections list their client names and can be disconnected individually. Every tool checks the current workspace grant; revocation stops future access.

Effect supplies MCP framing, protocol negotiation, validation and tool registration. It supports `2026-07-28` per-request protocol metadata and matching headers, `server/discover`, tool schemas and annotations, and structured results. Older clients use a full `initialize` request with `2025-11-25`, then send the returned `Mcp-Session-Id` and negotiated protocol version. Accepted notifications return an empty 202 response. Hourly protocol generations expire legacy sessions; clients reinitialize after a session 404. HTTP requests must accept both `application/json` and `text/event-stream`.

The eleven tools cover documents, comments and space renaming. A space rename returns its space id, name and workspace revision. Read a document before editing it: updates and renames require `expectedRevision`. Listings and reads return `spaceId`, including personal documents. Pass it to document and comment tools to access that workspace without opening unrelated spaces. An explicit workspace never falls back to another copy; omitting it selects an accessible document. Concurrent requests are serialized across revision checks and writes, so a stale agent cannot silently overwrite another edit.

OAuth supports public client registration, authorization codes, S256 PKCE, consent and token revocation. Discovery lives at `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource/mcp`. Consent, code redemption and refresh rotation are transactional. Refresh replay revokes the entire token family. Expired access connections remain listed while their refresh grant is usable, so users can still disconnect them. Refresh retains permitted workspaces after individual grants are revoked; it fails when no workspace remains.

The approval screen is the Connections page: `/oauth/authorize` redirects to `/app/settings?category=connections&oauth=<request>`. It runs in the browser; the server verifies the signed-in account’s workspace permissions before creating a connection.

Connection credentials are encrypted at rest with `.data/master.key`. The MCP server reads the same document snapshots and commits the same actions as the browser and CLI. Document events are not end-to-end encrypted. Keep the database and key together in backups, and serve HTTPS outside localhost. Agent connections cover the workspaces supplied at authorization.

For a stdio client, set `ALKALYE_SERVER` and `ALKALYE_MCP_TOKEN`, then run `bun cli.ts mcp`. The proxy forwards JSON-RPC responses, retains negotiated legacy sessions and supplies modern transport headers from request metadata. It silently reinitializes expired legacy sessions and retries their request once.

## API keys for the CLI

Create an API key in Settings → Connections. Choose its workspaces and maximum permission. API keys and MCP connection tokens share the same credential and revoke button. The key appears once; copy it before leaving Settings.

```sh
export ALKALYE_SERVER=https://your-server.example
export ALKALYE_API_KEY=YOUR_KEY
bun cli.ts doc list
bun cli.ts doc get DOCUMENT_ID
bun cli.ts doc content DOCUMENT_ID
bun cli.ts --scope space:WORKSPACE_ID doc create --title "New note" --file note.md
bun cli.ts doc update DOCUMENT_ID --file note.md --expected-revision REVISION
bun cli.ts doc rename DOCUMENT_ID "New title"
bun cli.ts doc delete DOCUMENT_ID
bun cli.ts mcp
```

A workspace-limited key needs `--scope space:WORKSPACE_ID` when creating documents outside Personal. `doc delete` archives the document. Updates return a new revision. Pass the revision from `doc get` to reject an update if someone changed the document meanwhile. Without `--expected-revision`, the CLI reads the current revision immediately before updating. It never retries a rejected revision check.

API-key commands run online through the same MCP tools and current account permissions. They do not open a local account profile. Reader keys cannot write; revoked keys fail immediately. History, undo, redo, restore and sync require account login. `--api-key KEY` overrides the environment value, but environment configuration keeps the key out of process arguments. The CLI sends keys only over HTTPS or loopback HTTP and refuses redirects.

An exported API key selects online mode even when a local account is signed in. For existing stdio integrations, `ALKALYE_MCP_TOKEN` remains supported when no API key is configured. An explicit `--api-key` wins over `ALKALYE_API_KEY`, which wins over the legacy MCP token.

written with gpt-6 in codex
