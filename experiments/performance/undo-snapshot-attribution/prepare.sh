#!/bin/sh
set -eu
experiment=/tmp/alkalye-production-undo-residual/current-7d7df3d
repository=/Users/carlassmann/.codex/worktrees/b513/alkalye
frozen_commit=7d7df3dcfb8179915c5b214e1392e955e63d7430
expected_entry=975b170156faf1a3118288ac61a5f3d6f0a64bc37b5745a27e0a98a038b67a48
if test -e "$experiment/preparation-pending.json"; then
 echo 'Retained preparation; inspect before retry' >&2
 exit 1
fi
printf '{"stage":"before-preparation","commit":"%s"}\n' "$frozen_commit" > "$experiment/preparation-pending.json"
mkdir "$experiment/app-runtime"
git -C "$repository" archive "$frozen_commit" src public build.ts tsconfig.json package.json bun.lock tests/browser-driver.ts .prettierrc | tar -x -C "$experiment/app-runtime"
ln -s "$repository/node_modules" "$experiment/app-runtime/node_modules"
cp "$experiment/production-body-gate.ts" "$experiment/server-journey.ts" "$experiment/work.config.js" "$experiment/tsconfig.journey.json" "$experiment/app-runtime/"
cp -R "$experiment/experiments" "$experiment/app-runtime/"
cp -R "$experiment/app-runtime/src" "$experiment/control-src"
cp -R "$experiment/app-runtime/src" "$experiment/candidate-src"
(cd "$experiment/app-runtime" && git init -q -b codex/undo-residual)
(cd "$experiment/app-runtime" && bun node_modules/typescript/bin/tsc --noEmit --project tsconfig.journey.json)
(cd "$experiment/app-runtime" && bun run build)
actual_entry=$(shasum -a 256 "$experiment/app-runtime/dist/app.js" | cut -d ' ' -f 1)
if test "$actual_entry" != "$expected_entry"; then
 echo 'Frozen reference entry digest mismatch; no keys' >&2
 exit 1
fi
cp -R "$experiment/app-runtime/dist" "$experiment/control-dist"
(cd "$experiment/app-runtime" && git apply "$experiment/markers.patch")
(cd "$experiment/app-runtime" && bun node_modules/typescript/bin/tsc --noEmit --project tsconfig.journey.json)
(cd "$experiment/app-runtime" && bun run build)
cp -R "$experiment/app-runtime/src/." "$experiment/candidate-src/"
cp -R "$experiment/app-runtime/dist" "$experiment/candidate-dist"
printf '{"stage":"types-and-build-ready","commit":"%s","baselineEntrySHA256":"%s"}\n' "$frozen_commit" "$actual_entry" > "$experiment/preparation-ready.json"
