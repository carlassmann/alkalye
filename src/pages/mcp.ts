import type { APIRoute } from "astro"
import { getMcpConfig } from "@/mcp/config"
import { readAccessToken } from "@/mcp/oauth"
import { mcpHandler } from "@/mcp/server"

export { GET, POST, DELETE, OPTIONS }

export const prerender = false

let handle: APIRoute = async ({ request }) => {
	let config = getMcpConfig()
	let rejected = validateRequestOrigin(request, config.baseUrl)
	if (rejected) return rejected
	let bearer = readBearer(request)
	if (!bearer) return unauthorized(config.baseUrl)
	try {
		let access = await readAccessToken(config.tokens, bearer)
		let resource = new URL("/mcp", config.baseUrl).toString()
		if (
			access.resource !== resource ||
			!access.scope.split(" ").includes("alkalye")
		) {
			return unauthorized(config.baseUrl)
		}
		return mcpHandler.fetch(request, {
			authInfo: {
				token: access.credential,
				clientId: access.clientId,
				scopes: access.scope.split(" "),
				resource: new URL(access.resource),
			},
		})
	} catch {
		return unauthorized(config.baseUrl)
	}
}

let GET = handle
let POST = handle
let DELETE = handle
let OPTIONS: APIRoute = () =>
	new Response(null, {
		status: 204,
		headers: {
			"access-control-allow-origin": "*",
			"access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
			"access-control-allow-headers":
				"authorization, content-type, mcp-protocol-version, mcp-session-id",
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

function validateRequestOrigin(request: Request, baseUrl: URL) {
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
	let origin = request.headers.get("origin")
	if (origin && origin !== baseUrl.origin) {
		return Response.json({ error: "invalid_origin" }, { status: 403 })
	}
	return undefined
}
