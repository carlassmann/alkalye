# Agent Instructions

Local-first PWA built from TypeScript, HTML and CSS. Bun provides the server, bundler, test runner and SQLite. Effect 4 is the sole runtime package dependency.

## Essentials

- **Bun** - use `bun install`, `bun add`, `bun run` (no npm/yarn)
- **Verify:** `bun run check` (lint, types, format, tests)
- **Runtime dependencies** - exactly Effect 4, pinned, with no transitive dependencies. Use browser APIs and Bun built-ins for infrastructure; other packages are dev-only.
- **Never commit to `main`** - branch, open a PR, land it as a squash merge
- **Changelog** - every PR adds exactly one entry at the top of `public/changelog.json`, written for readers, carrying the next `id` and `"pr": <number>`. Published entries can be edited or removed later; never reuse an `id`. Describe what users can do or notice, not implementation details.
- **Signoff** - after the final push, run `bun run ci`. A PR is incomplete until its exact remote head has `signoff: success`; fix failures and rerun before reporting completion

## Architecture

- **Browser:** native DOM, textarea editing with syntax overlay, Shadow DOM previews
- **Data:** operation-based text CRDT and metadata registers in IndexedDB
- **Sync:** Bun WebSocket relay, durable SQLite operation log
- **Privacy:** Web Crypto AES-GCM, scoped bearer capabilities
- **PWA:** handwritten service worker, manifest, offline app shell
- **Agents:** native JSON-RPC MCP, OAuth authorization code with PKCE
- **Testing:** Bun tests; agent-browser for background browser verification

## Effect

- Prefer Effect’s built-in services and patterns before adding an abstraction: HttpClient, Schema, Config, Scope, FiberSet/FiberHandle, ScopedCache/RcMap, Stream, SubscriptionRef, Queue and Schedule.
- Custom services describe application capabilities or adapt IndexedDB, Web Crypto, DOM and Bun. Avoid rebuilding Effect infrastructure.
- Import Effect modules through subpaths (`effect/Effect`, `effect/http/HttpClient`), so Bun can remove unused code. Runtime barrel imports are rejected by `check`.
- Verify APIs against installed Effect 4; test interruption, resource release, concurrency and typed failures.

## Style

- High information density
- Top-down readability
- `let` over `const`, `function` over arrow for named functions
- No default exports
- No `any`, no type casts - fix types properly
- Comments explain WHY, not WHAT (prefer no comments)

## Detailed Guides

- [TypeScript](docs/typescript.md) - general coding style, types, tryCatch
- [File Organization](docs/file-organization.md) - module structure, exports
- [Theme authoring](public/docs/theming-guide.md) - Markdown theme sources, styling hooks, templates, and validation
