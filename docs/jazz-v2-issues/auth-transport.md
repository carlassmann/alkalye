# Discover HTTP streaming before an unanswered WebSocket upgrade times out

Jazz `2.0.0-alpha.61`, Vite `7.3.1`, Astro `5.17.2`, Chromium on Linux,
local SQLite. Unsubmitted transport issue, measured 2026-11-13.

## Observed behavior

A fetch-only Jazz backend mounted under Vite leaves WebSocket upgrades
unanswered. Jazz waits its 10-second socket deadline before probing HTTP
streaming. Account recovery can pay the delay for the guest's pending uploads
and again for the restored replica. The local editor opens before admission.
See [phase measurements](auth-timing.json),
[temporary instrumentation](auth-timing.patch) and
[measurement harness](measure-auth.mjs).

Seconds, one representative sample per configuration, fresh contexts and warm
Vite transforms:

| Milestone                     | Dev before | Dev after | Node preview before | Node preview after |
| ----------------------------- | ---------: | --------: | ------------------: | -----------------: |
| First visit, local editor     |      1.423 |     1.489 |               0.878 |              0.907 |
| First visit, backend admitted |     11.125 |     1.139 |               0.906 |              0.924 |
| Fresh-profile recovery editor |     20.348 |     0.622 |               0.536 |              0.657 |
| Reload, backend admitted      |     10.666 |     0.861 |               0.356 |              0.409 |

These are diagnostic samples, not percentiles. Production here means a local
Node build, not Jazz Cloud/Vercel. The full phase data separates account
selection, replica opening, admission, authoritative reads and editor readiness.
Recovery's authoritative read took 48 / 46 ms before / after in dev; removing
it would not fix the transport delay. [Data](auth-timing.json).

## Source and standalone reproduction

Upstream [http-stream-socket.ts](https://github.com/garden-co/jazz/blob/v2.0.0-alpha.61/packages/jazz-tools/src/runtime/native-runtime/http-stream-socket.ts)
sets `SOCKET_OPEN_DEADLINE_MS = 10_000`. Only a WebSocket error/deadline starts
the POST `/ws` probe. A 426 with `x-jazz-stream: 1` selects HTTP streaming.
[Session state](https://github.com/garden-co/jazz/blob/v2.0.0-alpha.61/packages/jazz-tools/src/session/state.ts)
stops the previous replica before opening its replacement.

Copy [auth-transport-repro.mjs](auth-transport-repro.mjs) to `repro.mjs` and
[auth-transport-repro.html](auth-transport-repro.html) to `index.html` in an empty
directory. No Astro, React or Alkalye code is needed:

```sh
bun add jazz-tools@2.0.0-alpha.61 vite@7.3.1
node repro.mjs
# Open http://localhost:4123 in a fresh browser profile; compare after restarting:
REJECT_UPGRADES=1 node repro.mjs
```

The server optionally rejects upgrades. The page opens a device account and
queries remotely to activate sync. Table permissions deny access; an empty
remote result suffices. Inspect console timings. The Alkalye phase harness
requires background agent-browser/CDP; its instructions are below.

## Workaround and request

Alkalye's development-only [Vite plugin](../../scripts/jazz-dev-transport.ts)
rejects only `/jazz/apps/<id>/ws` upgrades with 426. Jazz's existing POST probe
still determines stream support. No Jazz package patch is involved; HMR stays
under Vite. [Registration](../../astro.config.ts).

Please allow explicit HTTP-stream selection or concurrent capability discovery.
A silent upgrade should not impose the full socket deadline when the backend
can immediately advertise streaming support.

## Repeat the Alkalye phase measurements

The instrumentation patch targets the historical app layout and is not shipped.
Use its base layout or adapt the marks to the current `src/app/main.tsx` before
running the harness. First check it with
`git apply --check docs/jazz-v2-issues/auth-timing.patch`.

Start background agent-browser and obtain its CDP URL, then run:

```sh
CDP_URL=<url> AUTH_URL=<app-url> AUTH_OUTPUT=/tmp/auth-timing.json \
  node docs/jazz-v2-issues/measure-auth.mjs
```

The harness creates fresh contexts and closes them, records performance marks,
and keeps the phrase in memory. Page CDP does not see SharedWorker sync requests;
attach separately to that target for network phases. For a local production
comparison build with `ALKALYE_LOCAL_PREVIEW=1 bun x astro build` and use an
isolated SQLite store. Restart dev after checks that invalidate Vite's optimized
dependencies. [Harness](measure-auth.mjs), [backend](../../src/jazz/server.ts).

written with gpt-6.1-sol in T3 Code (Codex)
