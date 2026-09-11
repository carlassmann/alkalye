import { describe, expect, it } from "vitest"
import {
	authorizationServerMetadata,
	challengeResponse,
	protectedResourceMetadata,
	toolSecurityMetadata,
} from "./metadata"

describe("MCP discovery metadata", () => {
	it("advertises a complete public-client OAuth flow", () => {
		let metadata = authorizationServerMetadata(
			new URL("https://www.alkalye.com"),
		)

		expect(metadata).toMatchObject({
			issuer: "https://www.alkalye.com",
			authorization_endpoint: "https://www.alkalye.com/oauth/authorize",
			token_endpoint: "https://www.alkalye.com/oauth/token",
			client_id_metadata_document_supported: true,
			token_endpoint_auth_methods_supported: ["none"],
			code_challenge_methods_supported: ["S256"],
			scopes_supported: ["alkalye"],
		})
	})

	it("binds OAuth and policy links to the canonical MCP resource", () => {
		expect(
			protectedResourceMetadata(new URL("https://www.alkalye.com")),
		).toEqual({
			resource: "https://www.alkalye.com/mcp",
			authorization_servers: ["https://www.alkalye.com"],
			scopes_supported: ["alkalye"],
			bearer_methods_supported: ["header"],
			resource_documentation: "https://www.alkalye.com/privacy",
			resource_policy_uri: "https://www.alkalye.com/privacy",
			resource_tos_uri: "https://www.alkalye.com/terms",
		})
	})

	it("requires OAuth on every tool", () => {
		expect(toolSecurityMetadata()).toEqual({
			securitySchemes: [{ type: "oauth2", scopes: ["alkalye"] }],
		})
	})

	it("serves exactly one domain-verification token", async () => {
		let response = challengeResponse("openai-domain-proof")

		expect(response.status).toBe(200)
		expect(response.headers.get("content-type")).toBe(
			"text/plain; charset=utf-8",
		)
		expect(await response.text()).toBe("openai-domain-proof")
		expect(challengeResponse(undefined).status).toBe(404)
	})
})
