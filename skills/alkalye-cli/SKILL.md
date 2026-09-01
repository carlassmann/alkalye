---
name: alkalye-cli
description: Drive Alkalye via the command line for auth, documents, spaces, and collaboration. Manage documents, share with others, and collaborate — all from the terminal.
compatibility: Requires Bun (>=1.0) and a reachable Jazz websocket sync peer.
metadata:
  author: alkalye
  version: "1.0"
---

## What is Alkalye?

Alkalye is an offline-capable collaborative document editor. The CLI lets you manage documents, spaces, and sharing from the terminal — designed for scripts and AI agents.

Data syncs via Jazz, a local-first protocol. Every mutation is local first and syncs to peers over websocket.

## Setup

### 1. Clone and install

```bash
git clone https://github.com/carlassmann/alkalye.git /path/to/alkalye
cd /path/to/alkalye
bun install
```

Replace `/path/to/alkalye` with your preferred location (e.g. `~/Developer/alkalye`).

### 2. Make the CLI available

Symlink the entry point so `alkalye` is on your PATH:

```bash
ln -s /path/to/alkalye/cli.ts ~/.local/bin/alkalye
chmod +x /path/to/alkalye/cli.ts
```

Or run directly with `bun /path/to/alkalye/cli.ts ...`.

### 3. Configure the sync peer

The CLI needs a Jazz websocket sync peer. The easiest way is to point at a server — the CLI auto-discovers the peer:

```bash
# Production (recommended for most use cases)
export ALKALYE_SERVER=https://alkalye.com

# Or per-command
alkalye --server https://alkalye.com auth whoami
```

For local development, set the peer directly:

```bash
export ALKALYE_SYNC_PEER=ws://localhost:4200
alkalye auth whoami --sync-peer ws://localhost:4200
```

### 4. Symlink the skill (for agents)

If your agent supports skill directories, symlink this skill:

```bash
ln -s ~/alkalye/skills/alkalye-cli /path/to/your/agent/skills/alkalye-cli
```

## Authentication

Every user gets a BIP39 passphrase (24 words). Store it — it's the only way to recover an account.

```bash
# Create an account
alkalye auth signup --name "Alice"

# Log in on another machine
alkalye auth login --passphrase-stdin < passphrase.txt

# Check current session
alkalye auth whoami

# Retrieve stored passphrase
alkalye auth passphrase

# Log out
alkalye auth logout
```

Credentials are stored in `~/.alkalye/cli/` (override with `--home` or `ALKALYE_CLI_HOME`).

## Documents

Documents are markdown with a title derived from the first heading or frontmatter.

```bash
# Create from stdin (preferred for multiline)
printf "# Meeting Notes\n\nAction items here." | alkalye doc create --stdin

# Create with inline content (supports \n for newlines)
alkalye doc create --content "# Quick Note\nSome text"

# Create from a file
alkalye doc create --content-file draft.md

# Create in a space
alkalye doc create --stdin --scope space:<space-id> < doc.md

# List personal docs
alkalye doc list

# List all docs (personal + spaces)
alkalye doc list --scope all

# List docs in a specific space
alkalye doc list --scope space:<space-id>

# List deleted docs
alkalye doc list --deleted

# Read raw content (pipe-friendly)
alkalye doc content <doc-id>
alkalye doc content <doc-id> | head -20

# Show metadata
alkalye doc get <doc-id>

# Update content
cat updated.md | alkalye doc update <doc-id> --stdin

# Rename
alkalye doc rename <doc-id> --title "New Title"

# Move between personal and space
alkalye doc move <doc-id> --scope space:<space-id>
alkalye doc move <doc-id> --scope personal

# Soft-delete and restore
alkalye doc delete <doc-id>
alkalye doc restore <doc-id>

# Permanent delete
alkalye doc purge <doc-id>
```

## Spaces

Spaces are shared containers for documents with role-based membership.

```bash
# Create
alkalye space create --name "Team Docs"

# List
alkalye space list

# Show metadata
alkalye space get <space-id>

# List documents in a space
alkalye space docs <space-id>

# List members
alkalye space members <space-id>

# Rename
alkalye space rename <space-id> --name "New Name"

# Delete
alkalye space delete <space-id>
```

