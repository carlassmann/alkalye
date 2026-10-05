import * as Effect from "effect/Effect"
import { assert, browser, evaluate, wait } from "./browser-driver"

if (process.argv.includes("--serve")) {
	let build = await Bun.build({
		entrypoints: ["tests/fixtures/dialog.ts"],
		target: "browser",
		minify: true,
	})
	if (!build.success || !build.outputs[0])
		throw new Error("Fixture build failed")
	let script = await build.outputs[0].text()
	let fixture = Bun.serve({
		port: 0,
		fetch(request) {
			let path = new URL(request.url).pathname
			if (path === "/fixture.js")
				return new Response(script, {
					headers: { "content-type": "text/javascript" },
				})
			if (path === "/app.css") return new Response(Bun.file("public/app.css"))
			if (path === "/dialog.css")
				return new Response(Bun.file("src/client/components/dialog.css"))
			return new Response(
				'<!doctype html><link rel="stylesheet" href="/app.css"><link rel="stylesheet" href="/dialog.css"><button id="confirm">Delete</button><button id="prompt">Rename</button><button id="replace">Commands</button><output></output><dialog id="dialog" data-dialog></dialog><script type="module" src="/fixture.js"></script>',
				{ headers: { "content-type": "text/html" } },
			)
		},
	})
	console.log(fixture.url.href)
	await Effect.runPromise(Effect.never)
}
let server = Bun.spawn(["bun", import.meta.path, "--serve"], {
	stdout: "pipe",
	stderr: "inherit",
})
let output = await server.stdout.getReader().read()
if (!output.value) throw new Error("Missing fixture URL")
let url = new TextDecoder().decode(output.value).trim()
let session = "dialogs-" + Date.now()
try {
	browser(session, "open", url)
	browser(session, "click", "#confirm")
	wait(session, 'document.querySelector("#dialog").open')
	browser(session, "press", "Escape")
	wait(session, 'document.querySelector("output").textContent === "cancelled"')
	assert(true, "Escape cancels the destructive action")
	browser(session, "click", "#confirm")
	browser(session, "click", "#submit-dialog")
	wait(session, 'document.querySelector("output").textContent === "true"')
	assert(true, "Confirm completes exactly the requested action")
	browser(session, "click", "#prompt")
	browser(session, "fill", '#dialog [name="value"]', "A new title")
	browser(session, "press", "Enter")
	wait(
		session,
		'document.querySelector("output").textContent === "A new title"',
	)
	assert(true, "Enter submits the prompt value")
	browser(session, "click", "#replace")
	browser(session, "click", "#next")
	browser(session, "wait", "100")
	assert(
		evaluate(
			session,
			'document.querySelector("output").textContent === "pending" && document.querySelector("#dialog").open',
		),
		"A previous close event cannot cancel the next dialog",
	)
	browser(session, "fill", '#dialog [name="value"]', "From the palette")
	browser(session, "press", "Enter")
	wait(
		session,
		'document.querySelector("output").textContent === "From the palette"',
	)
	assert(true, "The replacement dialog remains usable")
	browser(session, "click", "#prompt")
	browser(session, "press", "F2")
	wait(session, '!document.querySelector("#dialog").open')
	assert(
		evaluate(
			session,
			'document.querySelector("output").textContent === "pending"',
		),
		"Interrupting the Effect closes the dialog without applying its action",
	)
} finally {
	browser(session, "close")
	server.kill()
	await server.exited
}
