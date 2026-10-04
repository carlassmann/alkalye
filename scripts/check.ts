import { readdir } from "node:fs/promises"
import { isBuiltin } from "node:module"
import { resolve } from "node:path"
import { checkEffects } from "./effect-check"

let manifest: {
	dependencies?: Record<string, string>
	optionalDependencies?: Record<string, string>
	peerDependencies?: Record<string, string>
} = await Bun.file("package.json").json()
if (Object.keys(manifest.dependencies ?? {}).join() !== "effect")
	throw new Error("Only Effect is allowed as a runtime dependency")
for (let dependencies of [
	manifest.optionalDependencies,
	manifest.peerDependencies,
])
	if (Object.keys(dependencies ?? {}).length)
		throw new Error("Additional runtime dependencies are forbidden")
let effectManifest = await Bun.file("node_modules/effect/package.json").json()
if (Object.keys(effectManifest.dependencies ?? {}).length)
	throw new Error("Effect must have no transitive runtime dependencies")

let failures: string[] = []
let transpiler = new Bun.Transpiler({ loader: "ts" })
async function inspect(path: string) {
	let source = await Bun.file(path).text()
	let browser = path.includes("/client/") || path.includes("/shared/")
	if (/\b(?:from|import)\s*\(?["'][^"']*tests\//.test(source))
		failures.push(`${path}: production code cannot import test fixtures`)
	for (let imported of transpiler.scanImports(
		source.replace(/^#![^\n]*\n/, ""),
	)) {
		let specifier = imported.path
		if (specifier === "crypto" || specifier === "node:crypto") {
			failures.push(
				`${path}: use the Effect Crypto service through the platform adapter`,
			)
			continue
		}
		if (specifier === "effect" || specifier === "effect/http") {
			failures.push(
				`${path}: use an Effect module subpath to preserve tree shaking`,
			)
			continue
		}
		if (
			specifier.startsWith(".") ||
			specifier === "effect" ||
			specifier.startsWith("effect/")
		)
			continue
		if (
			!browser &&
			(specifier === "bun" ||
				specifier.startsWith("bun:") ||
				isBuiltin(specifier))
		)
			continue
		failures.push(`${path}: forbidden runtime import ${specifier}`)
	}
}
async function inspectDirectory(directory: string) {
	for (let entry of await readdir(directory, { withFileTypes: true })) {
		let path = resolve(directory, entry.name)
		if (entry.isDirectory()) await inspectDirectory(path)
		else if (entry.name.endsWith(".ts")) await inspect(path)
	}
}
await inspectDirectory("src")
await inspect(resolve("cli.ts"))
if (failures.length) throw new Error(failures.join("\n"))
checkEffects()
let checks = ["check:types", "check:format", "check:test"]
let results = await Promise.all(
	checks.map(async script => {
		let process = Bun.spawn(["bun", "run", script], {
			stdout: "inherit",
			stderr: "inherit",
		})
		return process.exited
	}),
)
if (results.some(code => code !== 0)) process.exitCode = 1
