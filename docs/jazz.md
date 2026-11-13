# Jazz v2 patterns

Pinned to `jazz-tools@2.0.0-alpha.61`. Verify APIs against `/tmp/jazzref/jazz-a61`, not Jazz main or Classic examples.

## Shared contract

`src/jazz/schema.ts` defines the tables. `src/schema/index.ts` re-exports the app and document row types. Use `schema.RowOf<typeof app.table>` for row types. Nullable columns read as `null`. Settings JSON uses `EditorSettings` from `src/jazz/value-types.ts`.

Document content is a `string().merge("markdown")` column. Documents have stable UUIDs. Personal ordering, pins and folder assignments belong to `userDocuments`, not the shared document. Space memberships and document grants carry explicit roles. Blobs use `bytes()`; comment anchors use JSON captured by `db.textAnchors()`. Presence and laser tables retain latest history only. Laser rows stay private to the account.

`classicImports` and `documentVersions` are backend-written. The importer must verify Classic membership before granting v2 access. Invite redemption must verify the token server-side before adding membership. Client writes to those tables are denied.

The explicit `createdAt` and `updatedAt` columns preserve original Classic timestamps for the importer. Jazz also tracks its own `$createdAt` and `$updatedAt`. Imported authors and timestamps belong to `documentVersions`; they must not impersonate Jazz provenance.

## Backend and clients

Astro's catch-all `/jazz/[...path].ts` delegates to `jazz.handle(request)`. `src/jazz/server.ts` uses an isolated `.jazz/` SQLite directory locally and Jazz Cloud via `remote()` in production. Production needs `JAZZ_APP_ID`, `JAZZ_SERVER_URL`, `JAZZ_ADMIN_SECRET`, and `JAZZ_PUBLIC_URL`. Data is readable by Alkalye's backend and Jazz Cloud.

Vite 6/7 must exclude both `jazz-tools` and `jazz-wasm` from prebundling. Externalize `jazz-tools` and `jazz-napi` on the server. The Fetch handler uses HTTP streaming when WebSocket upgrade is unavailable. Set the public URL to the browser-facing `/jazz` URL.

`JazzProvider` opens a device account local-first immediately. `useAll` and `useOne` subscribe to queries. `useSession().user` is the UUID used for ownership. `useJazzSession` exports/restores device keys and signs out. `RecoveryPhrase` turns the device key into 24 BIP39 English words. Never log those words. Account changes replace the database, so key account-owned UI by account ID.

## Writes and editor

Use `db.transaction` to create a document together with its personal library entry. Inside the transaction, `tx.insert` returns the row directly. Await the transaction, then `write.wait({ tier: "local" })` before navigation. Local durability works offline. Global durability waits for the backend and must not gate typing. Subscribe to `db.onMutationError` to report rejected writes.

`codeMirrorSync` writes every change with `editedFrom` set to the text last shown or written by that editor. It ignores delayed local echoes, applies incoming diffs with `Transaction.addToHistory.of(false)`, maps selections through changes and holds remote text during IME composition. Bindings and undo history are keyed by document. Do not reintroduce save timers, content generations, compaction, caches or workers for saving text.

Wikilinks keep `[[id]]` and `[[id|alias]]` syntax. Backlinks are derived from readable documents instead of rewriting other documents' frontmatter.

## Permissions and tests

`src/jazz/permissions.ts` is the backend authority. Document readers can read; writers edit content; admins manage sharing and deletion. Space writers and managers can create/edit documents; space admins manage members. Public read grants no write access. Ownership and protected sharing fields cannot be changed by writers. Scope every membership check to the current document or space.

`exists.where` accepts only a where object in alpha.61. For inherited access use explicit relationship names with `allowedTo.read/update/delete`. In policy tests, `createPolicyTestApp` starts a real policy server; await global durability, and use `expectDenied` for rejected writes. Run policy tests under Node, editor tests under jsdom.

## Schema evolution

A snapshot of the foundation contract lives in `src/jazz/migrations/snapshots/`. Before changing it, read alpha.61's migrations guide and generate a lens with `bun x jazz-tools migrations create --schema-dir src/jazz --migrations-dir src/jazz/migrations --name <change>`. Import the generated graph into `defineApp` before starting a backend against existing data. Changing a typed JSON schema in place is unsupported in alpha.61. Add a column and copy values instead.

written with gpt-6.1-sol in T3 Code (Codex)
