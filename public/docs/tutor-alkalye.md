---
path: Tutor
---

# Alkalye Tutor

Learn what makes Alkalye special.

---

## Works everywhere

Alkalye is a Progressive Web App. Install it:

- **Desktop** - Click the install icon in your browser's address bar
- **Mobile** - "Add to Home Screen" from your browser menu

Your documents sync automatically. Works offline too.

---

## Floating actions

When your cursor is on certain lines, floating action buttons appear:

- [ ] **URLs** - Click to open the link in a new tab [Alkalye on Github](https://github.com/carlassmann/alkalye)
- [ ] **Tasks** - Click the checkbox to toggle completion
- [ ] **Images** - Click the Button to add an image asset ![Your Image here]()

No need to select text or use menus.

---

## Focus mode

Press `{{shortcut:focusMode:mac}}` (Mac) or `{{shortcut:focusMode:other}}` (Windows) to hide the sidebars. Just you and your words.

Press again to exit.

---

## Organize your documents

Use frontmatter to organize your documents with titles, folders, tags, and pins.

### Custom title

By default, the document title is the first heading. Override it with frontmatter:

```
---
title: My Custom Title
---
```

### Folders

Organize documents into folders using the `path` field:

```
---
path: Work/Projects
---
```

- **Right-click** a document and select **Move to folder**
- Search existing folders or create new ones
- Toggle between folder view and flat view with the button next to search

Nested paths like `Work/Projects/2025` creates nested folders automatically.

### Tags

Add tags for flexible categorization:

```
---
tags: work, draft, ideas
---
```

- Use **File > Add Tag** from the document sidebar
- Tags appear in the document list
- Search for multiple tags with commas: `work, draft`

### Pinned documents

Keep important documents at the top:

- **Right-click** a document and select **Pin**
- Or use **File > Pin** from the document sidebar

```
---
pinned: true
---
```

Pinned documents show a pin icon and stay at the top regardless of sort order.

---

## Preview

Press `{{shortcut:preview:mac}}` (Mac) or `{{shortcut:preview:other}}` (Windows) or click Preview from the Tool sidebar to see your document rendered as HTML.

Preview updates live as you type.

---

## Link your documents

Connect your notes with wikilinks. Type `[[` to search your documents, then select one to insert a link. The link displays as the document title and navigates on click.

**Custom display text:** Use a pipe to show different text: `[[doc_id|custom title]]` displays as "custom title". Add text after the brackets for plurals: `[[doc_id]]s` displays as "Document Titles".

**Create while linking:** If no matching document exists, select "Create [title]" to make a new one instantly.

**Backlinks:** When you link to another document, it automatically tracks the reference. Open the linked document to see who's linking to it in the frontmatter (`backlinks: id1, id2`).

**Broken links:** If a linked document is deleted, the link shows with a red wavy underline.

---

## Real-time collaboration

Share your document from the File menu or sidebar.

**Invite collaborators:**

- **Edit access** - They can modify the document
- **View access** - They can only read

See their cursors move in real-time. No refresh needed.

---

## Spaces

Spaces are collaborative document collections. Use them to organize your personal notes, coordinate with a team, or publish public knowledge bases.

### Creating a Space

Click the space selector in the left sidebar header and select "New Space". Give it a name—you can add an avatar later in space settings.

### Switching Spaces

The space selector dropdown shows your personal space plus all spaces you belong to. Select one to see its documents.

### Space Roles

Spaces support four roles:

- **Admin** - Full control: manage members, edit settings, delete space
- **Manager** - Invite members (at or below their role), edit docs
- **Writer** - Create and edit documents
- **Reader** - View documents only

### Inviting to a Space

Open space settings and use the share dialog to generate invite links. Choose the role for new members. When someone accepts, they see the space in their sidebar.

### Public Spaces

Toggle "Public" in space settings to make all documents readable by anyone with the link. Great for documentation, wikis, or shared knowledge bases.

### Document-Level Permissions

Space membership provides base access. You can still invite individuals to specific documents with additional permissions—space and doc permissions are additive.

### Duplicating Documents

Documents belong to one space. To share across spaces, use "Duplicate to Space" from the file menu. This creates an independent copy with its own assets.

---

## Public documents

Make any document public to share a read-only link.

1. Open **File > Share** or click the collaboration status in the sidebar
2. Toggle "Public" on
3. Copy the link

Anyone with the link can read - no account needed. Still encrypted, just decryptable by anyone with the link.

---

## Assets

Upload images directly to your document:

1. Open the Document sidebar
2. Scroll to Assets
3. Click the + button
4. Select images

Insert them with the dropdown menu or type `![name](asset:id)`.

Images are stored encrypted with your document. They sync across devices and work offline.

---

## Download & export

**Download** (File menu) - Exports your document as a `.md` file. If you have images, creates a `.zip` with the markdown and an `assets` folder.

**Save as** (`{{shortcut:saveAs:mac}}` / `{{shortcut:saveAs:other}}`) - Uses the system file picker to save directly to your filesystem.

---

## Trash & restore

Deleted documents go to trash. Find them in Settings > Trash.

- **Restore** - Brings the document back
- **Delete permanently** - Gone forever

Documents are permanently deleted after 30 days in trash.

---

## Keyboard shortcuts

Speed up your writing with these shortcuts.

### Formatting

| Action        | Mac                              | Windows                            |
| ------------- | -------------------------------- | ---------------------------------- |
| Bold          | `{{shortcut:bold:mac}}`          | `{{shortcut:bold:other}}`          |
| Italic        | `{{shortcut:italic:mac}}`        | `{{shortcut:italic:other}}`        |
| Code          | `{{shortcut:inlineCode:mac}}`    | `{{shortcut:inlineCode:other}}`    |
| Strikethrough | `{{shortcut:strikethrough:mac}}` | `{{shortcut:strikethrough:other}}` |
| Link          | `{{shortcut:link:mac}}`          | `{{shortcut:link:other}}`          |

### Headings

| Action    | Mac                         | Windows                       |
| --------- | --------------------------- | ----------------------------- |
| Heading 1 | `{{shortcut:heading1:mac}}` | `{{shortcut:heading1:other}}` |
| Heading 2 | `{{shortcut:heading2:mac}}` | `{{shortcut:heading2:other}}` |
| Heading 3 | `{{shortcut:heading3:mac}}` | `{{shortcut:heading3:other}}` |
| Body text | `{{shortcut:body:mac}}`     | `{{shortcut:body:other}}`     |

### Lists

| Action          | Mac                            | Windows                          |
| --------------- | ------------------------------ | -------------------------------- |
| Bullet list     | `{{shortcut:bulletList:mac}}`  | `{{shortcut:bulletList:other}}`  |
| Ordered list    | `{{shortcut:orderedList:mac}}` | `{{shortcut:orderedList:other}}` |
| Task list       | `{{shortcut:taskList:mac}}`    | `{{shortcut:taskList:other}}`    |
| Toggle complete | `{{shortcut:toggleTask:mac}}`  | `{{shortcut:toggleTask:other}}`  |

### Structure

| Action         | Mac                             | Windows                           |
| -------------- | ------------------------------- | --------------------------------- |
| Move line up   | `{{shortcut:moveLineUp:mac}}`   | `{{shortcut:moveLineUp:other}}`   |
| Move line down | `{{shortcut:moveLineDown:mac}}` | `{{shortcut:moveLineDown:other}}` |
| Blockquote     | `{{shortcut:blockquote:mac}}`   | `{{shortcut:blockquote:other}}`   |
| Code block     | `{{shortcut:codeBlock:mac}}`    | `{{shortcut:codeBlock:other}}`    |

### Navigation

| Action            | Mac                             | Windows                           |
| ----------------- | ------------------------------- | --------------------------------- |
| Documents sidebar | `{{shortcut:leftSidebar:mac}}`  | `{{shortcut:leftSidebar:other}}`  |
| Tools sidebar     | `{{shortcut:rightSidebar:mac}}` | `{{shortcut:rightSidebar:other}}` |
| Focus mode        | `{{shortcut:focusMode:mac}}`    | `{{shortcut:focusMode:other}}`    |
| Preview           | `{{shortcut:preview:mac}}`      | `{{shortcut:preview:other}}`      |
| Save as           | `{{shortcut:saveAs:mac}}`       | `{{shortcut:saveAs:other}}`       |

---

## Portable by design

Alkalye stores metadata (title, folders, tags, pinned, presentation mode) directly in frontmatter. Your documents are standard markdown files—download them anytime, open them anywhere. No lock-in.

Export preserves folder structure: documents with `path: Work/Projects` export into matching directories.

---

That's Alkalye. Simple, private, powerful.
