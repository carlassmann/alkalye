# Existing database and stale reader proof

Outside correctness experiment; no production adoption or performance timings.

The actual frozen `52670c02b4138fc0f22646f24d2d383815a7d439` source wrote a disposable workspace, document, normal emoji edit and local session journal. Its workspace name intentionally resembles a JSON string. The server database had no `name_json` column. The original event payloads are retained in `old-server-rows.json`; they contain only synthetic fixture data.

Four separate process phases passed:

| Phase                                 | Runner time | Result                                                                                                                                  |
| ------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Actual old writers seed database      | 121 ms      | Old schema and durable normal source                                                                                                    |
| New readers migrate existing database | 79 ms       | Exact workspace history/snapshot/library, document metadata/excerpt/source, added nullable columns and unchanged original journal bytes |
| New exceptional writers               | 109 ms      | Exact lone-surrogate workspace name and document source                                                                                 |
| Actual old reader                     | 80 ms       | Expected typed failure and unchanged journal payloads                                                                                   |

The old session used its real public DocumentSession and journal services. An adapter returned no cached projection so it replayed the existing journal; it did not delete or alter the stored projection. Network transport was unavailable. Result: `DocumentConflict` with `Unknown document journal entry`. This is currently generic conflict guidance, not a dedicated upgrade action. No source normalization or journal clearing occurred.

Strict types passed after fixture-only Scope environment, unused import and readonly assertion-generic corrections. The reader's initial assertion incorrectly selected the last workspace fact, which was documentAdded rather than created. Its corrected predicate selected the created fact; the failure is retained. Final packaging strict types also passed after the corrected predicate. No uncertain writes were repeated. The four phases used one populated database in order, not independently reset histories.

The new reader/writer source matches the selected-format experiment. This proves existing stored bytes and schema migration compatibility, not stale-client upgrade safety. Before adoption, ship readers and migration first with old writes; only enable exceptional writes after incompatible tabs/servers are retired. The existing service-worker update offer targets an individual tab and preserves old per-client caches, so activation alone does not establish all-tab compatibility. Older scalar writers could also leave JSON companions stale after a rollback. Rollback must retain the dual readers and companion-aware writes.

A future unknown-format recovery path should preserve journal/cache data and offer an explicit reload/export route. This proof does not introduce that path. Normal full-app costs remain unmeasured. The preceding selected-format 58-assertion proof is retained separately; these runner times are correctness execution times, not interaction latency.
