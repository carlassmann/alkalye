import { Buffer } from "node:buffer"
import { z } from "zod"
import type { TokenReplayStore } from "./replay-store"
import type { TokenCodec } from "./token"

export {
	authorizationRequestSchema,
	approveAuthorization,
	exchangeAuthorizationCode,
	exchangeRefreshToken,
	readAccessToken,
	validateClientRedirect,
}

let authorizationRequestSchema = z.object({
	client_id: z.url(),
	redirect_uri: z.url(),
	response_type: z.literal("code"),
	code_challenge: z.string().min(43).max(128),
	code_challenge_method: z.literal("S256"),
	state: z.string().min(1),
	resource: z.url(),
	scope: z.literal("alkalye").default("alkalye"),
})

let authorizationCodeSchema = z.object({
	jti: z.string(),
	clientId: z.url(),
	redirectUri: z.url(),
	codeChallenge: z.string(),
	resource: z.url(),
	scope: z.string(),
	credential: z.string(),
})

let accessTokenSchema = z.object({
	clientId: z.url(),
	resource: z.url(),
	scope: z.string(),
	credential: z.string(),
})

let refreshTokenSchema = accessTokenSchema.extend({ jti: z.string() })
type AuthorizationRequest = z.infer<typeof authorizationRequestSchema>

async function approveAuthorization(args: {
	tokens: TokenCodec
	request: AuthorizationRequest
	credential: string
	allowedClientHosts?: string[]
}) {
	await validateClientRedirect(
		args.request.client_id,
		args.request.redirect_uri,
		args.allowedClientHosts,
	)
	let code = await args.tokens.seal(
		"authorization_code",
		{
			jti: crypto.randomUUID(),
			clientId: args.request.client_id,
			redirectUri: args.request.redirect_uri,
			codeChallenge: args.request.code_challenge,
			resource: args.request.resource,
			scope: args.request.scope,
			credential: args.credential,
		},
		Date.now() + 5 * 60_000,
	)
	let redirect = new URL(args.request.redirect_uri)
	redirect.searchParams.set("code", code)
	redirect.searchParams.set("state", args.request.state)
	return redirect
}

async function exchangeAuthorizationCode(args: {
	tokens: TokenCodec
	replayStore: TokenReplayStore
	code: string
	codeVerifier: string
	clientId: string
	redirectUri: string
	resource: string
}) {
	let code = await args.tokens.open(
		"authorization_code",
		args.code,
		authorizationCodeSchema,
	)
	if (
		code.clientId !== args.clientId ||
		code.redirectUri !== args.redirectUri ||
		code.resource !== args.resource ||
		!(await matchesCodeChallenge(args.codeVerifier, code.codeChallenge))
	) {
		throw new Error("invalid_grant")
	}
	if (!(await args.replayStore.consume(`code:${code.jti}`, 5 * 60_000))) {
		throw new Error("invalid_grant")
	}
	return mintTokens(args.tokens, code)
}

async function exchangeRefreshToken(args: {
	tokens: TokenCodec
	replayStore: TokenReplayStore
	refreshToken: string
	clientId: string
	resource: string
}) {
	let token = await args.tokens.open(
		"refresh_token",
		args.refreshToken,
		refreshTokenSchema,
	)
	if (token.clientId !== args.clientId || token.resource !== args.resource) {
		throw new Error("invalid_grant")
	}
	if (
		!(await args.replayStore.consume(
			`refresh:${token.jti}`,
			30 * 24 * 60 * 60_000,
		))
	) {
		throw new Error("invalid_grant")
	}
	return mintTokens(args.tokens, token)
}

async function mintTokens(
	tokens: TokenCodec,
	payload: z.infer<typeof accessTokenSchema>,
) {
	let accessToken = await tokens.seal(
		"access_token",
		payload,
		Date.now() + 60 * 60_000,
	)
	let refreshToken = await tokens.seal(
		"refresh_token",
		{ ...payload, jti: crypto.randomUUID() },
		Date.now() + 30 * 24 * 60 * 60_000,
	)
	return {
		access_token: accessToken,
		token_type: "Bearer",
		expires_in: 3600,
		refresh_token: refreshToken,
		scope: payload.scope,
	}
}

function readAccessToken(tokens: TokenCodec, token: string) {
	return tokens.open("access_token", token, accessTokenSchema)
}

async function matchesCodeChallenge(verifier: string, expected: string) {
	let digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(verifier),
	)
	return Buffer.from(digest).toString("base64url") === expected
}

async function validateClientRedirect(
	clientId: string,
	redirectUri: string,
	allowedClientHosts: string[] = ["chatgpt.com", "openai.com"],
) {
	let clientUrl = new URL(clientId)
	let redirectUrl = new URL(redirectUri)
	if (
		clientUrl.protocol !== "https:" ||
		clientUrl.pathname === "/" ||
		clientUrl.username ||
		clientUrl.password ||
		clientUrl.hash ||
		redirectUrl.protocol !== "https:"
	) {
		throw new Error("invalid_client")
	}
	let clientHost = clientUrl.hostname.toLowerCase()
	if (
		!allowedClientHosts.some(
			host => clientHost === host || clientHost.endsWith(`.${host}`),
		)
	) {
		throw new Error("invalid_client")
	}
	let response = await fetch(clientUrl, {
		headers: { accept: "application/json" },
		redirect: "error",
		signal: AbortSignal.timeout(5_000),
	})
	if (!response.ok) throw new Error("invalid_client")
	let metadataSchema = z.object({
		client_id: z.url(),
		client_name: z.string().min(1),
		redirect_uris: z.array(z.url()),
	})
	let body: unknown = await response.json()
	let metadata = metadataSchema.parse(body)
	if (metadata.client_id !== clientId) {
		throw new Error("invalid_client")
	}
	if (!metadata.redirect_uris.includes(redirectUri)) {
		throw new Error("invalid_redirect_uri")
	}
}
