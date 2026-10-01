import { McpUnavailableError } from "./errors"
import { Buffer } from "node:buffer"
import { describe, expect, test, vi } from "vitest"
import { fetchClientMetadata } from "./client-metadata"
import { createTokenCodec } from "./token"
import { createEphemeralReplayStore } from "./replay-store"
import {
	authorizationRequestSchema,
	approveAuthorization,
	exchangeAuthorizationCode,
	exchangeRefreshToken,
	pkceVerifierSchema,
	validateClientRedirect,
} from "./oauth"

vi.mock("./client-metadata", () => ({ fetchClientMetadata: vi.fn() }))

let tokens = createTokenCodec(Buffer.alloc(32, 3).toString("base64url"))

describe("MCP OAuth", () => {
	test.each([
		"chatgpt.com",
		"claude.ai",
		"cursor.com",
		"custom-client.example",
	])("accepts client metadata from %s", async host => {
		let clientId = `https://${host}/client.json`
		let redirectUri = `https://${host}/callback`
		vi.mocked(fetchClientMetadata).mockResolvedValue({
			client_id: clientId,
			client_name: "MCP client",
			redirect_uris: [redirectUri],
		})
		await expect(
			validateClientRedirect(clientId, redirectUri),
		).resolves.toMatchObject({ client_id: clientId })
		vi.resetAllMocks()
	})

	test("rejects mismatched client IDs", async () => {
		vi.mocked(fetchClientMetadata).mockResolvedValue({
			client_id: "https://other.example/client.json",
			client_name: "MCP client",
			redirect_uris: ["https://client.example/callback"],
		})
		await expect(
			validateClientRedirect(
				"https://client.example/client.json",
				"https://client.example/callback",
			),
		).rejects.toThrow("invalid_client")
		vi.resetAllMocks()
	})

	test("requires an RFC 7636 PKCE verifier", () => {
		expect(pkceVerifierSchema.safeParse("x").success).toBe(false)
		expect(pkceVerifierSchema.safeParse("a".repeat(43)).success).toBe(true)
		expect(pkceVerifierSchema.safeParse("a".repeat(129)).success).toBe(false)
		expect(pkceVerifierSchema.safeParse("a".repeat(42) + "!").success).toBe(
			false,
		)
	})

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
		let replayStore = createEphemeralReplayStore()
		let verifier = "a".repeat(48)
		let challenge = Buffer.from(
			await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
		).toString("base64url")
		vi.mocked(fetchClientMetadata).mockResolvedValue({
			client_id: "https://chatgpt.example/client.json",
			client_name: "ChatGPT",
			redirect_uris: ["https://chatgpt.example/callback"],
		})
		let redirect = await approveAuthorization({
			tokens,
			credential: "wrapped-agent",
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
				validateConnection: async () => undefined,
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
			validateConnection: async () => undefined,
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
				validateConnection: async () => undefined,
				code,
				codeVerifier: verifier,
				clientId: "https://chatgpt.example/client.json",
				redirectUri: "https://chatgpt.example/callback",
				resource: "https://www.alkalye.com/mcp",
			}),
		).rejects.toThrow("invalid_grant")
		vi.resetAllMocks()
	})

	test("rotates refresh tokens", async () => {
		let replayStore = createEphemeralReplayStore()
		let verifier = "a".repeat(48)
		let challenge = Buffer.from(
			await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
		).toString("base64url")
		vi.mocked(fetchClientMetadata).mockResolvedValue({
			client_id: "https://chatgpt.example/client.json",
			client_name: "ChatGPT",
			redirect_uris: ["https://chatgpt.example/callback"],
		})
		let redirect = await approveAuthorization({
			tokens,
			credential: "wrapped-agent",
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
			validateConnection: async () => undefined,
			code,
			codeVerifier: verifier,
			clientId: "https://chatgpt.example/client.json",
			redirectUri: "https://chatgpt.example/callback",
			resource: "https://www.alkalye.com/mcp",
		})
		let refreshArgs = {
			tokens,
			replayStore,
			validateConnection: async () => undefined,
			refreshToken: issued.refresh_token,
			clientId: "https://chatgpt.example/client.json",
			resource: "https://www.alkalye.com/mcp",
		}
		let rotated = await exchangeRefreshToken(refreshArgs)
		expect(rotated.refresh_token).not.toBe(issued.refresh_token)
		await expect(exchangeRefreshToken(refreshArgs)).rejects.toThrow(
			"invalid_grant",
		)
		vi.resetAllMocks()
	})

	test("retains authorization codes and refresh tokens across transient connection failures", async () => {
		let replayStore = createEphemeralReplayStore()
		let verifier = "a".repeat(48)
		let challenge = Buffer.from(
			await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
		).toString("base64url")
		let redirect = await approveAuthorization({
			tokens,
			credential: "wrapped-user",
			clientValidated: true,
			request: {
				client_id: "https://custom.example/client.json",
				redirect_uri: "https://custom.example/callback",
				response_type: "code",
				code_challenge: challenge,
				code_challenge_method: "S256",
				state: "state",
				resource: "https://www.alkalye.com/mcp",
				scope: "alkalye",
			},
		})
		let code = redirect.searchParams.get("code")
		if (!code) throw new Error("Missing code")
		let validateConnection = vi
			.fn()
			.mockRejectedValueOnce(new McpUnavailableError())
			.mockResolvedValue(undefined)
		let codeArgs = {
			tokens,
			replayStore,
			validateConnection,
			code,
			codeVerifier: verifier,
			clientId: "https://custom.example/client.json",
			redirectUri: "https://custom.example/callback",
			resource: "https://www.alkalye.com/mcp",
		}
		await expect(exchangeAuthorizationCode(codeArgs)).rejects.toBeInstanceOf(
			McpUnavailableError,
		)
		let issued = await exchangeAuthorizationCode(codeArgs)
		validateConnection.mockRejectedValueOnce(new McpUnavailableError())
		let refreshArgs = {
			tokens,
			replayStore,
			validateConnection,
			refreshToken: issued.refresh_token,
			clientId: codeArgs.clientId,
			resource: codeArgs.resource,
		}
		await expect(exchangeRefreshToken(refreshArgs)).rejects.toBeInstanceOf(
			McpUnavailableError,
		)
		let refreshed = await exchangeRefreshToken(refreshArgs)
		expect(refreshed.refresh_token).not.toBe(issued.refresh_token)
		await expect(exchangeRefreshToken(refreshArgs)).rejects.toThrow(
			"invalid_grant",
		)
		expect(validateConnection).toHaveBeenCalledWith(
			"wrapped-user",
			codeArgs.clientId,
		)
	})

	test("rejects unregistered redirect URIs", async () => {
		vi.mocked(fetchClientMetadata).mockResolvedValue({
			client_id: "https://chatgpt.example/client.json",
			client_name: "ChatGPT",
			redirect_uris: ["https://chatgpt.example/callback"],
		})
		await expect(
			validateClientRedirect(
				"https://chatgpt.example/client.json",
				"https://attacker.example/callback",
			),
		).rejects.toThrow("invalid_redirect_uri")
		vi.resetAllMocks()
	})

	test("allows native-app loopback redirect ports", async () => {
		vi.mocked(fetchClientMetadata).mockResolvedValue({
			client_id: "https://chatgpt.example/client.json",
			client_name: "ChatGPT",
			redirect_uris: ["http://127.0.0.1/callback"],
		})

		await expect(
			validateClientRedirect(
				"https://chatgpt.example/client.json",
				"http://127.0.0.1:64648/callback",
			),
		).resolves.toMatchObject({ client_name: "ChatGPT" })

		vi.resetAllMocks()
	})

	test("does not broaden loopback redirect matching", async () => {
		vi.mocked(fetchClientMetadata).mockResolvedValue({
			client_id: "https://chatgpt.example/client.json",
			client_name: "ChatGPT",
			redirect_uris: ["http://127.0.0.1/callback"],
		})

		await expect(
			validateClientRedirect(
				"https://chatgpt.example/client.json",
				"http://127.0.0.1:64648/other",
			),
		).rejects.toThrow("invalid_redirect_uri")

		vi.resetAllMocks()
	})

	test("keeps non-loopback redirect matching exact", async () => {
		vi.mocked(fetchClientMetadata).mockResolvedValue({
			client_id: "https://chatgpt.example/client.json",
			client_name: "ChatGPT",
			redirect_uris: ["https://chatgpt.example/callback"],
		})

		await expect(
			validateClientRedirect(
				"https://chatgpt.example/client.json",
				"https://chatgpt.example:443/callback",
			),
		).rejects.toThrow("invalid_redirect_uri")

		vi.resetAllMocks()
	})

	test("keeps loopback redirect userinfo exact", async () => {
		vi.mocked(fetchClientMetadata).mockResolvedValue({
			client_id: "https://chatgpt.example/client.json",
			client_name: "ChatGPT",
			redirect_uris: ["http://127.0.0.1/callback"],
		})

		await expect(
			validateClientRedirect(
				"https://chatgpt.example/client.json",
				"http://attacker:secret@127.0.0.1:64648/callback",
			),
		).rejects.toThrow("invalid_redirect_uri")

		vi.resetAllMocks()
	})

	test("requires a client ID in the metadata document", async () => {
		vi.mocked(fetchClientMetadata).mockResolvedValue({
			client_name: "ChatGPT",
			redirect_uris: ["https://chatgpt.example/callback"],
		})
		await expect(
			validateClientRedirect(
				"https://chatgpt.example/client.json",
				"https://chatgpt.example/callback",
			),
		).rejects.toThrow()
		vi.resetAllMocks()
	})
})
