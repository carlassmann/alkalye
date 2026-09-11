export {
	authorizationServerMetadata,
	challengeResponse,
	protectedResourceMetadata,
	toolSecurityMetadata,
}

let oauthSecuritySchemes = [{ type: "oauth2", scopes: ["alkalye"] }]

function authorizationServerMetadata(baseUrl: URL) {
	return {
		issuer: baseUrl.origin,
		authorization_endpoint: new URL("/oauth/authorize", baseUrl).toString(),
		token_endpoint: new URL("/oauth/token", baseUrl).toString(),
		response_types_supported: ["code"],
		grant_types_supported: ["authorization_code", "refresh_token"],
		code_challenge_methods_supported: ["S256"],
		client_id_metadata_document_supported: true,
		token_endpoint_auth_methods_supported: ["none"],
		scopes_supported: ["alkalye"],
	}
}

function protectedResourceMetadata(baseUrl: URL) {
	return {
		resource: new URL("/mcp", baseUrl).toString(),
		authorization_servers: [baseUrl.origin],
		scopes_supported: ["alkalye"],
		bearer_methods_supported: ["header"],
		resource_documentation: new URL("/privacy", baseUrl).toString(),
		resource_policy_uri: new URL("/privacy", baseUrl).toString(),
		resource_tos_uri: new URL("/terms", baseUrl).toString(),
	}
}

function toolSecurityMetadata() {
	return { securitySchemes: oauthSecuritySchemes }
}

function challengeResponse(token: string | undefined) {
	if (!token) {
		return new Response("Challenge token is not configured", { status: 404 })
	}
	return new Response(token, {
		headers: {
			"content-type": "text/plain; charset=utf-8",
			"cache-control": "no-store",
		},
	})
}
