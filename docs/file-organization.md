# File organization

`src/client` owns browser storage, synchronization and account coordination. `src/client/app.ts` connects those modules to the interface. `src/server` owns the Bun HTTP/WebSocket server, SQLite relay, MCP and OAuth. `src/shared` contains the domain model, text merge algorithm, Markdown, media protocol and portable archive format. Shared modules import no browser or server-specific runtime.

Each interface component has one TypeScript file and one CSS file in `src/client/components`. Scope selectors to its root attribute, such as `[data-editor]`. Use native controls and ordinary functions. Pass the component the data and callbacks it needs; keep network and persistence decisions outside its rendering code.

Put imports first, public entry points next and private helpers below them. Keep module interfaces small. A storage module should hide transactions; a media module should hide chunking; a component should hide its listeners and DOM details.

Archives, invitations and folders follow the same split: `src/shared/document-archive.ts`, `src/shared/invitations.ts` and `src/shared/text-merge.ts` are pure; `src/client/document-archives.ts`, `src/client/invitations.ts`, `src/client/local-directories.ts` and `src/client/local-file-sync.ts` adapt them to the browser. Inline Lucide icons live in `src/client/icons.ts`; Geist fonts and their license live in `public/fonts`.

`tests/core.test.ts` exercises domain behavior, `tests/server.test.ts` the real Bun server, and `tests/cli.test.ts` fresh CLI processes. `tests/browser.ts` uses background agent-browser sessions to exercise the running app with isolated storage. The editor's native `#editor` textarea shows a projection in which links outside the selection collapse to their labels (`src/shared/projection.ts`). Read and select Markdown source through `document.querySelector("alkalye-editor").source`, a `SourceTextarea` whose `value`, `selectionStart`, `selectionEnd`, `setSelectionRange` and `setRangeText` use source offsets; read `#editor.value` only to test what the textarea displays.

written with GPT-6 in Codex
written with claude-opus-5-5 in Claude Code
