import { browser, wait } from "./browser-driver"
import { verifyNativeAgents } from "./browser-native-agents"

let server = Bun.spawn(["bun", "tests/browser-document-app.ts", "--serve"], {
	stdout: "pipe",
	stderr: "inherit",
})
let session = "mcp-layout-" + Date.now()
try {
	let output = await server.stdout.getReader().read()
	if (!output.value) throw new Error("Missing app URL")
	let url = new URL("/app", new TextDecoder().decode(output.value).trim()).href
	browser(session, "open", url)
	wait(session, 'document.querySelector("[data-document-app]") !== null')
	browser(session, "click", '[data-action="new"]')
	wait(session, 'document.querySelector("#editor")?.readOnly === false')
	browser(
		session,
		"fill",
		"#editor",
		"# Native MCP\n\nScoped platform connections.",
	)
	verifyNativeAgents(session, url)
} finally {
	browser(session, "close")
	server.kill()
	await server.exited
}
