import { mkdir, cp, symlink } from "node:fs/promises"
import { resolve } from "node:path"

let destination = Bun.argv[2]
if (!destination) throw new Error("Temporary output directory required")
destination = resolve(destination)
let project = resolve(Bun.argv[4] ?? process.cwd())
let indexPath = Bun.argv[3] ?? import.meta.dir + "/index.ts"
let original = await Bun.file("src/shared/crdt.ts").text()

function replace(source: string, before: string, after: string) {
	if (source.split(before).length !== 2)
		throw new Error("Prototype source anchor changed: " + before)
	return source.replace(before, after)
}

for (let variant of ["native", "atoms", "children", "both"]) {
	let directory = destination + "/" + variant
	await mkdir(directory, { recursive: true })
	await cp(project + "/src", directory + "/src", { recursive: true })
	await symlink(project + "/node_modules", directory + "/node_modules")
	let source = original
	if (variant !== "native")
		source = 'import { ForkableIndex } from "./forkable-index"\n' + source
	if (variant === "atoms" || variant === "both") {
		source = replace(
			source,
			"private atomIndex = new Map<string, { target: string; atom: Atom }>()",
			"private atomIndex = new ForkableIndex<{ target: string; atom: Atom }>()",
		)
		source = replace(
			source,
			"replica.atomIndex = yield* copyMapSteps(this.atomIndex, cooperative)",
			"replica.atomIndex = this.atomIndex.fork()",
		)
	}
	if (variant === "children" || variant === "both") {
		source = replace(
			source,
			"private children = new Map<string, Map<string, Atom[]>>()",
			"private children = new Map<string, ForkableIndex<Atom[]>>()",
		)
		source = replace(
			source,
			"replica.children.set(target, yield* copyMapSteps(children, cooperative))",
			"replica.children.set(target, children.fork())",
		)
		let fallback = "this.children.get(target) ?? new Map<string, Atom[]>()"
		if (source.split(fallback).length !== 3)
			throw new Error("Child index fallback anchors changed")
		source = source.replaceAll(
			fallback,
			"this.children.get(target) ?? new ForkableIndex<Atom[]>()",
		)
	}
	await Bun.write(directory + "/src/shared/crdt.ts", source)
	await cp(indexPath, directory + "/src/shared/forkable-index.ts")
	let journey = await Bun.file(import.meta.dir + "/journey.ts").text()
	await Bun.write(
		directory + "/journey.ts",
		journey.replaceAll("../../../src/", "./src/"),
	)
	let built = await Bun.build({
		entrypoints: [directory + "/journey.ts"],
		outdir: directory + "/assets",
		target: "browser",
		sourcemap: "external",
	})
	if (!built.success) throw new Error(built.logs.join("\n"))
	await Bun.write(
		directory + "/assets/index.html",
		'<html><body><script type="module" src="journey.js"></script></body></html>',
	)
}
console.log(destination)

let contracts = await Bun.file(import.meta.dir + "/contracts.ts").text()
await Bun.write(
	destination + "/contracts.ts",
	contracts.replaceAll("../../../src/", "./native/src/"),
)
await Bun.write(
	destination + "/contracts.test.ts",
	`import { test } from "bun:test"
import { Replica as Native } from "./native/src/shared/crdt"
import { Replica as Shared } from "./both/src/shared/crdt"
import { verifyEquivalent } from "./contracts"
test("shared index public Unicode, branch isolation and insertion order", () => verifyEquivalent(actor => new Shared(actor), actor => new Native(actor)))
`,
)
