import { Buffer } from "node:buffer"
import { describe, expect, test, vi } from "vitest"
import { createTokenCodec } from "./token"
import { createInMemoryReplayStore } from "./replay-store"
import {
	authorizationRequestSchema,
	approveAuthorization,
	exchangeAuthorizationCode,
	exchangeRefreshToken,
	validateClientRedirect,
} from "./oauth"

let tokens = createTokenCodec(Buffer.alloc(32, 3).toString("base64url"))

describe("MCP OAuth", () => {
	test("rejects scopes outside the Alkalye grant", () => {
		expect(() =>
			authorizationRequestSchema.parse({
				client_id: "https://chatgpt.example/client.json",
				redirect_uri: "https://chatgpt.example/callback",
				response_type: "code",
				code_challenge: "a".repeat(43),
				code_challenge_method: "S256",
				state: "state",
				resource: "https://www.alkalye.com/mcp",
				scope: "admin",
			}),
		).toThrow()
	})

	test("binds and consumes authorization codes exactly once", async () => {
		let replayStore = createInMemoryReplayStore()
		let verifier = "a".repeat(48)
		let challenge = Buffer.from(
			await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
		).toString("base64url")
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				Response.json({
					client_id: "https://chatgpt.example/client.json",
					client_name: "ChatGPT",
					redirect_uris: ["https://chatgpt.example/callback"],
				}),
			),
		)
		let redirect = await approveAuthorization({
			tokens,
			credential: "wrapped-agent",
			allowedClientHosts: ["chatgpt.example"],
			request: {
				client_id: "https://chatgpt.example/client.json",
				redirect_uri: "https://chatgpt.example/callback",
				response_type: "code",
				code_challenge: challenge,
				code_challenge_method: "S256",
				state: "opaque-state",
				resource: "https://www.alkalye.com/mcp",
				scope: "alkalye",
			},
		})
		let code = redirect.searchParams.get("code")
		expect(code).toBeTruthy()
		if (!code) throw new Error("Missing authorization code")

		await expect(
			exchangeAuthorizationCode({
				tokens,
				replayStore,
				code,
				codeVerifier: "wrong".repeat(12),
				clientId: "https://chatgpt.example/client.json",
				redirectUri: "https://chatgpt.example/callback",
				resource: "https://www.alkalye.com/mcp",
			}),
		).rejects.toThrow("invalid_grant")

		let result = await exchangeAuthorizationCode({
			tokens,
			replayStore,
			code,
			codeVerifier: verifier,
			clientId: "https://chatgpt.example/client.json",
			redirectUri: "https://chatgpt.example/callback",
			resource: "https://www.alkalye.com/mcp",
		})
		expect(result.token_type).toBe("Bearer")

		await expect(
			exchangeAuthorizationCode({
				tokens,
				replayStore,
				code,
				codeVerifier: verifier,
				clientId: "https://chatgpt.example/client.json",
				redirectUri: "https://chatgpt.example/callback",
				resource: "https://www.alkalye.com/mcp",
			}),
		).rejects.toThrow("invalid_grant")
		vi.unstubAllGlobals()
	})

	test("rotates refresh tokens", async () => {
		let replayStore = createInMemoryReplayStore()
		let verifier = "a".repeat(48)
		let challenge = Buffer.from(
			await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
		).toString("base64url")
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				Response.json({
					client_id: "https://chatgpt.example/client.json",
					client_name: "ChatGPT",
					redirect_uris: ["https://chatgpt.example/callback"],
				}),
			),
		)
		let redirect = await approveAuthorization({
			tokens,
			credential: "wrapped-agent",
			allowedClientHosts: ["chatgpt.example"],
			request: {
				client_id: "https://chatgpt.example/client.json",
				redirect_uri: "https://chatgpt.example/callback",
				response_type: "code",
				code_challenge: challenge,
				code_challenge_method: "S256",
				state: "opaque-state",
				resource: "https://www.alkalye.com/mcp",
				scope: "alkalye",
			},
		})
		let code = redirect.searchParams.get("code")
		if (!code) throw new Error("Missing authorization code")
		let issued = await exchangeAuthorizationCode({
			tokens,
			replayStore,
			code,
			codeVerifier: verifier,
			clientId: "https://chatgpt.example/client.json",
			redirectUri: "https://chatgpt.example/callback",
			resource: "https://www.alkalye.com/mcp",
		})
		let refreshArgs = {
			tokens,
			replayStore,
			refreshToken: issued.refresh_token,
			clientId: "https://chatgpt.example/client.json",
			resource: "https://www.alkalye.com/mcp",
		}
		let rotated = await exchangeRefreshToken(refreshArgs)
		expect(rotated.refresh_token).not.toBe(issued.refresh_token)
		await expect(exchangeRefreshToken(refreshArgs)).rejects.toThrow(
			"invalid_grant",
		)
		vi.unstubAllGlobals()
	})

	test("rejects unregistered redirect URIs", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				Response.json({
					client_id: "https://chatgpt.example/client.json",
					client_name: "ChatGPT",
					redirect_uris: ["https://chatgpt.example/callback"],
				}),
			),
		)
		await expect(
			validateClientRedirect(
				"https://chatgpt.example/client.json",
				"https://attacker.example/callback",
				["chatgpt.example"],
			),
		).rejects.toThrow("invalid_redirect_uri")
		vi.unstubAllGlobals()
	})

	test("requires an exact non-redirected client metadata document", async () => {
		let mockedFetch = vi.fn().mockResolvedValue(
			Response.json({
				client_name: "ChatGPT",
				redirect_uris: ["https://chatgpt.example/callback"],
			}),
		)
		vi.stubGlobal("fetch", mockedFetch)
		await expect(
			validateClientRedirect(
				"https://chatgpt.example/client.json",
				"https://chatgpt.example/callback",
				["chatgpt.example"],
			),
		).rejects.toThrow()
		expect(mockedFetch).toHaveBeenCalledWith(
			new URL("https://chatgpt.example/client.json"),
			expect.objectContaining({ redirect: "error" }),
		)
		vi.unstubAllGlobals()
	})
})
