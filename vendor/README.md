# Patched Jazz browser runtime

`jazz-runtime-alpha.61.tar.gz` contains the generated Wasm/glue pair, matching
broker worker and expected Wasm ABI fingerprint. `bun install` installs this
archive through the root `prepare` script. CI and Vercel use these same bytes;
neither needs Rust. The existing `jazz-tools` Bun patch still applies separately.
The installer verifies the archive checksum and replaces files by rename so Bun's shared package cache stays intact. The native server runtime is unchanged. Jazz's MIT license is included here.

Source: https://github.com/garden-co/jazz/tree/397c8b810d99dc9a20440f17decb2c63ddaf0cf6

The source change is `patches/jazz-engine-alpha.61.patch`. It caches one validated
logical scalar per database, keyed by the complete immutable descriptor. A tail
extension reuses the validated prefix and updates UTF-16 metrics from the edited
fragments. Exact descriptor hits only copy their validated bytes. A different root, kind, format, hash or
divergent tail takes the original authenticated materialization path. The patch preserves the stored/sync format and text merge algorithm.

Whole-text replacements rebuild the canonical tree once their current tail has
128 edits. The existing whole-write path builds one final tree, avoiding growing
descriptor work and intermediate tree versions. Append and positional APIs keep
the original policy, and readers still accept the 4,095-edit format limit.
Jazz's text-splice storage budget and concurrent offline Unicode tests cover this.

The Wasm bridge accepts an advisory `text_splice` alongside the full replacement
and `edited_from`. It checks the replacement against the original JS strings and
reconstructs its Rust string from one decoded base. A bounded per-database cache
reuses the previous conversion only when its JavaScript value exactly matches
the original base. The core compares validated current bytes with that UTF-8
base before doing another conversion. Invalid hints, including
surrogate splits, use the original full-string decoder. It still creates a
normal `LargeValueUpdate::TextEdit`; stale-base handling stays in the core.
`patches/jazz-text-bridge-alpha.61.patch` adds the optional `editedSplices` SDK
option. The existing Bun patch carries its compiled JS and declarations.
`patches/jazz-query-snapshots-alpha.61.patch` preserves unchanged query snapshots
and notification counts. Both source patches are applied by the rebuild script.

To rebuild, use Linux, GNU tar, Clang and a clean checkout of that exact commit:

```sh
rustup toolchain install 1.93.1 --profile minimal --target wasm32-unknown-unknown
cargo +1.93.1 install wasm-bindgen-cli --version 0.2.117 --locked
WASM_BINDGEN="$HOME/.cargo/bin/wasm-bindgen" bun scripts/rebuild-jazz-runtime.ts /path/to/clean/jazz
bun scripts/install-jazz-runtime.ts
```

The rebuild script applies the patch, builds `jazz-wasm` with the pinned lockfile,
generates both binding files, and rebuilds the broker worker against that same
glue with esbuild 0.25.12. The release build matches Jazz: fat LTO, one codegen
unit, the Wasm crate at `opt-level="s"`, Binaryen 132.0.0 with
`-O -g --low-memory-unused`, then upstream symbol-hash cleanup. Its fingerprint is the SHA-256 of the patch. It preserves
the original native-server ABI fingerprint and replaces only the browser one.
Paths in Rust symbols and esbuild comments may differ across rebuild directories;
the committed archive pins the deployment artifact.

`CARGO_TARGET_DIR` is honored when reusing an existing Cargo build cache.
Run the engine checks in the patched checkout (the runner ships with the pinned
wasm-bindgen CLI):

```sh
cargo +1.93.1 test --locked -p jazz-types -p jazz-db -p jazz-wasm
CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUNNER=wasm-bindgen-test-runner cargo +1.93.1 test --locked --target wasm32-unknown-unknown -p jazz-wasm text_edit_splice_validates
```

written with gpt-6.1-sol in T3 Code (Codex)
