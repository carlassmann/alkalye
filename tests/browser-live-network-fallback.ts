import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as Effect from "effect/Effect"
import { startServer } from "../src/server/index"
import { object, string } from "../src/shared/model"
import {
	assert,
	browser,
	evaluate,
	wait,
	currentDocument,
} from "./browser-driver"

if (process.argv.includes("--serve")) {
	let directory = await mkdtemp(join(tmpdir(), "alkalye-poll-browser-"))
	let instance: Effect.Success<ReturnType<typeof startServer>>
	let proxy = Bun.serve({
		port: 0,
		idleTimeout: 60,
		async fetch(request) {
			let url = new URL(request.url)
			let shell =
				request.method === "GET" &&
				(url.pathname === "/app" || url.pathname.startsWith("/app/"))
			let response = await fetch(
				new URL(url.pathname + url.search, instance.server.url),
				{
					method: request.method,
					headers: request.headers,
					body:
						request.method === "GET" || request.method === "HEAD"
							? undefined
							: await request.arrayBuffer(),
					signal: request.signal,
					redirect: "manual",
					decompress: shell,
				},
			)
			if (!shell) return response
			let markup = await response.text()
			let instrumentation = `<script>
			window.blockLiveSocket = true;
			window.livePollRequests = 0;
			window.WebSocket = class extends WebSocket {
				constructor(url, protocols) {
					let target = new URL(url);
					if (target.pathname === "/api/live") {
						if (window.blockLiveSocket) throw new Error("Test network blocks WebSockets");
						target.port = "${instance.server.port}";
					}
					super(target.href, protocols);
				}
			};
			let originalFetch = fetch;
			window.fetch = function(input, init) {
				let url = new URL(input instanceof Request ? input.url : String(input), location.origin);
				if (url.pathname === "/api/live/poll") window.livePollRequests++;
				return originalFetch(input, init);
			};
			</script>`
			return new Response(
				markup.replace("</head>", instrumentation + "</head>"),
				{
					headers: { "content-type": "text/html" },
				},
			)
		},
	})
	instance = await Effect.runPromise(
		startServer({
			port: 0,
			data: directory,
			assets: join(directory, "shell"),
			publicOrigin: proxy.url.origin,
		}),
	)
	let stopping = false
	for (let signal of ["SIGTERM", "SIGINT"])
		process.once(signal, async () => {
			if (stopping) return
			stopping = true
			await proxy.stop(true)
			await Effect.runPromise(instance.close())
			await rm(directory, { recursive: true, force: true })
			process.exit(0)
		})
	console.log(proxy.url.href)
} else {
	let server = Bun.spawn(
		["bun", "tests/browser-live-network-fallback.ts", "--serve"],
		{
			stdout: "pipe",
			stderr: "inherit",
		},
	)
	let owner = "poll-owner-" + Date.now()
	let writer = "poll-writer-" + Date.now()
	try {
		let output = await server.stdout.getReader().read()
		if (!output.value) throw new Error("Missing polling test URL")
		let origin = new TextDecoder().decode(output.value).trim()
		console.log(origin)
		browser(owner, "open", origin + "app")
		wait(owner, 'document.querySelector("[data-document-app]") !== null')
		browser(owner, "click", '[data-action="new"]')
		wait(
			owner,
			'document.querySelector("#editor") && !document.querySelector("#editor").readOnly',
		)
		let document = string(evaluate(owner, currentDocument))
		browser(owner, "fill", "#editor", "# Polling collaboration\n\nFirst draft.")
		wait(
			owner,
			'window.livePollRequests > 1 && document.querySelector("#save-status")?.textContent === "Saved"',
		)
		assert(true, "blocked WebSockets automatically fall back to HTTP polling")
		assert(
			evaluate(
				owner,
				`fetch("/api/workspaces", {method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({workspace:"poll-browser-space",name:"Polling",request:"poll-browser-create"})}).then(response => response.ok)`,
			),
			"create the shared polling workspace",
		)
		assert(
			evaluate(
				owner,
				`fetch("/api/documents/${document}/workspace", {method:"PUT", headers:{"content-type":"application/json"}, body:JSON.stringify({workspace:"poll-browser-space",request:"poll-browser-move"})}).then(response => response.ok)`,
			),
			"move the document to its polling workspace",
		)
		browser(writer, "open", origin + "app")
		wait(writer, "window.livePollRequests > 1")
		let subject = string(
			object(
				evaluate(
					writer,
					'fetch("/api/accounts/session").then(response => response.json())',
				),
			).subject,
		)
		assert(
			evaluate(
				owner,
				`fetch("/api/workspaces/poll-browser-space/members/${subject}", {method:"PUT", headers:{"content-type":"application/json"}, body:JSON.stringify({role:"writer",request:"poll-browser-grant"})}).then(response => response.ok)`,
			),
			"owner grants a second account workspace access",
		)
		browser(writer, "open", origin + "app/doc/" + document)
		wait(
			writer,
			'document.querySelector("#editor")?.value.includes("First draft.") && !document.querySelector("#editor").readOnly',
		)
		browser(
			writer,
			"fill",
			"#editor",
			"# Polling collaboration\n\nWritten over HTTP.",
		)
		wait(
			owner,
			'document.querySelector("#editor")?.value.includes("Written over HTTP.")',
		)
		assert(true, "two polling clients synchronize edits without WebSockets")
		evaluate(
			writer,
			'{let input = document.querySelector("#editor"); input.focus(); input.setSelectionRange(2, 9); input.dispatchEvent(new Event("select"))}',
		)
		wait(owner, 'document.querySelectorAll(".remote-selection").length > 0')
		assert(true, "polling carries cursor previews and selections")
		assert(
			evaluate(
				owner,
				`fetch("/api/workspaces/poll-browser-space/members/${subject}", {method:"PUT", headers:{"content-type":"application/json"}, body:JSON.stringify({role:null,request:"poll-browser-revoke"})}).then(response => response.ok)`,
			),
			"owner revokes polling writer access",
		)
		wait(
			writer,
			'document.querySelector("#editor")?.readOnly === true || !document.querySelector("#editor")',
		)
		assert(true, "polling delivers permission revocation to the actual editor")
	} finally {
		for (let session of [owner, writer]) browser(session, "close")
		server.kill()
		await server.exited
	}
}
