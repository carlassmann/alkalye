# Draft: same-origin HTTP transport discovery waits 10 seconds behind Vite

Jazz `2.0.0-alpha.61`, Vite `7.3.1`, Astro `5.17.2`, Chromium on Linux. Local SQLite backend. Observed on 2026-11-13. This draft has not been submitted upstream.

## Result

Alkalye's slow auth came from unanswered WebSocket upgrades in development. Its Node production preview already recovered accounts in under a second. The earlier handoff's 31–44 seconds measured complete test flows, including navigation and setup, rather than backend authentication alone.

Seconds, one representative run per configuration, fresh browser contexts with warm server transforms:

| Flow / milestone                            | Dev before | Dev after | Node build before | Node build after |
| ------------------------------------------- | ---------: | --------: | ----------------: | ---------------: |
| First visit, local editor ready             |      1.423 |     1.489 |             0.878 |            0.907 |
| First visit, backend admitted               |     11.125 |     1.139 |             0.906 |            0.924 |
| Signup, show recovery words                 |      0.178 |     0.151 |             0.165 |            0.149 |
| Signup, finish backup                       |      0.097 |     0.107 |             0.109 |            0.123 |
| Fresh-profile recovery, editor ready        |     20.348 |     0.622 |             0.536 |            0.657 |
| Existing session reload, local editor ready |      0.777 |     0.854 |             0.347 |            0.395 |
| Existing session reload, backend admitted   |     10.666 |     0.861 |             0.356 |            0.409 |

Signup here backs up the device account already created on the first visit. Showing words exports its existing key; submitting marks that key backed up. Neither operation creates another account or waits for backend admission.

Cold Vite transforms add a separate startup cost. After a restart, first-visit editor/admission were 8.331/17.992 seconds before, versus 8.136/8.160 seconds after. Warm runs above isolate the transport delay. These are diagnostic samples, not statistical latency percentiles or measurements of Jazz Cloud/Vercel.

## Phase measurements

Milliseconds from navigation for first visit/reload, and from the login-submit action for recovery. The account column marks entry to the configured local-first loader. Jazz already selected the account before invoking it. It bounds account creation/selection, rather than timing the synchronous key operation in isolation. Client ready is the first `AccountApp` render after Jazz opened that account's database. App module load occurs before account selection.

| Runtime / flow         |     App module | Account selected, replica opening | Client ready | Admitted | Authoritative read complete | Editor ready |
| ---------------------- | -------------: | --------------------------------: | -----------: | -------: | --------------------------: | -----------: |
| Dev before / first     |            536 |                               647 |          789 |    11125 |                 not awaited |         1423 |
| Dev after / first      |            540 |                               651 |          776 |     1139 |                 not awaited |         1489 |
| Dev before / reload    |            301 |                               440 |          519 |    10666 |                 not awaited |          777 |
| Dev after / reload     |            330 |                               417 |          530 |      861 |                 not awaited |          854 |
| Dev before / recovery  | already loaded |                              9812 |         9886 |    20057 |                       20105 |        20348 |
| Dev after / recovery   | already loaded |                                80 |          144 |      307 |                         353 |          622 |
| Node before / first    |            169 |                               230 |          319 |      906 |                 not awaited |          878 |
| Node after / first     |            147 |                               207 |          292 |      924 |                 not awaited |          907 |
| Node before / reload   |             40 |                                95 |          166 |      356 |                 not awaited |          347 |
| Node after / reload    |            102 |                               130 |          196 |      409 |                 not awaited |          395 |
| Node before / recovery | already loaded |                                86 |          123 |      290 |                         341 |          536 |
| Node after / recovery  | already loaded |                                81 |          120 |      315 |                         383 |          657 |

First visit and reload use local subscriptions and can open before admission; there is no blocking authoritative `db.all` to time on those paths. Recovery intentionally waits for remote documents before choosing an account document or requested private link. That read took 48 → 46 ms in dev and 51 → 68 ms in the Node build. Removing it would reintroduce incorrect routing and transient access-denied screens.

## Cause, traced to source

At tag `v2.0.0-alpha.61`:

- `packages/jazz-tools/src/runtime/native-runtime/http-stream-socket.ts`: `SOCKET_OPEN_DEADLINE_MS = 10_000`. `httpStreamFallbackWebSocket` first opens a native socket. Only its error/deadline triggers a POST probe of `/ws`. A 426 with `x-jazz-stream: 1` then selects `HttpStreamSocket`.
- Vite's HMR upgrade handler in `node_modules/vite/dist/node/chunks/config.js` only handles `vite-hmr` and `vite-ping` protocols on its HMR path. Other upgrades get no response. Alkalye mounts `jazz.handle` as an Astro fetch route and has no Jazz WebSocket attachment.
- `packages/jazz-tools/src/session/state.ts`: account replacement stops the previous client before opening the new replica. Its graceful shutdown can wait for the guest's pending settings/welcome-document uploads. A fresh profile restored immediately after opening therefore pays the remaining guest timeout, followed by the restored account's timeout. Dev recovery reached replica opening at 9.812 seconds and admission at 20.057 seconds. This is transport wait, not phrase derivation.

