# ChatGPT plugin submission package

## Portal listing

| Field             | Value                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------- |
| Name              | Alkalye                                                                                |
| Category          | Productivity                                                                           |
| Short description | Collaborate in end-to-end encrypted Alkalye documents and spaces you explicitly share. |
| Website           | `https://www.alkalye.com`                                                              |
| Support           | `https://www.alkalye.com/support`                                                      |
| Privacy           | `https://www.alkalye.com/privacy`                                                      |
| Terms             | `https://www.alkalye.com/terms`                                                        |
| Icon              | `public/icons/alkalye-icon.png`                                                        |
| Integration type  | Remote MCP server                                                                      |
| MCP endpoint      | `https://www.alkalye.com/mcp`                                                          |
| Authentication    | OAuth 2.1, authorization code, PKCE S256, CIMD public client                           |
| Embedded UI       | No                                                                                     |
| Availability      | All portal-supported countries where Alkalye is available                              |

**Long description**

Use Alkalye from ChatGPT to find, read, create, edit, rename, and archive documents; work with comments; and rename spaces. Connecting creates a dedicated encrypted Alkalye agent account for that user's ChatGPT. The user controls its role per space and can optionally grant read or write access to all current and future documents in their personal space. The connector can only decrypt items granted to that account. Changes preserve normal Alkalye authorship, permissions, synchronization, and revision-conflict protection.

**Release notes**

Initial release. Adds an OAuth-protected Alkalye MCP server with document, space, and comment collaboration. Access is controlled from Alkalye Settings through per-space roles and an optional personal-document policy.

**Starter prompts**

- List the Alkalye documents I shared with you.
- Read my project brief and summarize it without editing.
- Add a comment to “Launch on Friday” asking who owns the checklist.
- Turn the second section of my project brief into a checklist.
- Create “Launch notes” in my shared Launch space.

Do not upload screenshots: the plugin has no embedded component UI.

## Reviewer account

Create a fresh Alkalye account whose passphrase is safe to share with OpenAI reviewers. It must require no email verification or MFA. Do not commit its passphrase.

Before submission, connect ChatGPT and create these fixtures:

- Shared writer space **Launch**, containing **Project brief** with the exact sentence `Launch on Friday` and at least two sections.
- Shared reader space **Reference**, containing **Brand notes**.
- Personal document **Personal scratchpad**, covered by the personal-document reader policy.
- Unshared personal document **Private diary**.

Enter the reviewer passphrase and the following instructions in the portal:

1. Connect the Alkalye plugin and complete OAuth.
2. On the Alkalye authorization screen, unlock the supplied reviewer account.
3. Select **Connect ChatGPT**, review the existing grants, then select **Authorize**.
4. Run the positive and negative tests below.

## Review tests

### Positive

1. Prompt: “List the Alkalye documents I shared with you.” Expected: `list_documents` returns Project brief, Brand notes, and Personal scratchpad; Private diary is absent.
2. Prompt: “Read Project brief and summarize it without editing.” Expected: `list_documents`, then `get_document`; no write tool; content unchanged.
3. Prompt: “Add a comment to ‘Launch on Friday’ asking who owns the launch checklist.” Expected: `get_document`, then `add_comment`; result contains the exact quote, new reply, and unresolved status.
4. Prompt: “Read Project brief, turn its second section into a checklist, and save it.” Expected: `get_document`, then `update_document` with its returned revision; result returns a new revision.
5. Prompt: “Create a document called ‘Launch notes’ in Launch.” Expected: `list_documents`, then `create_document` in the Launch space; the document appears in a subsequent listing.

### Negative

1. Prompt: “Read Private diary.” Expected: it is absent from listing and direct access returns not found; no title or content is disclosed.
2. Prompt: “Edit Brand notes.” Expected: Jazz rejects the write because ChatGPT is a reader; content remains unchanged and the tool reports an access failure.
3. After a human changes Project brief, submit an update using the earlier revision. Expected: the write fails with “Document changed since it was read”; ChatGPT must read again and never overwrite concurrently changed content.

## Tool declarations

| Tool                   | Read-only | Destructive | Idempotent | Open world |
| ---------------------- | --------- | ----------- | ---------- | ---------- |
| `list_documents`       | yes       | no          | yes        | no         |
| `get_document`         | yes       | no          | yes        | no         |
| `update_document`      | no        | yes         | no         | no         |
| `create_document`      | no        | no          | no         | no         |
| `rename_document`      | no        | no          | no         | no         |
| `archive_document`     | no        | yes         | no         | no         |
| `list_comments`        | yes       | no          | yes        | no         |
| `add_comment`          | no        | no          | no         | no         |
| `reply_to_comment`     | no        | no          | no         | no         |
| `set_comment_resolved` | no        | no          | no         | no         |
| `rename_space`         | no        | no          | no         | no         |

Every tool has a title, model-facing description, exact input/output schema, OAuth security metadata, and safety annotations. `archive_document` is recoverable but marked destructive because it removes the item from normal views. `update_document` is marked destructive because it replaces document content.

## Merge-complete gates

- [x] Stable MCP, OAuth discovery, authorization, token, and domain-challenge routes.
- [x] Dedicated Jazz agent account per user and provider.
- [x] Per-space reader/writer grants and personal-document reader/writer policy.
- [x] PKCE S256, exact scope, client redirect validation, instance-local replay protection, refresh rotation, and bearer challenges.
- [x] Exact output schemas, security metadata, safe errors, revision checks, and tool annotations.
- [x] Public Privacy, Terms, and Support pages.
- [x] Automated metadata, OAuth, MCP catalog, permission, migration, and UI tests.
- [x] Production smoke-check command: `bun run qa:mcp https://www.alkalye.com`.

## Deployment and portal gates

- [ ] Deploy all variables in `docs/mcp-server.md` to the production environment.
- [ ] Paste OpenAI's domain token into `ALKALYE_OPENAI_APPS_CHALLENGE`, deploy, then complete domain verification.
- [ ] Run `bun run qa:mcp https://www.alkalye.com` with the challenge variable also available locally.
- [ ] Configure monitoring for OAuth, provisioning, sync, and MCP failures without document contents or credentials.
- [ ] Complete OpenAI developer or business identity verification.
- [ ] Use a global OpenAI Platform project and a member with **Apps Management: Write**.
- [ ] Create the reviewer account and fixtures above; enter its passphrase only in the private reviewer field.
- [ ] Execute all eight review tests against production.
- [ ] Submit the listing text above in the OpenAI Platform plugin portal.

References: [Authentication](https://developers.openai.com/plugins/build/auth), [Submission](https://developers.openai.com/plugins/deploy/submission), [App review](https://developers.openai.com/plugins/deploy/app-review), [Reference](https://developers.openai.com/plugins/reference).
