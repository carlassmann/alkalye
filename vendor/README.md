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
divergent tail takes the original authenticated materialization path. The patch
does not change the wire format, text merge algorithm or write API.

To rebuild, use Linux, GNU tar, Clang and a clean checkout of that exact commit:

```sh
rustup toolchain install 1.93.1 --profile minimal --target wasm32-unknown-unknown
cargo +1.93.1 install wasm-bindgen-cli --version 0.2.117 --locked
WASM_BINDGEN="$HOME/.cargo/bin/wasm-bindgen" bun scripts/rebuild-jazz-runtime.ts /path/to/clean/jazz
bun scripts/install-jazz-runtime.ts
```

The rebuild script applies the patch, builds `jazz-wasm` with the pinned lockfile,
generates both binding files, and rebuilds the broker worker against that same
glue with esbuild 0.25.12. Its fingerprint is the SHA-256 of the patch. It preserves
the original native-server ABI fingerprint and replaces only the browser one.
Paths in Rust symbols and esbuild comments may differ across rebuild directories;
the committed archive pins the deployment artifact.

Run the engine checks in the patched checkout:

```sh
cargo +1.93.1 test --locked -p jazz-types -p jazz-db
```

written with gpt-6.1-sol in T3 Code (Codex)
