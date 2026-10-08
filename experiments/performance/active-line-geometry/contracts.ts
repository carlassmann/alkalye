import { object } from "../../../src/shared/model"
import {
	assert,
	browser,
	evaluate,
	serverAddress,
	wait,
} from "../../../tests/browser-driver"

if (process.argv.includes("--serve")) {
	let built = await Bun.build({
		entrypoints: [
			"experiments/performance/active-line-geometry/contracts-fixture.ts",
		],
		target: "browser",
	})
	if (!built.success)
		throw new AggregateError(built.logs, "Editor contract fixture failed")
	let script = built.outputs[0]
	if (!script) throw new Error("Missing editor fixture")
	let editorStyle = await Bun.file("src/client/components/editor.css").text()
	let viewportStyle = await Bun.file(
		"src/client/components/editor-viewport.css",
	).text()
	let server = Bun.serve({
		port: 0,
		routes: {
			"/": new Response(
				`<!doctype html><title>Editor anchor contracts</title><style>:root{--font-size:18px;--line-height:1.8;--editor-size:18px;--editor-leading:1.8;--editor-font:monospace;--editor-family:monospace;--background:#fff;--foreground:#111;--font-mono:monospace}*{box-sizing:border-box}body{margin:0}alkalye-editor{display:block;height:800px}${editorStyle}${viewportStyle}</style><script type="module" src="/fixture.js"></script>`,
				{ headers: { "Content-Type": "text/html" } },
			),
			"/fixture.js": new Response(script, {
				headers: { "Content-Type": "text/javascript" },
			}),
		},
		fetch: () => new Response("Missing", { status: 404 }),
	})
	console.log(server.url.href)
	process.once("SIGTERM", () => {
		server.stop(true)
		process.exit(0)
	})
} else {
	let server = Bun.spawn(
		[
			"bun",
			"experiments/performance/active-line-geometry/contracts.ts",
			"--serve",
		],
		{ stdout: "pipe", stderr: "inherit" },
	)
	let session = "editor-anchors-" + Date.now()
	try {
		browser(session, "set", "viewport", "1280", "800")
		browser(session, "open", await serverAddress(server.stdout))
		wait(session, "document.body.dataset.done==='true'")
		console.log(
			evaluate(
				session,
				"({failure:document.body.dataset.failure, results:document.body.dataset.results})",
			),
		)
		assert(
			evaluate(session, "!document.body.dataset.failure"),
			"Editor anchor contracts complete",
		)
		let results = evaluate(
			session,
			"JSON.parse(document.body.dataset.results ?? 'null')",
		)
		if (!Array.isArray(results))
			throw new Error("Missing editor contract results")
		for (let result of results) {
			let contract = object(result)
			assert(contract.exact === true, String(contract.name))
		}
		assert(results.length >= 9, "Every tail update contract ran")
	} finally {
		try {
			browser(session, "close")
		} finally {
			server.kill()
			await server.exited
		}
	}
}
