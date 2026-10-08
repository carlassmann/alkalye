# Rejected active-line geometry cache

Production unchanged. The outside candidate cached active-line content coordinates when projection identity, caret, viewport bounds/direction and existing geometry invalidation were unchanged. It also invalidated link geometry when only the viewport's top changed. Read-only Opus review required that top invalidator; actual public geometry proof remained incomplete, so the candidate was rejected.

Six valid rich128 KiB trusted-wheel cells passed exact source and canonical selection. Largest complete main-task durations at top/middle/end were 8.63/23.23/5.38 ms before and 8.76/22.31/5.28 ms after. Layout/Paint totals did not improve consistently. One paired history at each position is insufficient to establish a gain. Range reads alone do not prove forced layout, and this trace has no CPU samples proving that active-line work caused the largest tasks.

## Provenance and limits

Both browser arms used the unchanged frozen `aad445b` native Bun backend. Candidate immutable assets differ only in the editor patch. Before each arm, the stopped disposable backend restored the same database snapshot; cloned same-origin browser profiles came from the same retained profile snapshot, with service-worker/cache state removed. The existing rich document contains 133987 characters and prior burst history. Baseline source was byte-identical to the editor source used to prepare the patch. Asset digests and requested script URLs are recorded; executed script bytes were not independently hashed.

Each cell delivered eight trusted downward wheel events, at top, middle or near end with scrolling room. Observable settlement, exact source and canonical selection were checked. Timeline-only main-thread RunTask durations include complete tasks overlapping the marked scope. Layout/Paint totals are separate inclusive event totals, not additional task time. RAF gaps (including 100–116.6 ms gaps) are retained; headless cadence is not120Hz proof. Full traces remain under `/tmp/alkalye-active-line/`.

No 1 MiB timing cells exist. Its harness treated argument string `0` as truthy and required an empty document. Diagnostic output showed the intended1048717-character document, Saved and writable on the correct route. `wheel.ts` fixes this expression only in the reproducer. The failed run is preserved; it is not an application speed regression.

The rich component fixture passed initial geometry comparisons but unexpectedly used full-document mode, so its assertion requiring an actual window-top shift failed. A bounded long-paragraph retry failed to locate the caret in the visible overlay. Neither failed gate was weakened. `failures.json` preserves both geometry failures, the1MiB harness failure and source review. `contracts-fixture.ts`/`contracts.ts` preserve the actual last attempted public runtime fixture, which remains failing. Async refinement checks claim only shifts actually observed; no successful async-shift proof is available.

## Reproduce outside production

Apply `candidate.patch` only in a disposable checkout. Build immutable before/after assets against the same native backend and cloned history/profile snapshots. Run:

```sh
bun experiments/performance/active-line-geometry/wheel.ts session /absolute/disposable-profile http://127.0.0.1:4461/app/doc/DOCUMENT /tmp/result.json desktop 133987
bun experiments/performance/active-line-geometry/contracts.ts
```

Keep agent-browser background and its daemon timeout environment stable at20000. Fixture execution must occur against the disposable candidate source and matching editor CSS. Preserve failures rather than substituting a timing result for geometry correctness.
