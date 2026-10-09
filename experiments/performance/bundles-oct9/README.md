# Fresh main and rewrite bundle comparison

Main `a749728` was exported through Git archive and built with its unchanged lockfile and existing matching dependency installation. `bun run build` passed Astro checks (zero errors/warnings, 45 hints) and the production build. The first build failed because its required public sync URL was absent; that log is retained. The successful build uses a synthetic local sync URL, with no credentials. Rewrite `514e1bb` uses the production build deployed after the partitioned atom index change.

| Emitted code, gzip bytes              |      Main |   Rewrite |
| ------------------------------------- | --------: | --------: |
| Initial JavaScript                    | 1,280,352 |   352,170 |
| Initial CSS                           |    36,506 |    31,950 |
| Additional lazy whiteboard JavaScript |   514,060 |   592,188 |
| Additional lazy whiteboard CSS        |         0 |    19,289 |
| Standalone document worker            |         0 |    51,235 |
| All emitted JavaScript                | 2,692,986 | 1,029,457 |

Initial JavaScript is 72.5% smaller. The lazy whiteboard JavaScript is 15.2% larger; main includes its whiteboard CSS in initial CSS. Keeping tldraw asynchronous avoids adding these costs to initial JavaScript.

The calculator follows static JavaScript imports and HTML preloads, then gzips each file independently at level 9. Lazy whiteboard figures subtract shared initial dependencies. All emitted JavaScript includes optional modules and service-worker code. Initial figures are not the ready-document network closure, browser cache traffic or measured loading latency. Font/image/HTML/network framing and source maps are excluded. Worker bytes are reported separately and also included in all emitted JavaScript.

`bundles.json` contains exact file sets and byte counts. Source and emitted asset pins identify this comparison. Build logs and the calculator are preserved as text. No user data, browser profiles or keys are included.

written with gpt-6 in codex
