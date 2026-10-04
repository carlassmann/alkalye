# Backups, sharing and folders

Three product flows sit on top of the document session: ZIP backups, links that share documents and workspaces, and folders on the device. None of them adds a second storage engine. Each is an adapter around the session, the authenticated document API or the File System Access API.

## ZIP export, backup and import

`src/shared/document-archive.ts` is pure. `exportArchive` turns restored snapshots into ZIP entries; `parseArchive` turns entries into a plan; `importedSource` and `importSteps` turn the plan into document actions. `src/client/document-archives.ts` supplies the effects: reading checkpoints and blob bytes, rendering whiteboard previews, storing bytes and committing actions. It loads on demand, so it adds nothing to startup.

Export reads one checkpoint per document and the bytes its manifests name. It never downloads or replays history. A document with no attachments, drawings, themes or comments downloads as Markdown; otherwise it becomes a ZIP:

```text
Projects/Notes/Notes.md                  Markdown, links rewritten to archive paths
Projects/Notes/Notes.comments.json       the original application's comment sidecar (version 1)
Projects/Notes/Notes.assets.json         names, types, muting and original identities
Projects/Notes/assets/Photo.png          attachment bytes
Projects/Notes/assets/Sketch.svg         whiteboard preview for other Markdown tools
Projects/Notes/assets/Sketch.svg.alkalye-drawing.json   editable shapes
themes/Paper.theme.md                    theme source, written once per name and source
alkalye.json                             alkalye-portable-v1 manifest
```

Documents without attachments stay single files beside their folder, as the original application exported them. Wiki links become archive paths inside an export and titles outside it. "Export all" in the library's file menu packages every document in the selected workspace, or all workspaces with one folder each.

Import accepts these ZIPs, archives from the original application, theme ZIPs, `.theme.md`, `.tldr` and `.alkalye-drawing.json` drawings, and loose Markdown. Files chosen together form one archive, so their wiki links, comment sidecars and relative images resolve to each other. Every archive document gets a fresh identity. Creation carries the final Markdown; later actions add attachments, whiteboards, themes and comments in batches that stay under the server's 1,024-change and 200,000-character limits. Comments are re-anchored to the characters they quoted.

Untrusted archives fail as `ArchiveInvalid` before any document is created: unsafe or duplicate paths, more than 10,000 entries or 100 MB, non-UTF-8 text, malformed JSON, invalid drawings or themes, oversized documents or attachments, and declared files that are missing. `unzip` stops inflating an entry as soon as it exceeds its declared size.

Import works offline. Created documents publish when the browser reconnects.

## Invitation links

An owner creates a writer or reader link from the document's share dialog or the workspace settings. The link has the original application's shape, `/invite#/doc/<document>/invite/<invitation>/<secret>` (or `/space/…`). The browser generates 32 random bytes for the secret; the server stores only its SHA-256 digest and compares digests in constant time. The secret appears once, in the link.

Invitations are workspace facts in the existing journal: created, accepted, revoked and left. A projection keeps active invitations and their members; the `document_grants` and `workspace_grants` views combine them with direct grants, so every existing role check, the library and live presence see them without separate code. The strongest grant wins.

Opening a link shows what it grants and which account will join. Joining is an explicit click. Revoking a link removes everyone who joined through it, as in the original application. Owners can remove one person; members can leave. A wrong secret looks exactly like an unknown invitation. Agent credentials cannot create or accept invitations. Concurrent acceptance and revocation serialize in SQLite: nobody keeps access through a revoked link.

## Public links

"Make public" in the share dialog lets any signed-in account read the document from its `/app/doc/<document>` link. It writes the reserved `access:public` register, which only the owner can set and which only grants reading. The document does not appear in a reader's library. "Make private" ends that access immediately. Browsers create an account automatically, so in practice anyone with the link can read.

## Folders on this device

"Open folder" uses `showDirectoryPicker` and adds the folder as a workspace. Its Markdown files appear in the same sidebar, editor, preview and presentation views. `src/client/local-directories.ts` keeps directory handles in IndexedDB, scans in the background at startup, and gives every file a stable document identity, so renaming or moving a file keeps its open session, undo and drafts.

A folder document uses the same `DocumentSession` as a synchronized one, with an IndexedDB journal and a transport that never reaches the server. `src/client/local-file-sync.ts` keeps the file and the session in agreement. It writes after edits settle and rereads the file on focus, when the page becomes visible and every few seconds. Both sides merge line by line against the last version they agreed on (`src/shared/text-merge.ts`). Edits to different lines combine. Overlapping edits stop saving and ask which version to keep; the other version stays available to restore. Closing a document writes its last edits first.

Attachments are written beside the file in `assets/` and linked by relative path, as the original application did. Previews read them from the folder. Without permission the folder shows "Allow access"; a click requests it again. Folder documents are never sent to the server.

"Open file" opens a single Markdown file the same way; the installed app also registers as a handler for `.md`, `.markdown` and `.txt` files and opens them through `launchQueue`. Opened files gather under "Opened files" and keep their own handles. The browser grants no access to the folder around such a file, so it cannot be renamed or receive attachments; "Close file" forgets it without touching the disk.

Comments, whiteboards and custom theme records of folder documents would live only in the browser journal, so their controls are hidden. Frontmatter themes still apply.

## Verified

`tests/document-archive.test.ts`, `tests/text-merge.test.ts` and `tests/invitations.test.ts` run against real replicas, ZIP bytes and Bun servers. `tests/browser-native-portability.ts`, `browser-native-invitations.ts`, `browser-native-folders.ts` and `browser-native-commands.ts` drive the real interface in background browsers. The folder suite uses the Origin Private File System, which provides real directory handles; only the picker is replaced.

## Not yet done

- The file-handler launch path is untested: automated browsers cannot launch the installed app with a file.
- Archive import cannot undo itself as one step; each document's actions are separate.
- Public links still require the account every browser creates automatically; there is no anonymous server access.

written with claude-opus-5-5 in Claude Code
