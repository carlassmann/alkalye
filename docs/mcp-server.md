# Alkalye MCP server

The Bun server exposes MCP at `/mcp`. Settings → Connections (`/app/settings?category=connections`) shows that URL to copy into a client and can create a bearer connection or approve OAuth consent. Connections list their client names and can be disconnected individually. Every tool checks the current workspace grant; revocation stops future access.

Effect supplies MCP framing, protocol negotiation, validation and tool registration. It supports `2026-07-28` per-request protocol metadata and matching headers, `server/discover`, tool schemas and annotations, and structured results. Older clients use a full `initialize` request with `2025-11-25`, then send the returned `Mcp-Session-Id` and negotiated protocol version. Accepted notifications return an empty 202 response. Hourly protocol generations expire legacy sessions; clients reinitialize after a session 404. HTTP requests must accept both `application/json` and `text/event-stream`.

The eleven tools cover documents, comments and space renaming. A space rename returns its space id, name and workspace revision. Read a document before editing it: updates and renames require `expectedRevision`. Listings and reads return `spaceId`, including personal documents. Pass it to document and comment tools to access that workspace without opening unrelated spaces. An explicit workspace never falls back to another copy; omitting it selects an accessible document. Concurrent requests are serialized across revision checks and writes, so a stale agent cannot silently overwrite another edit.

OAuth supports public client registration, authorization codes, S256 PKCE, consent and token revocation. Discovery lives at `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource/mcp`. Consent, code redemption and refresh rotation are transactional. Refresh replay revokes the entire token family. Expired access connections remain listed while their refresh grant is usable, so users can still disconnect them. Refresh retains permitted workspaces after individual grants are revoked; it fails when no workspace remains.

The approval screen is the Connections page: `/oauth/authorize` redirects to `/app/settings?category=connections&oauth=<request>`. It runs in the browser; the server verifies the signed-in account’s workspace permissions before creating a connection.

Connection credentials are encrypted at rest with `.data/master.key`. The MCP server reads the same document snapshots and commits the same actions as the browser and CLI. Document events are not end-to-end encrypted. Keep the database and key together in backups, and serve HTTPS outside localhost. Agent connections cover the workspaces supplied at authorization.

For a stdio client, set `ALKALYE_SERVER` and `ALKALYE_MCP_TOKEN`, then run `bun cli.ts mcp`. The proxy forwards JSON-RPC responses, retains negotiated legacy sessions and supplies modern transport headers from request metadata. It silently reinitializes expired legacy sessions and retries their request once.

written with GPT-6 in Codex
written with claude-opus-5-5 in Claude Code
