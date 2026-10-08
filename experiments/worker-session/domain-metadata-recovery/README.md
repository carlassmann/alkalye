# Worker metadata recovery: partial integration proof

Outside worker prototype, UI mutations remain disabled. Effect4.0.0, real WorkerRPC, IndexedDB, scoped owner and independent Bun/SQLite accepted snapshot. No production changes or performance measurements.

Complete fixture types pass. Storage/owner journey passes31 assertions through public ledger/owner interfaces: request-to-storage-key binding, tagged/corrupt recovery, exact clearing restrictions, mixed retained tails and scoped export. It does not prove command execution or physical quota failures.

The corrected WorkerRPC journey passes12 public assertions plus its completion assertion. Three assertions concern account bootstrap. The domain checks prove:

- An actual applied response is dropped at the Worker message boundary. The caller times out; read-only RecoverDomain returns the exact durable applied action.
- A known duplicate returns the same action; exact main pending confirmation clears its row. This is a known-outcome duplicate, not an unknown command replay.
- An independent public snapshot reconstructed from SQLite includes the metadata title and original body. MergeCandidate/Adopt reconciles that exact source into the editor basis.
- A staged command whose admission changes from owner to reader before invocation gets a durable not-applied result. It cannot change the document, and its outcome remains recoverable after main pending cleanup. This is worker admission revocation, not a test of server-side ACL revocation after invocation.

Unknown/interrupted/post-invocation failure, reload recovery, remaining mixed-tail cleanup interruption and full app recovery UI remain unproven. Comments and assets are disabled in this prototype and are outside this metadata proof. No full worker cutover or120fps claim.

Source/fixtures are captured byte-for-byte after the passing run; the owning agent confirmed no intervening module changes. The server built its fixture/worker bundles once and served them on a unique disposable origin. Emitted asset hashes were captured AFTER the run, not independently captured browser-request bodies; do not call them execution-coverage pins. Packaged hashes cover archived bytes. Runtime provenance is the retained driver/server and logs. No raw account data, keys, cookies, profiles or databases are packaged.

Earlier failed fixtures are retained separately: repeated Begin is invalid once a basis exists; fixed with MergeCandidate/Adopt. Next exact-source assertion incorrectly compared source text with the complete JSON snapshot response; fixed with installed Schema decoding. Both failures happened after known applied recovery and cleanup. Closed private DB/profile snapshots retained before a new unique fixture; no uncertain action was retried. Original earlier unmarked WorkerDocumentFailure fixture removed its ephemeral database; only its log remains outside, explicitly not reconstructed here.

The driver closes browser/server, then snapshots its unique data/profile directory. Copy errors are retained; failure preservation is not itself exhaustively fault-tested. Explicit temporary run paths in logs identify disposable retained fixtures.

written with gpt-6 in codex
