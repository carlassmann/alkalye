let baseUrl = new URL(
	process.argv[2] ??
		process.env.ALKALYE_MCP_BASE_URL ??
		"https://www.alkalye.com",
)

await checkJson(
	"OAuth resource metadata",
	"/.well-known/oauth-protected-resource",
	metadata => {
		expect(
			metadata.resource === new URL("/mcp", baseUrl).toString(),
			"wrong MCP resource",
		)
		expect(
			Array.isArray(metadata.authorization_servers),
			"missing authorization server",
		)
	},
)

await checkJson(
	"OAuth server metadata",
	"/.well-known/oauth-authorization-server",
	metadata => {
		expect(
			includes(metadata.code_challenge_methods_supported, "S256"),
			"PKCE S256 missing",
		)
		expect(
			metadata.client_id_metadata_document_supported === true,
			"CIMD missing",
		)
		expect(
			includes(metadata.token_endpoint_auth_methods_supported, "none"),
			"public client auth missing",
		)
	},
)

let token = await fetch(new URL("/oauth/token", baseUrl), {
	method: "POST",
	headers: { "content-type": "application/x-www-form-urlencoded" },
	body: new URLSearchParams({ grant_type: "invalid" }),
})
expect(token.status === 400, `OAuth token request returned ${token.status}`)
expect(
	(await token.json()).error === "unsupported_grant_type",
	"OAuth token request did not reach the authorization server",
)
passed("OAuth cross-origin token request")

let mcp = await fetch(new URL("/mcp", baseUrl))
expect(mcp.status === 401, `MCP without authentication returned ${mcp.status}`)
expect(
	mcp.headers.get("www-authenticate")?.includes("resource_metadata="),
	"MCP challenge missing",
)
passed("MCP authentication challenge")

await checkPage("Privacy policy", "/privacy")
await checkPage("Terms", "/terms")
await checkPage("Support", "/support")

let challenge = process.env.ALKALYE_OPENAI_APPS_CHALLENGE
if (challenge) {
	let response = await fetch(
		new URL("/.well-known/openai-apps-challenge", baseUrl),
	)
	expect(response.ok, `challenge returned ${response.status}`)
	expect((await response.text()) === challenge, "challenge body is not exact")
	passed("OpenAI domain challenge")
} else {
	console.log(
		"SKIP OpenAI domain challenge: ALKALYE_OPENAI_APPS_CHALLENGE is unset",
	)
}

console.log(`PASS MCP production checks: ${baseUrl.origin}`)

async function checkJson(
	label: string,
	path: string,
	validate: (value: Record<string, unknown>) => void,
) {
	let response = await fetch(new URL(path, baseUrl))
	expect(response.ok, `${label} returned ${response.status}`)
	validate(await response.json())
	passed(label)
}

async function checkPage(label: string, path: string) {
	let response = await fetch(new URL(path, baseUrl), { redirect: "manual" })
	expect(response.status === 200, `${label} returned ${response.status}`)
	passed(label)
}

function expect(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message)
}

function includes(value: unknown, expected: string) {
	return Array.isArray(value) && value.includes(expected)
}

function passed(label: string) {
	console.log(`PASS ${label}`)
}
