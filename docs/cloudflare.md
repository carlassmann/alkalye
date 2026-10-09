# Cloudflare deployment

The browser bundle and service worker stay unchanged. A Worker serves static
files and forwards API, OAuth, MCP and live requests to one named Durable Object.
The object runs the same Effect application used by Bun. Its SQLite database
stores accounts, permissions, document events and immediately readable snapshots.
WebSocket and HTTP polling clients share that application and authorization path.
R2 stores attachment bytes. SQLite records their verified sizes and object
receipts, so current permissions and quotas govern access through the API.

The SQLite adapter uses native storage transactions rather than SQL transaction
statements. Every query shares one transaction context and semaphore. This keeps
permission checks and accepted actions atomic when an Effect yields or performs
asynchronous work. Object eviction can discard presence and in-memory caches;
clients reconnect and reload durable state.

R2 uploads complete before the SQLite metadata transaction is accepted. The
transaction rechecks permission and quota limits. A failed metadata commit can
leave an inaccessible object in R2; automatic orphan deletion is not enabled.

## Configure

Install development tooling with `bun install`. Wrangler is a development
dependency; it does not enter either runtime bundle.

```sh
bun x --no-install wrangler login
bun x --no-install wrangler r2 bucket create alkalye-effect-rewrite-assets
```

The resource names and bindings live in `wrangler.jsonc`. Use separate names for
each deployment. `ALKALYE_MASTER_KEY` is a required, stable AES key, encoded as
base64url. Generate it once, keep a private backup and reuse it on subsequent
deployments. Missing or invalid keys fail initialization. Replacing it makes
previously encrypted recovery material unreadable.

```sh
bun -e 'console.log(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url"))'
bun x --no-install wrangler secret put ALKALYE_MASTER_KEY
```

For the first deployment, a private JSON secrets file can supply the key with
the initial version: `{"ALKALYE_MASTER_KEY":"YOUR_GENERATED_KEY"}`. Deploy with
`bun run cloudflare:deploy --secrets-file /private/alkalye-secrets.json`.
Keep this file out of Git. Later deployments retain uploaded secrets.

For email sign-in, also configure `RESEND_API_KEY` and `EMAIL_FROM`. The sender
must be verified with Resend. Recovery-key sign-in works without an email provider.
Set `PUBLIC_ORIGIN` when using a custom domain; it must match the public HTTPS
origin used by browser, CLI and MCP clients.

## Build and deploy

```sh
bun run cloudflare:check
bun run cloudflare:smoke
bun run cloudflare:sqlite-smoke
bun run cloudflare:live-smoke
bun run cloudflare:deploy
```

`cloudflare:check` checks Workers types, builds browser assets and bundles the
Worker without publishing. The smoke test uses isolated local Workers storage
and exercises the real application. Deployment uploads the Worker and static
assets and applies the Durable Object migration.

For local development, put a private test key in `.dev.vars`, then run
`bun run cloudflare:dev`. Open http://127.0.0.1:8787/app. `.dev.vars` and local
Workers state are ignored by Git.

## Current limits

The first deployment uses one SQLite Durable Object to retain transactions
across account, workspace and document permissions. It is not sharded. D1 is
not used: its batch API cannot replace these interactive transactions without
changing the permission and event-commit model.

Sockets use regular acceptance. Hibernation would require restoring authenticated
peers and scoped subscriptions. Disconnects and object restarts already use the
normal client reconnection path.

Registered OAuth clients and API keys work through the existing protocol.
URL-based OAuth client metadata fails closed on Workers: its Node networking
compatibility cannot preserve Bun's public-IP pinning and original TLS identity.
Register a public OAuth client instead.

written with gpt-6 in codex
