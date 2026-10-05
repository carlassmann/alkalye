import { afterAll, beforeAll, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DEFAULT_EMBED_DEFINITIONS } from "tldraw"
import { build } from "../build"

let directory = await mkdtemp(join(tmpdir(), "alkalye-tldraw-build-"))
let metadata: Bun.BuildMetafile | undefined
beforeAll(async () => {
	metadata = await build(directory)
})
afterAll(async () => {
	await rm(directory, { recursive: true, force: true })
})

test("tldraw and React remain outside the initial application graph", () => {
	if (!metadata) throw new Error("Missing bundle metadata")
	let visited = new Set<string>()
	let initial = new Set<string>()
	function visit(path: string) {
		if (!metadata || visited.has(path)) return
		let output = metadata.outputs[path]
		if (!output) throw new Error("Missing bundle output " + path)
		visited.add(path)
		for (let input of Object.keys(output.inputs)) initial.add(input)
		for (let imported of output.imports)
			if (imported.kind === "import-statement") visit(imported.path)
	}
	visit("./app.js")
	let drawingPackage =
		/node_modules\/(?:tldraw|@tldraw|react|react-dom|scheduler)\//
	expect([...initial].filter(path => drawingPackage.test(path))).toEqual([])
	expect(
		Object.keys(metadata.inputs).some(path =>
			/node_modules\/tldraw\//.test(path),
		),
	).toBe(true)
})

test("the offline shell caches every local tldraw asset", async () => {
	let worker = await Bun.file(join(directory, "sw.js")).text()
	for (let path of [
		"/tldraw/tldraw.css",
		"/tldraw/icons/0_merged.svg",
		...DEFAULT_EMBED_DEFINITIONS.map(
			definition => "/tldraw/embed-icons/" + definition.type + ".png",
		),
		"/tldraw/translations/en.json",
		"/tldraw/translations/de.json",
	]) {
		expect(worker).toContain(JSON.stringify(path))
		expect(await Bun.file(join(directory, path)).exists()).toBe(true)
	}
	expect(worker).not.toContain("BUILD_TLDRAW")
	let style = await Bun.file(join(directory, "app.css")).text()
	expect(style).not.toContain("/tldraw/tldraw.css")
})
