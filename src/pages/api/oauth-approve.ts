import type { APIRoute } from "astro"
import { z } from "zod"
import { getMcpConfig } from "@/mcp/config"
import { approveAuthorization, authorizationRequestSchema } from "@/mcp/oauth"

export { POST }

export const prerender = false

let requestSchema = z.object({
	credential: z.string(),
	authorization: authorizationRequestSchema,
})

let POST: APIRoute = async ({ request }) => {
	try {
		let body: unknown = await request.json()
		let input = requestSchema.parse(body)
		let config = getMcpConfig()
		let resource = new URL("/mcp", config.baseUrl).toString()
		if (input.authorization.resource !== resource) {
			return oauthError("invalid_target", 400)
		}
		let redirect = await approveAuthorization({
			tokens: config.tokens,
			request: input.authorization,
			credential: input.credential,
			allowedClientHosts: config.allowedClientHosts,
		})
		return Response.json({ redirectTo: redirect.toString() })
	} catch (error) {
		console.error("[oauth] approval failed", error)
		return oauthError("invalid_request", 400)
	}
}

function oauthError(error: string, status: number) {
	return Response.json({ error }, { status })
}
