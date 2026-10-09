import { resolve, dirname, relative } from "node:path"

interface BundleSize {
	bytes: number
	gzipBytes: number
	files: string[]
}

let [originalDirectory, rewriteDirectory, output] = Bun.argv.slice(2)
if (!originalDirectory || !rewriteDirectory || !output)
	throw new Error(
		"Usage: bun experiments/performance/bundles.ts MAIN_ASSETS REWRITE_ASSETS OUTPUT.json",
	)

let result = {
	method:
		"Production files on disk. Static imports and HTML module preloads define initial JavaScript; dynamic imports are excluded. Gzip each file independently with Bun.gzipSync at level 9, then sum. Exclude benchmark probes, source maps, HTML, fonts, images, documents and network framing. Whiteboard is the editor's static dependency closure minus initial JavaScript. Sizes describe emitted code, not browser network traces or service-worker cache traffic.",
	original: await measure(
		originalDirectory,
		"app/index.html",
		"_astro/tldraw-canvas.",
	),
	rewrite: await measure(rewriteDirectory, "app.html", "chunks/whiteboard-"),
}
await Bun.write(output, JSON.stringify(result, null, "\t") + "\n")
console.log(JSON.stringify(result, null, "\t"))

async function measure(
	directory: string,
	htmlPath: string,
	whiteboardPrefix: string,
) {
	let root = resolve(directory)
	let files = [...new Bun.Glob("**/*").scanSync({ cwd: root, onlyFiles: true })]
	let html = await Bun.file(resolve(root, htmlPath)).text()
	let scripts = new Set<string>()
	let styles = new Set<string>()
	for (let match of html.matchAll(
		/(?:src|href|component-url|renderer-url)="([^"]+)"/g,
	)) {
		let path = match[1]
		if (!path?.startsWith("/") || path.startsWith("/__benchmark")) continue
		if (path.endsWith(".js")) scripts.add(path.slice(1))
		if (path.endsWith(".css")) styles.add(path.slice(1))
	}
	let initial = await imports(root, scripts)
	let whiteboard = files.find(
		path =>
			path.startsWith(whiteboardPrefix) &&
			/^[A-Za-z0-9_]+\.js$/.test(path.slice(whiteboardPrefix.length)),
	)
	if (!whiteboard) throw new Error("Missing whiteboard entry in " + root)
	let whiteboardFiles = await imports(root, [whiteboard])
	for (let path of initial) whiteboardFiles.delete(path)
	let initialStyles = await cssImports(root, styles)
	let whiteboardStyles = files.filter(
		path =>
			/(?:^|\/)tldraw(?:\.[^.]+)?\.css$/.test(path) && !initialStyles.has(path),
	)
	let javascript = files.filter(
		path => path.endsWith(".js") && !path.startsWith("__benchmark"),
	)
	let css = files.filter(path => path.endsWith(".css"))
	return {
		initialJavaScript: await size(root, initial),
		initialCss: await size(root, initialStyles),
		lazyWhiteboardJavaScript: await size(root, whiteboardFiles),
		lazyWhiteboardCss: await size(root, whiteboardStyles),
		documentWorkerJavaScript: await size(
			root,
			files.filter(path => path === "document-worker.js"),
		),
		allJavaScript: await size(root, javascript),
		allCss: await size(root, css),
	}
}

async function imports(root: string, entries: Iterable<string>) {
	let included = new Set<string>()
	let pending = [...entries]
	let transpiler = new Bun.Transpiler({ loader: "js" })
	while (pending.length) {
		let path = pending.pop()
		if (!path || included.has(path)) continue
		included.add(path)
		let source = await Bun.file(resolve(root, path)).text()
		for (let dependency of transpiler.scanImports(source))
			if (
				dependency.kind === "import-statement" &&
				dependency.path.endsWith(".js")
			)
				pending.push(localPath(root, path, dependency.path))
	}
	return included
}

async function cssImports(root: string, entries: Iterable<string>) {
	let included = new Set<string>()
	let pending = [...entries]
	while (pending.length) {
		let path = pending.pop()
		if (!path || included.has(path)) continue
		included.add(path)
		let source = await Bun.file(resolve(root, path)).text()
		for (let match of source.matchAll(
			/@import\s+(?:url\(\s*)?["']([^"']+)["']/g,
		))
			if (match[1]) pending.push(localPath(root, path, match[1]))
	}
	return included
}

function localPath(root: string, parent: string, dependency: string) {
	if (/^[a-z]+:/i.test(dependency))
		throw new Error("External bundle import: " + dependency)
	let path = dependency.startsWith("/")
		? resolve(root, "." + dependency)
		: resolve(root, dirname(parent), dependency)
	let result = relative(root, path)
	if (result.startsWith(".."))
		throw new Error("Bundle import escapes asset directory")
	return result
}

async function size(
	root: string,
	paths: Iterable<string>,
): Promise<BundleSize> {
	let files = [...new Set(paths)].sort()
	let bytes = 0
	let gzipBytes = 0
	for (let path of files) {
		let contents = new Uint8Array(
			await Bun.file(resolve(root, path)).arrayBuffer(),
		)
		bytes += contents.byteLength
		gzipBytes += Bun.gzipSync(contents, { level: 9 }).byteLength
	}
	return { bytes, gzipBytes, files }
}