The standalone Vite reproduction, with no Astro/React/Alkalye UI, measured client ready at 179 ms, admission at 10372 ms and its first remote query complete at 10411 ms. CDP on its SharedWorker recorded:

1. Native WebSocket handshake starts.
2. No response for 9999 ms; Jazz closes the socket.
3. POST `/ws` gets 426 in 4.0 ms.
4. POST `/stream` gets 200 in 3.8 ms.
5. Admission and the query finish immediately afterward.

With the upgrade rejected explicitly, the same reproduction measured client ready at 129 ms, admission at 306 ms and remote query complete at 345 ms.

Wasm, SQLite and account creation finish before the long gap. HTTP stream responses are delivered promptly. No slow streaming buffer, key derivation or repeated auth rejection is needed to explain it. The expected backend-user 401 means this device account has no external cookie login; device admission subsequently succeeds.

## Alkalye fix and upstream proposal

`scripts/jazz-dev-transport.ts` adds a development-only Vite plugin. It answers only `/jazz/apps/<id>/ws` upgrades with 426 and closes the socket. Jazz's existing POST probe still decides transport availability and checks origins. Vite HMR remains handled by Vite. No global WebSocket replacement, private Jazz import, dropped upload or shortened Jazz security timeout is involved.

Auth e2e waits return from 30 to 10 seconds. All four `e2e/auth.spec.ts` cases pass with their existing content, URL and access-denied assertions. The complete scenarios take 12.7–19.7 seconds each because they also navigate repeatedly, create documents and use fresh profiles. `check:types`, `check:lint` and all 630 tests pass. The full format check still flags nine unchanged MCP/OAuth route files from the migration baseline; changed files pass formatting.

Proposed Jazz improvement: let clients select HTTP streaming explicitly, or probe a known same-origin endpoint concurrently with an unanswered upgrade. A 426 with the stream marker can switch promptly; an endpoint advertising real upgrades should keep the current retry safeguards. The server-side rejection is Alkalye's workaround; no Jazz package patch is needed.

## Reproduce outside Alkalye

Copy `auth-transport-repro.mjs` as `repro.mjs` and `auth-transport-repro.html` as `index.html` into an empty directory. Install there:

```sh
bun add jazz-tools@2.0.0-alpha.61 vite@7.3.1
node repro.mjs
```

Open http://localhost:4123 in background agent-browser. Inspect console timings, then restart with `REJECT_UPGRADES=1 node repro.mjs` and use a fresh profile. Both runs use the public Jazz client/backend APIs and a single empty table. The remote query is necessary to activate sync. Permissions deny table access; the authoritative empty result is enough to exercise the transport.

For a Work-managed tailnet run, configure `web.run` as `node repro.mjs`, call `work setup --tailscale` and `work up --tailscale`, and set `WORK_WEB_URL` to the URL from `work urls`. If dependencies are symlinked outside the reproduction directory, Vite also needs those real paths in `server.fs.allow`. Ordinary installations do not.

## Repeat the Alkalye measurements

`auth-timing.json` contains the phase numbers above. `auth-timing.patch` is temporary instrumentation for `src/app/main.tsx`; it was removed from the implementation. Apply it with `git apply docs/jazz-v2-issues/auth-timing.patch`.

Start background agent-browser, obtain its CDP URL with `agent-browser --session <name> get cdp-url`, then run:

```sh
CDP_URL=<url> AUTH_URL=<app-url> AUTH_OUTPUT=/tmp/auth-timing.json \
  node docs/jazz-v2-issues/measure-auth.mjs
```

The harness creates and closes its own browser contexts, uses `performance.mark`, observes Jazz's page sync handle at 5 ms intervals, captures page CDP request timing, and observes the existing editor-ready signal. It keeps the phrase only in memory. Signup action timings include browser automation overhead; the other reported milestones come from page marks. SharedWorker requests require a separate worker CDP attachment; page CDP alone cannot see sync traffic.

For production, build with `ALKALYE_LOCAL_PREVIEW=1 bun x astro build`, then start its Node standalone server through a separate Work project with its own SQLite directory. Restart that server after each rebuild. Do not measure while building/checking: optimizer changes can invalidate a running Vite server. Restart dev afterward. Remove the instrumentation with `git apply -R docs/jazz-v2-issues/auth-timing.patch`.

Measured URLs:

- Dev: https://web-t3-diagnose-auth-admission-alkalye.cshed.carlassmann.com
- Node preview: https://web-main-alkalye-auth.cshed.carlassmann.com
- Standalone reproduction: https://web-main-jazz-auth-repro.cshed.carlassmann.com

written with gpt-6.1-sol in T3 Code (Codex)
