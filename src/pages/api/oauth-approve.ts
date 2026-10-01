import type { APIRoute } from "astro"
import { z } from "zod"
import { accountCredentialsSchema } from "@/mcp/credentials"
import { createUserConnection } from "@/mcp/jazz"
import { getMcpConfig } from "@/mcp/config"
import { approveAuthorization, consentRequestSchema } from "@/mcp/oauth"

export { POST }

export const prerender = false

let requestSchema = z.discriminatedUnion("decision", [
	z.object({
		decision: z.literal("approve"),
		credentials: accountCredentialsSchema,
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
			let redirect = new URL(consent.authorization.redirect_uri)
			redirect.searchParams.set("error", "access_denied")
			redirect.searchParams.set("state", consent.authorization.state)
			return Response.json(
				{ redirectTo: redirect.toString() },
				{ headers: { "cache-control": "no-store" } },
			)
		}
		let credential = await createUserConnection(
			config.syncServer,
			input.credentials,
			{
				id: consent.authorization.client_id,
				name: consent.client.name,
			},
			config.tokens,
		)
		let redirect = await approveAuthorization({
			tokens: config.tokens,
			request: consent.authorization,
			credential,
			clientValidated: true,
		})
		return Response.json(
			{ redirectTo: redirect.toString() },
			{ headers: { "cache-control": "no-store" } },
		)
	} catch {
		return oauthError("invalid_request", 400)
	}
}

function oauthError(error: string, status: number) {
	return Response.json({ error }, { status })
}
