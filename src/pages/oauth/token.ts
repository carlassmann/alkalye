import type { APIRoute } from "astro"
import { z } from "zod"
import { getMcpConfig } from "@/mcp/config"
import { exchangeAuthorizationCode, exchangeRefreshToken } from "@/mcp/oauth"

export { POST, OPTIONS }

export const prerender = false

let authorizationCodeRequestSchema = z.object({
	grant_type: z.literal("authorization_code"),
	code: z.string(),
	code_verifier: z.string(),
	client_id: z.string(),
	redirect_uri: z.string(),
	resource: z.string(),
})
let refreshTokenRequestSchema = z.object({
	grant_type: z.literal("refresh_token"),
	refresh_token: z.string(),
	client_id: z.string(),
	resource: z.string(),
})
let tokenRequestSchema = z.discriminatedUnion("grant_type", [
	authorizationCodeRequestSchema,
	refreshTokenRequestSchema,
])

let POST: APIRoute = async ({ request }) => {
	try {
		let form = await request.formData()
		let input = tokenRequestSchema.parse(Object.fromEntries(form))
		let config = getMcpConfig()
		let resource = new URL("/mcp", config.baseUrl).toString()
		if (input.resource !== resource) return oauthError("invalid_target")
		let tokens =
			input.grant_type === "authorization_code"
				? await exchangeAuthorizationCode({
						tokens: config.tokens,
						replayStore: config.replayStore,
						code: input.code,
						codeVerifier: input.code_verifier,
						clientId: input.client_id,
						redirectUri: input.redirect_uri,
						resource: input.resource,
					})
				: await exchangeRefreshToken({
						tokens: config.tokens,
						replayStore: config.replayStore,
						refreshToken: input.refresh_token,
						clientId: input.client_id,
						resource: input.resource,
					})
		return Response.json(tokens, { headers: noStoreHeaders() })
	} catch (error) {
		console.error("[oauth] token exchange failed", error)
		return oauthError("invalid_grant")
	}
}

let OPTIONS: APIRoute = () =>
	new Response(null, { status: 204, headers: corsHeaders() })

function oauthError(error: string) {
	return Response.json({ error }, { status: 400, headers: noStoreHeaders() })
}

function noStoreHeaders() {
	return { ...corsHeaders(), "cache-control": "no-store" }
}

function corsHeaders() {
	return {
		"access-control-allow-origin": "*",
		"access-control-allow-methods": "POST, OPTIONS",
		"access-control-allow-headers": "content-type",
	}
}
