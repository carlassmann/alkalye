# Chromium resource failures in local CI

On 2026-11-14, the auth e2e failed after account creation when navigating to
`/app/settings`. Vite module requests failed with
`net::ERR_INSUFFICIENT_RESOURCES`, leaving the Astro island unhydrated.

The cause was the user's `/tmp` tmpfs quota. A syscall trace captured Chromium
rejecting 2 MiB allocations with `EDQUOT`, meaning "Disk quota exceeded".
`/tmp` was mounted with `usrquota`. `df` still reported 13 GiB free because it
reports filesystem capacity, rather than the caller's remaining quota.
A subsequent `quotactl_fd(Q_GETQUOTA)` call for the current user reported a
53,718,868,992-byte hard limit and 53,320,200,192 bytes in use, leaving only
380 MiB. Concurrent Chromium allocations consumed that remaining quota.

Playwright launches Chromium with `--disable-dev-shm-usage`. Chromium therefore
allocates shared memory through temporary files under `TMPDIR`, which defaults
to `/tmp`. Moving only the browser process's `TMPDIR` to the disk filesystem
fixed the complete create-account, sign-out, sign-in flow, even with its
Playwright profile still under `/tmp`.

## Evidence

```text
fallocate(19</tmp/.org.chromium.Chromium.2hQ0NL>, 0, 0, 2097152) = -1 EDQUOT (Disk quota exceeded)
```

- The unchanged auth test failed with the default `/tmp`, including two parallel
  repetitions. A disk-backed `TMPDIR` passed three repetitions.
- CDP `Target.setAutoAttach` and `Network` events covered the page, SharedWorkers
  and dedicated workers. Outstanding requests peaked at 186–204. At the failed
  navigation, four Jazz streams remained pending. Module requests failed even
  though the completed requests had drained. The streams did not approach the
  browser's outstanding-request limit.
- The same test passed with unchanged app code, Jazz dependencies, backend and
  system memory pressure after changing the temporary filesystem.
- `/dev/shm` had 63 GiB available, `/tmp` had 13 GiB available, and memory pressure
  counters reported no current stalls. These numbers alone did not reveal the
  user quota.

## Reproduce or diagnose

Explicit `TMPDIR` overrides the test harness default. To reproduce the original
failure while the quota remains exhausted:

```sh
TMPDIR=/tmp PLAYWRIGHT_BASE_URL=<work-web-url> bunx playwright test e2e/auth.spec.ts:11 --retries=0
```

Trace the allocation failures, including file paths:

```sh
TMPDIR=/tmp PLAYWRIGHT_BASE_URL=<work-web-url> strace -f -yy -e trace=fallocate -e status=failed -o browser-allocations.log bunx playwright test e2e/auth.spec.ts:11 --retries=0
rg 'EDQUOT|ENOSPC|ENOMEM' browser-allocations.log
```

Use a directory on a filesystem with available user quota for `TMPDIR`. The
Linux test harness defaults to the user's cache directory for both CI warmup
and Playwright tests. It leaves Chromium's normal browser cleanup in charge of
temporary profiles and shared-memory files. Avoid increasing timeouts or
retrying hydration to mask an allocation failure.
