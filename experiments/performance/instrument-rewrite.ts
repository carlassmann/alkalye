import { resolve } from "node:path"

let directory = process.argv[2]
if (!directory)
	throw Error(
		"Usage: bun experiments/performance/instrument-rewrite.ts COPIED_BUILD_DIRECTORY",
	)
let root = resolve(directory)
let probe = await Bun.file(resolve(import.meta.dir, "browser-probe.js")).text()
await Bun.write(resolve(root, "__benchmark.js"), probe)
for (let name of ["app.html", "index.html"]) {
	let path = resolve(root, name)
	let html = await Bun.file(path).text()
	if (!html.includes('src="/__benchmark.js"'))
		html = html.replace(
			"<head>",
			'<head><script src="/__benchmark.js"></script>',
		)
	await Bun.write(path, html)
	await Bun.write(path + ".gz", Bun.gzipSync(new TextEncoder().encode(html)))
}
