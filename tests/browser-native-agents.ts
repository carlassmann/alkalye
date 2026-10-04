import {
	assert,
	browser,
	currentDocument,
	evaluate,
	visit,
	wait,
} from "./browser-driver"

export function verifyNativeAgents(session: string, url: string) {
	let document = String(evaluate(session, currentDocument))
	let source = String(
		evaluate(session, 'document.querySelector("#editor").value'),
	)
	browser(session, "click", '.profile [data-action="settings"]')
	browser(session, "click", '.settings-nav a[href*="category=connections"]')
	wait(
		session,
		'location.search.includes("category=connections") && document.querySelector("#settings-connections h2")?.textContent === "MCP connections" && document.querySelector("[data-agent=create]")?.disabled === false',
	)
	assert(
		evaluate(
			session,
			'document.querySelector("[data-account-agents]").tagName === "ALKALYE-ACCOUNT-AGENTS"',
		),
		"native agent connections use a registered Web Component",
	)
	browser(session, "fill", '[name="agent-name"]', "Browser agent")
	browser(session, "click", '[data-agent="create"]')
	wait(
		session,
		'document.querySelector("#agent-token").value.length > 20 && document.querySelector("#agent-connections").textContent.includes("Browser agent")',
	)
	assert(
		evaluate(
			session,
			`(() => {
		window.nativeAgentToken = document.querySelector("#agent-token").value;
		window.callNativeAgent = async (name, args) => {
			let response = await fetch("/mcp", {method:"POST", headers:{Authorization:"Bearer " + window.nativeAgentToken, "content-type":"application/json", Accept:"application/json, text/event-stream", "MCP-Protocol-Version":"2026-07-28", "Mcp-Method":"tools/call", "Mcp-Name":name}, body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/call",params:{name,arguments:args,_meta:{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}})});
			if (response.status !== 200) return { status: response.status };
			return (await response.json()).result.structuredContent;
		};
		return window.callNativeAgent("get_document", {documentId:${JSON.stringify(document)}}).then(read => read.content === ${JSON.stringify(source)});
	})()`,
		),
		"browser-created agent reads the same native document snapshot",
	)
	evaluate(
		session,
		`window.callNativeAgent("get_document", {documentId:${JSON.stringify(document)}}).then(read => window.callNativeAgent("update_document", {documentId:${JSON.stringify(document)}, content:read.content + ${JSON.stringify("\n\nWritten through MCP.")}, expectedRevision:read.revision})).then(result => result.success)`,
	)
	browser(session, "click", ".settings-back")
	wait(
		session,
		'document.querySelector("#editor").value.endsWith("Written through MCP.")',
	)
	wait(session, '!document.querySelector("#agent-token")')
	assert(
		true,
		"native MCP edits arrive through collaboration and closing the view clears its token",
	)
	// In-app navigation keeps the page, and the token helper defined above.
	visit(session, "/app/settings?category=connections")
	wait(
		session,
		'document.querySelector("#agent-connections")?.textContent.includes("Browser agent")',
	)
	browser(session, "click", '[data-agent="revoke"]')
	wait(
		session,
		'!document.querySelector("#agent-connections").textContent.includes("Browser agent")',
	)
	assert(
		evaluate(
			session,
			'window.callNativeAgent("list_documents", {}).then(result => result.status === 401)',
		),
		"native connection UI revokes MCP access",
	)
	let verifier = "b".repeat(43)
	let origin = new URL(url).origin
	let authorize = String(
		evaluate(
			session,
			`(async () => {
		let registered = await fetch("/oauth/register", {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({client_name:"Browser OAuth",redirect_uris:[location.origin + "/__tests/oauth-callback"]})}).then(response => response.json());
		let digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(${JSON.stringify(verifier)})));
		let challenge = btoa(String.fromCharCode(...digest)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
		let target = new URL("/oauth/authorize", location.origin);
		target.search = new URLSearchParams({client_id:registered.client_id,redirect_uri:location.origin + "/__tests/oauth-callback",code_challenge:challenge,code_challenge_method:"S256",response_type:"code",resource:location.origin + "/mcp",scope:"documents offline_access",state:"browser-oauth"});
		return target.href;
	})()`,
		),
	)
	browser(session, "open", authorize)
	wait(
		session,
		'location.pathname === "/app/settings" && location.search.includes("category=connections") && document.querySelector("#agent-description")?.textContent.includes("Browser OAuth wants access") && document.querySelector("[data-agent=create]")?.disabled === false',
	)
	browser(session, "click", '[data-agent="create"]')
	wait(
		session,
		'location.pathname === "/__tests/oauth-callback" && new URL(location.href).searchParams.has("code")',
	)
	assert(
		evaluate(
			session,
			`new URL(location.href).searchParams.get("state") === "browser-oauth" && location.origin === ${JSON.stringify(origin)}`,
		),
		"native browser OAuth consent approves the registered callback and preserves state",
	)
	browser(session, "open", url + "/doc/" + document)
	wait(
		session,
		'document.querySelector("#editor")?.value.endsWith("Written through MCP.")',
	)
}
