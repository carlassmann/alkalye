let root = import.meta.dir
let build = await Bun.build({
	entrypoints: [root + "/app.ts"],
	target: "browser",
	minify: true,
})
if (!build.success) throw new AggregateError(build.logs)
let bundle = build.outputs[0]
if (!bundle) throw Error("Missing build")
Bun.serve({
	port: 4331,
	hostname: "127.0.0.1",
	fetch(request) {
		if (new URL(request.url).pathname === "/editor.css")
			return new Response(Bun.file(root + "/editor.css"))
		return new URL(request.url).pathname === "/app.js"
			? new Response(bundle, { headers: { "content-type": "text/javascript" } })
			: new Response(Bun.file(root + "/index.html"))
	},
})
console.log("http://127.0.0.1:4331")
