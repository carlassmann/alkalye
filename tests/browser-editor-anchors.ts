import * as Schema from "effect/Schema"
import { object } from "../src/shared/model"
import {
	assert,
	browser,
	browserBatch,
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
				`<!doctype html><title>Editor anchor contracts</title><style>:root{--font-size:18px;--line-height:1.8;--background:#fff;--foreground:#111;--font-mono:monospace}*{box-sizing:border-box}body{margin:0}alkalye-editor{display:block;height:800px}${editorStyle}${viewportStyle}</style><script type="module" src="/fixture.js"></script>`,
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
		let origin = await serverAddress(server.stdout)
		browser(session, "open", origin)
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
		runPointerContracts(session, origin)
	} finally {
		try {
			browser(session, "close")
		} finally {
			server.kill()
			await server.exited
		}
	}
}

function runPointerContracts(session: string, origin: string) {
	let point = Schema.Struct({
		raw: Schema.Number,
		x: Schema.Number,
		y: Schema.Number,
	})
	for (let name of ["ascii", "mixed", "rtl"]) {
		browser(session, "open", origin + "?pointer=" + name)
		wait(session, "document.body.dataset.ready==='true'")
		evaluate(session, "window.anchorPointer.reveal();true")
		let top = Schema.decodeUnknownSync(Schema.Number)(
			evaluate(session, "window.anchorPointer.state().scrollTop"),
		)
		browser(session, "open", origin + "?pointer=" + name + "&full")
		wait(session, "document.body.dataset.ready==='true'")
		let from = Schema.decodeUnknownSync(point)(
			evaluate(session, `window.anchorPointer.nativeCoordinate(65536,${top})`),
		)
		let to = Schema.decodeUnknownSync(point)(
			evaluate(session, `window.anchorPointer.nativeCoordinate(65548,${top})`),
		)
		assert(
			from.y > 0 && from.y < 800 && to.y > 0 && to.y < 800,
			name + " native glyphs are visible",
		)
		for (let full of [true, false]) {
			if (!full) {
				browser(session, "open", origin + "?pointer=" + name)
				wait(session, "document.body.dataset.ready==='true'")
				evaluate(session, "window.anchorPointer.reveal();true")
				evaluate(session, "window.anchorPointer.settle()")
			}
			browserBatch(session, [
				["mouse", "move", String(from.x), String(from.y)],
				["mouse", "down"],
			])
			assert(
				evaluate(
					session,
					`window.anchorPointer.state().publicStart===${from.raw} && window.anchorPointer.state().publicEnd===${from.raw}`,
				),
				name + " known native glyph click " + (full ? "control" : "virtual"),
			)
			browser(session, "mouse", "move", String(to.x), String(to.y))
			assert(
				evaluate(
					session,
					`window.anchorPointer.state().publicStart===${from.raw} && window.anchorPointer.state().publicEnd===${to.raw}`,
				),
				name + " held native glyph range " + (full ? "control" : "virtual"),
			)
			browser(session, "mouse", "up")
			assert(
				evaluate(
					session,
					`window.anchorPointer.state().publicStart===${from.raw} && window.anchorPointer.state().publicEnd===${to.raw} && window.anchorPointer.state().sourceExact`,
				),
				name + " released native glyph range " + (full ? "control" : "virtual"),
			)
		}
	}
	for (let dispose of [false, true]) {
		browser(session, "open", origin + "?pointer=rtl")
		wait(session, "document.body.dataset.ready==='true'")
		let result = object(
			evaluate(session, `window.anchorPointer.cancel(${dispose})`),
		)
		assert(
			result.sourceExact === true &&
				result.unchangedWindow === true &&
				(!dispose || result.detached === true),
			dispose
				? "Disposal cancels repeated deferred pointer expansion"
				: "Synthetic cancellation of repeated pointerdown preserves fragment and source",
		)
	}
}