## Sharing and Collaboration

Share documents or spaces by creating invite links. The recipient accepts the link to gain access.

### Document sharing

```bash
# Create invite (returns a link)
alkalye doc share create <doc-id> --role writer

# List collaborators
alkalye doc share list <doc-id>

# Change a collaborator's role
alkalye doc share role <doc-id> --invite-group-id <id> --role reader

# Revoke an invite group
alkalye doc share revoke <doc-id> --invite-group-id <id>
```

### Space sharing

```bash
alkalye space share create <space-id> --role writer
alkalye space share list <space-id>
alkalye space share role <space-id> --invite-group-id <id> --role admin
alkalye space share revoke <space-id> --invite-group-id <id>
```

### Accepting invites

```bash
# Inspect without accepting
alkalye invite inspect --link <url>

# Accept
alkalye invite accept --link <url> --sync
```

### Public access

```bash
# Make a document or space publicly readable
alkalye doc public enable <doc-id>
alkalye space public enable <space-id>

# Get the public link
alkalye doc public link <doc-id>
alkalye space public link <space-id>

# Revoke public access
alkalye doc public disable <doc-id>
alkalye space public disable <space-id>
```

## Output Modes

```bash
# Human-readable (default) — key: value lines, pipe-friendly
alkalye doc list

# JSON — structured { ok, command, data } envelope
alkalye doc list --json

# Quiet — no stdout, exit code only (for scripting conditionals)
alkalye auth whoami --quiet && echo "logged in"

# Verbose — adds runtime context (sync peer, timeout, home dir)
alkalye doc list --json --verbose
```

JSON error output goes to stderr:

```json
{
	"ok": false,
	"command": "doc.get",
	"error": { "type": "NotFoundError", "message": "Document not found: co_xyz" }
}
```

## Exit Codes

| Code | Meaning                    |
| ---- | -------------------------- |
| 0    | Success                    |
| 2    | Usage or validation error  |
| 3    | Not authenticated          |
| 4    | Resource not found         |
| 5    | Permission denied          |
| 6    | Sync peer unreachable      |
| 7    | Config or filesystem error |

## Agent Workflow

Multi-actor collaboration pattern — each actor gets an isolated CLI home:

```bash
# Actor 1: create account and document
export ALKALYE_SERVER=https://alkalye.com
env ALKALYE_CLI_HOME=/tmp/actor-1 alkalye auth signup --name "Owner" --json
printf "# Shared Doc\nContent here." | env ALKALYE_CLI_HOME=/tmp/actor-1 alkalye doc create --stdin --sync --json

# Actor 1: share the document
env ALKALYE_CLI_HOME=/tmp/actor-1 alkalye doc share create <doc-id> --role writer --json

# Actor 2: create account and accept invite
env ALKALYE_CLI_HOME=/tmp/actor-2 alkalye auth signup --name "Collaborator" --json
env ALKALYE_CLI_HOME=/tmp/actor-2 alkalye invite accept --link <invite-link> --sync --json

# Actor 2: verify access
env ALKALYE_CLI_HOME=/tmp/actor-2 alkalye doc content <doc-id>
```

## Editing Documents

For non-trivial edits, pull the document to a local file, edit locally, then push back:

```bash
# Pull content to a local file
alkalye doc content <doc-id> > draft.md

# Edit the file with any tool (sed, your editor, AI, etc.)

# Push the updated file back
alkalye doc update <doc-id> --content-file draft.md --sync
```

This avoids constructing complex content inline and lets you use whatever editing tools you prefer.

## Tips

- `--sync` is available on `doc create`, `doc update`, and `invite accept`. Use it when you need to guarantee the remote peer has the data before proceeding.
- Use `--json` in scripts — parse with `jq` or your language's JSON parser.
- Use `--quiet` for conditional checks: `alkalye auth whoami --quiet || alkalye auth signup --name Bot`.
- Invite links require a base URL. Set `ALKALYE_BASE_URL` for local development.
- Every command supports `-h` or `--help` for usage details: `alkalye doc create --help`.
