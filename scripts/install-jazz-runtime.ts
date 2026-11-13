import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	renameSync,
	rmSync,
} from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

let root = fileURLToPath(new URL("../", import.meta.url))
let archive = join(root, "vendor/jazz-runtime-alpha.61.tar.gz")
let manifest = JSON.parse(
	readFileSync(join(root, "vendor/jazz-runtime-alpha.61.json"), "utf8"),
)
if (
	createHash("sha256").update(readFileSync(archive)).digest("hex") !==
	manifest.archiveSha256
)
	throw new Error("Patched Jazz runtime checksum mismatch")
let modules = join(root, "node_modules")
let staging = mkdtempSync(join(modules, ".jazz-runtime-"))
let files = [
	"jazz-wasm/pkg/jazz_wasm.js",
	"jazz-wasm/pkg/jazz_wasm.d.ts",
	"jazz-wasm/pkg/jazz_wasm_bg.wasm",
	"jazz-tools/dist/worker/jazz-broker-worker.js",
	"jazz-tools/dist/worker/jazz_wasm_bg.wasm",
	"jazz-tools/dist/runtime/native-artifact-fingerprint-wasm.js",
]
try {
	execFileSync("tar", [
		"-xzf",
		join(root, "vendor/jazz-runtime-alpha.61.tar.gz"),
		"-C",
		staging,
	])
	for (let file of files) {
		let destination = join(modules, file)
		mkdirSync(dirname(destination), { recursive: true })
		// Rename breaks Bun's package-cache hardlinks without changing other worktrees.
		renameSync(join(staging, file), destination)
	}
} finally {
	rmSync(staging, { recursive: true, force: true })
}
