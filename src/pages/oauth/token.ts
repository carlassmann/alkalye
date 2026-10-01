import type { APIRoute } from "astro"
import { z } from "zod"
import { validateConnection } from "@/mcp/connection"
import { getMcpConfig } from "@/mcp/config"
import {
	exchangeAuthorizationCode,
	exchangeRefreshToken,
	pkceVerifierSchema,
	readAccessToken,
} from "@/mcp/oauth"

export { POST, OPTIONS }

export const prerender = false

let authorizationCodeRequestSchema = z.object({
	grant_type: z.literal("authorization_code"),
	code: z.string(),
	code_verifier: pkceVerifierSchema,
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
	let form: FormData
	try {
		form = await request.formData()
	} catch {
		return oauthError("invalid_request")
	}
	let raw = Object.fromEntries(form)
	if (
		raw.grant_type !== "authorization_code" &&
		raw.grant_type !== "refresh_token"
	) {
		return oauthError("unsupported_grant_type")
	}
	let parsed = tokenRequestSchema.safeParse(raw)
	if (!parsed.success) return oauthError("invalid_request")
	let input = parsed.data
	try {
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
		let access = await readAccessToken(config.tokens, tokens.access_token)
		await validateConnection(access.credential, input.client_id)
		return Response.json(tokens, { headers: noStoreHeaders() })
	} catch {
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
