# Privacy Policy

## Data storage

Documents and attachments are cached locally in your browser. The configured Bun server stores accepted document events, current snapshots and attachment bytes in SQLite. These records are not end-to-end encrypted. Server access follows document and workspace owner/writer/reader permissions.

## Recovery and sharing

Your recovery key derives your account identity and restores it on another device. Keep it private. Restoring a different account retains the previous key on this device so existing local documents remain recoverable. Workspace and document owners can grant readers and writers access by account ID.

## Agent connections

You choose an agent’s workspace scope and role ceiling. The server protects its connection credentials at rest with its master key. Tool calls also check your current document permissions; revocation blocks future calls. Account recovery keys are not sent to agents.

Content returned by an agent tool is sent to the AI provider and follows that provider’s terms and privacy policy. This can include document content, names, identifiers, revisions, timestamps, comments and collaborator names.

## Analytics

This experimental rewrite does not send product analytics.

## Contact

For privacy concerns: [assmann@hey.com](mailto:assmann@hey.com).

written with GPT-6 in Codex
