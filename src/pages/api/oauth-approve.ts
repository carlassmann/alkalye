import type { APIRoute } from "astro"
import { z } from "zod"
import { getMcpConfig } from "@/mcp/config"
import {
	approveAuthorization,
	consentRequestSchema,
	validateClientRedirect,
} from "@/mcp/oauth"

export { POST }

export const prerender = false

let requestSchema = z.discriminatedUnion("decision", [
	z.object({
		decision: z.literal("approve"),
		credential: z.string(),
		consent: z.string(),
	}),
	z.object({ decision: z.literal("deny"), consent: z.string() }),
])

let POST: APIRoute = async ({ request }) => {
	try {
		let body: unknown = await request.json()
		let input = requestSchema.parse(body)
		let config = getMcpConfig()
		let consent = await config.tokens.open(
			"consent",
			input.consent,
			consentRequestSchema,
		)
		let resource = new URL("/mcp", config.baseUrl).toString()
		if (consent.authorization.resource !== resource) {
			return oauthError("invalid_target", 400)
		}
		if (input.decision === "deny") {
			await validateClientRedirect(
				consent.authorization.client_id,
				consent.authorization.redirect_uri,
				config.allowedClientHosts,
			)
			let redirect = new URL(consent.authorization.redirect_uri)
			redirect.searchParams.set("error", "access_denied")
			redirect.searchParams.set("state", consent.authorization.state)
			return Response.json({ redirectTo: redirect.toString() })
		}
		let redirect = await approveAuthorization({
			tokens: config.tokens,
			request: consent.authorization,
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
