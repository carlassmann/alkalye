# Worker projection CPU profile

Actual native one-range and 512-range Undo journeys pass complete source, selection direction, caret and accepted edit/Undo checks. CPU sampling runs only in Undo observation windows. This diagnoses cost; its task durations are not a clean comparative benchmark.

The sampled profile owner matches the largest DedicatedWorker task's process/thread, and sampled frames point to the pinned `worker-editor.js`. Main-page sampling is not used as worker attribution. Source-map locations use the pinned emitted map.

The largest tasks take 197ms and 200ms. Their call path reaches opened capabilities' `materialize()` through `session.replica.documents()`, then `rawVisibleSteps` and text visibility checks. `rawVisibleSteps` has about 51–52ms self cost and 137–139ms inclusive cost. Visibility, frontmatter transforms and other descendants contribute overlapping samples. These inclusive costs cannot be added. The mapper is not the dominant task here.

The view points to the current projection Replica. This does not prove that the separately accepted/durable Replica is cold, or justify substituting optimistic editor text for authoritative state. Existing version-based opened snapshot caching still rebuilds on each version change. The next experiment must audit that ownership and remove the repeated source rebuild without weakening metadata, permission or recovery semantics.

All owned browser contexts and the managed server closed before parsing. Raw traces, profiles and closed databases remain private outside the repository. Native result and bundle/source-map pins are retained here. No production change, retained-heap, capacity or physical 120Hz claim.

written with gpt-6 in codex
