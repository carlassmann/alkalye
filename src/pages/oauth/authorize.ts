import { Buffer } from "node:buffer"
import type { APIRoute } from "astro"
import { authorizationRequestSchema, validateClientRedirect } from "@/mcp/oauth"
import { getMcpConfig } from "@/mcp/config"

export { GET }

export const prerender = false

let GET: APIRoute = async ({ request }) => {
	try {
		let url = new URL(request.url)
		let parsed = authorizationRequestSchema.parse(
			Object.fromEntries(url.searchParams),
		)
		let config = getMcpConfig()
		let client = await validateClientRedirect(
			parsed.client_id,
			parsed.redirect_uri,
			config.allowedClientHosts,
		)
		let oauth = Buffer.from(
			JSON.stringify({
				authorization: parsed,
				client: {
					name: client.client_name,
					redirectHost: new URL(parsed.redirect_uri).host,
				},
			}),
		).toString("base64url")
		return Response.redirect(
			new URL(`/app/settings?oauth=${oauth}`, config.baseUrl),
			302,
		)
	} catch {
		return new Response("Invalid OAuth authorization request", { status: 400 })
	}
}
