import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
	cp,
	link,
	mkdir,
	mkdtemp,
	readFile,
	unlink,
	writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve, join } from "node:path"
import { build } from "esbuild"

let root = process.cwd()
let source = process.argv[2]
if (!source)
	throw new Error(
		"Usage: bun scripts/rebuild-jazz-runtime.ts <clean Jazz checkout>",
	)
source = resolve(source)
let revision = "397c8b810d99dc9a20440f17decb2c63ddaf0cf6"
if (run("git", ["rev-parse", "HEAD"], source).trim() !== revision)
	throw new Error(`Expected Jazz ${revision}`)
let patch = await readFile(join(root, "patches/jazz-engine-alpha.61.patch"))
let fingerprint = createHash("sha256").update(patch).digest("hex")
for (let name of [
	"jazz-engine-alpha.61.patch",
	"jazz-query-snapshots-alpha.61.patch",
	"jazz-text-bridge-alpha.61.patch",
]) {
	let path = join(root, "patches", name)
	run("git", ["apply", "--check", path], source)
	run("git", ["apply", path], source)
}
run(
	"cargo",
	[
		"+1.93.1",
		"build",
		"--locked",
		"--release",
		"--target",
		"wasm32-unknown-unknown",
		"-p",
		"jazz-wasm",
	],
	source,
	{ JAZZ_NATIVE_ARTIFACT_FINGERPRINT: fingerprint },
)
let staging = await mkdtemp(join(tmpdir(), "alkalye-jazz-runtime-"))
let pkg = join(staging, "jazz-wasm/pkg")
await mkdir(pkg, { recursive: true })
run(
	process.env.WASM_BINDGEN ?? "wasm-bindgen",
	[
		join(
			resolve(source, process.env.CARGO_TARGET_DIR ?? "target"),
			"wasm32-unknown-unknown/release/jazz_wasm.wasm",
		),
		"--target",
		"web",
		"--out-dir",
		pkg,
	],
	source,
)
await unlink(join(pkg, "jazz_wasm_bg.wasm.d.ts"))
let runtime = join(source, "packages/jazz-tools/src/runtime")
await cp(
	join(
		root,
		"node_modules/jazz-tools/dist/runtime/native-artifact-fingerprint-napi.js",
	),
	join(runtime, "native-artifact-fingerprint-napi.ts"),
)
let fingerprintModule = `export const EXPECTED_WASM_ARTIFACT_FINGERPRINT = "${fingerprint}";\n`
await writeFile(
	join(runtime, "native-artifact-fingerprint-wasm.ts"),
	fingerprintModule,
)
let worker = join(staging, "jazz-tools/dist/worker")
await mkdir(worker, { recursive: true })
await build({
	entryPoints: [
		join(source, "packages/jazz-tools/src/worker/jazz-broker-worker.ts"),
	],
	outfile: join(worker, "jazz-broker-worker.js"),
	alias: { "jazz-wasm": join(pkg, "jazz_wasm.js") },
	nodePaths: [join(root, "node_modules")],
	bundle: true,
	format: "esm",
	platform: "browser",
	target: "es2022",
	legalComments: "none",
})
await link(join(pkg, "jazz_wasm_bg.wasm"), join(worker, "jazz_wasm_bg.wasm"))
await mkdir(join(staging, "jazz-tools/dist/runtime"), { recursive: true })
await writeFile(
	join(staging, "jazz-tools/dist/runtime/native-artifact-fingerprint-wasm.js"),
	fingerprintModule,
)
run(
	"tar",
	[
		"--sort=name",
		"--mtime=@0",
		"--owner=0",
		"--group=0",
		"--numeric-owner",
		"-czf",
		join(root, "vendor/jazz-runtime-alpha.61.tar.gz"),
		"-C",
		staging,
		"jazz-wasm",
		"jazz-tools",
	],
	root,
)
await writeFile(
	join(root, "vendor/jazz-runtime-alpha.61.json"),
	JSON.stringify(
		{
			source: revision,
			enginePatchSha256: fingerprint,
			archiveSha256: createHash("sha256")
				.update(
					await readFile(join(root, "vendor/jazz-runtime-alpha.61.tar.gz")),
				)
				.digest("hex"),
		},
		null,
		"\t",
	) + "\n",
)
console.log("Built vendor/jazz-runtime-alpha.61.tar.gz")

function run(
	command: string,
	args: string[],
	cwd: string,
	environment: Record<string, string> = {},
) {
	return execFileSync(command, args, {
		cwd,
		env: { ...process.env, ...environment },
		encoding: "utf8",
		stdio: ["ignore", "pipe", "inherit"],
	})
}
