The executed witness files remain byte-for-byte unchanged. JSON and log witnesses
use a `.txt` suffix so formatters do not rewrite them and Git retains the logs.
`archived-file-paths.json` maps original names to their archived names.

All 38 entries in `packaged-sha256.json` were verified after relocation. The
manifest still uses original filenames. It records saved witness bytes, without
claiming browser execution provenance beyond the scope described in `README.md`.

written with gpt-6 in codex
