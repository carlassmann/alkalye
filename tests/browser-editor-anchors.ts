import { object } from "../src/shared/model"
import {
	assert,
	browser,
	evaluate,
	serverAddress,
	wait,
} from "./browser-driver"

if (process.argv.includes("--serve")) {
	let built = await Bun.build({
		entrypoints: ["tests/browser-editor-anchor-fixture.ts"],
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
				`<!doctype html><title>Editor anchor contracts</title><style>:root{--font-size:18px;--line-height:1.8;--background:#fff;--foreground:#111;--font-mono:monospace}body{margin:0}alkalye-editor{display:block;height:800px}${editorStyle}${viewportStyle}</style><script type="module" src="/fixture.js"></script>`,
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
		["bun", "tests/browser-editor-anchors.ts", "--serve"],
		{ stdout: "pipe", stderr: "inherit" },
	)
	let session = "editor-anchors-" + Date.now()
	try {
		browser(session, "set", "viewport", "1280", "800")
		browser(session, "open", await serverAddress(server.stdout))
		wait(session, "document.body.dataset.done==='true'")
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
		assert(results.length === 26, "Every editor anchor contract ran")
	} finally {
		try {
			browser(session, "close")
		} finally {
			server.kill()
			await server.exited
		}
	}
}
