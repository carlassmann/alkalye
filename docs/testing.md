# Testing

Test application capabilities through their public interfaces. Use real adapters for persistence and transport, and real Effect scopes for lifecycle behavior. A pure model can still have a useful module contract: merge serialized operations from several writers, reopen from a checkpoint and compare the resulting document. Assertions on private helpers or intermediate representations add little confidence.

`bun run check` runs static checks, module integration and fast app journeys. `bun run test:integration` runs the Bun and browser module suites concurrently. `bun run test:e2e:full` runs the broader app suite. `bun tests/e2e.ts --suite=theme-library` selects a single app suite. Set `TEST_WORKERS=1` to diagnose a timing problem; the default is two isolated workers, with a maximum of four.

## Module boundaries

| Capability                                                                   | Main integration coverage                                                                                      |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Durable document editing, scoped undo, metadata and cold reopening           | `cli-document-session.test.ts`, `document-api.test.ts`, `browser-document-api.ts`                              |
| Journal atomicity, corruption, interrupted writes and concurrent connections | `sqlite-document-journal.test.ts`, `native-eventlog*.test.ts`, `browser-storage.ts`, `browser-document-api.ts` |
| Permissions, identities, invitations and workspace membership                | `account-api.test.ts`, `invitations.test.ts`, `workspace-deletion.test.ts`, `document-api.test.ts`             |
| Collaboration, presence, presenter arbitration and transport fallback        | `document-live*.test.ts`, `browser-live-*.ts`, `browser-laser-displays.ts`                                     |
| Whole-document history, assets and archives                                  | `document-history*.test.ts`, `document-archive.test.ts`, `document-blob-store.test.ts`, `document-api.test.ts` |
| MCP, OAuth and fresh CLI processes                                           | `cli-mcp.test.ts`, `account-agents.test.ts`, `cli.test.ts`, `browser-mcp.ts`                                   |

For a new behavior, extend the relevant boundary scenario. Exercise success, retry, interruption, denied access, concurrent work and cold reopening where they matter. Fault injection belongs at an adapter boundary; keep the actual module and its dependencies running. Never replace an integration module with a fake that duplicates its behavior.

Small algorithm contracts remain for convergence, frontmatter preservation, stored-format compatibility and recovery cases that are difficult to reach through the UI. They are exceptions, not the template for new tests.

## App behavior

The fast journeys exercise editing, find/replace, undo/redo, durable reload, offline reload/reconnect, safe Markdown preview and mobile presentation navigation with frontmatter and fenced slide dividers. Offline tests assert pending local edits and verify the server snapshot after reconnecting. Their first measured run was four seconds including startup. The broader suite retains menus, dialogs, themes, comments, invitations, workspaces, whiteboards, presentation displays and network failure scenarios. Use it before delivering changes across those screens; use the affected suite while iterating.

Use `browserBatch` for straight-line native browser actions. Thirty trivial commands measured 194ms in one batch versus 5.5s as separate CLI processes. Keep assertions and waits beside the actions they verify. Wait for visible controls, completed transitions and durable writes, not fixed sleeps. The save indicator exposes actual local writes with `aria-busy`, the document version and pending publication count independently of its debounced text. Journeys wait for the expected source and a changed version before reloading.

Each app suite gets an isolated database and browser session. The runner shares only an immutable build, so fault controls and account data cannot leak between suites. CI checks preview readiness and runs app journeys against isolated servers using its production build; the development-cache scenario gets one separate development build. Logs and per-suite durations go to `test-results/`; a failed batch reports the exact command. Browser module suites use small purpose-built fixture pages with the real IndexedDB and network adapters.

## Removed tests

Nineteen helper-focused test files were removed where the behavior is exercised through module or app boundaries: action staging, blob helpers, comments, undo selection, find, portable helpers, presentation helpers, preview alignment, editor projection, routes, startup reporting, theme parsing/resolution, toast stacks, UI state and live wire schemas. Archive compatibility also covers CRLF and relocated comment anchors. Malformed manifests and hostile presence run at the HTTP boundary; save feedback cancellation lives in the Effect lifecycle suite. Presenter tie-breaking, slow clocks, hostile clocks and reader restrictions now run together through real HTTP polling peers. Theme undo, metadata and discussion now share a durable-session scenario that closes, reopens, synchronizes and restores a server snapshot.

Exploratory test files were removed from `experiments/`. Those prototypes are not additional production engines to maintain. The independent causal-text implementation remains as an oracle used by the production convergence contract.

written with gpt-6 in codex
