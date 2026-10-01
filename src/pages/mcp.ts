import { InvalidConnectionError } from "@/mcp/errors"
import type { APIRoute } from "astro"
import { validateConnection } from "@/mcp/connection"
import { getMcpConfig } from "@/mcp/config"
import { readAccessToken } from "@/mcp/oauth"
import { mcpHandler } from "@/mcp/server"

export { POST, OPTIONS }

export const prerender = false

let handle: APIRoute = async ({ request }) => {
	let config = getMcpConfig()
	let rejected = validateRequestHost(request, config.baseUrl)
	if (rejected) return rejected
	let bearer = readBearer(request)
	if (!bearer) return unauthorized(config.baseUrl)
	let access
	try {
		access = await readAccessToken(config.tokens, bearer)
	} catch {
		return unauthorized(config.baseUrl)
	}
	let resource = new URL("/mcp", config.baseUrl).toString()
	if (
		access.resource !== resource ||
		!access.scope.split(" ").includes("alkalye")
	)
		return unauthorized(config.baseUrl)
	try {
		await validateConnection(access.credential, access.clientId)
	} catch (error) {
		return error instanceof InvalidConnectionError
			? unauthorized(config.baseUrl)
			: unavailable()
	}
	try {
		let response = await mcpHandler.fetch(request, {
			authInfo: {
				token: access.credential,
				clientId: access.clientId,
				scopes: access.scope.split(" "),
				resource: new URL(access.resource),
			},
		})
		response.headers.set("access-control-allow-origin", "*")
		return response
	} catch {
		return unavailable()
	}
}

let POST = handle
let OPTIONS: APIRoute = () =>
	new Response(null, {
		status: 204,
		headers: {
			"access-control-allow-origin": "*",
			"access-control-allow-methods": "POST, OPTIONS",
			"access-control-allow-headers":
				"authorization, content-type, mcp-protocol-version, mcp-method, mcp-name",
		},
	})

function readBearer(request: Request) {
	let authorization = request.headers.get("authorization")
	if (!authorization?.startsWith("Bearer ")) return undefined
	return authorization.slice("Bearer ".length)
}

function unauthorized(baseUrl: URL) {
	let metadata = new URL(
		"/.well-known/oauth-protected-resource",
		baseUrl,
	).toString()
	return Response.json(
		{ error: "invalid_token" },
		{
			status: 401,
			headers: {
				"www-authenticate": `Bearer resource_metadata="${metadata}"`,
				"access-control-allow-origin": "*",
			},
		},
	)
}

function unavailable() {
	return Response.json(
		{ error: "temporarily_unavailable" },
		{
			status: 503,
			headers: { "access-control-allow-origin": "*", "retry-after": "5" },
		},
	)
}

function validateRequestHost(request: Request, baseUrl: URL) {
	let forwardedHost = request.headers
		.get("x-forwarded-host")
		?.split(",")[0]
		?.trim()
	let host = forwardedHost ?? request.headers.get("host")
	if (
		host &&
		host !== baseUrl.host &&
		!baseUrl.hostname.endsWith(".localhost")
	) {
		return Response.json({ error: "invalid_host" }, { status: 403 })
	}
	return undefined
}
