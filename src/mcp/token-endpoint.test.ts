import { Buffer } from "node:buffer"
import { createContext } from "astro/middleware"
import { describe, expect, test, vi } from "vitest"
import { getMcpConfig } from "./config"
import { validateConnection } from "./connection"
import { InvalidConnectionError, McpUnavailableError } from "./errors"
import { approveAuthorization } from "./oauth"
import { POST } from "../pages/oauth/token"

vi.mock("./connection", () => ({ validateConnection: vi.fn() }))

describe("OAuth token endpoint availability", () => {
	test("returns 503 without consuming a grant; retries can exchange and refresh", async () => {
		let config = getMcpConfig()
		let verifier = "v".repeat(64)
		let clientId = "https://custom.example/client.json"
		let resource = "https://www.alkalye.com/mcp"
		let redirectUri = "https://custom.example/callback"
		let challenge = Buffer.from(
			await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
		).toString("base64url")
		let redirect = await approveAuthorization({
			tokens: config.tokens,
			credential: "wrapped",
			clientValidated: true,
			request: {
				client_id: clientId,
				redirect_uri: redirectUri,
				response_type: "code",
				code_challenge: challenge,
				code_challenge_method: "S256",
				state: "state",
				resource,
				scope: "alkalye",
			},
		})
		let code = redirect.searchParams.get("code")
		if (!code) throw new Error("Missing code")
		async function exchange(body: Record<string, string>) {
			return POST(
				createContext({
					request: new Request("https://www.alkalye.com/oauth/token", {
						method: "POST",
						body: new URLSearchParams(body),
					}),
					defaultLocale: "en",
					locals: {},
				}),
			)
		}
		let args = {
			grant_type: "authorization_code",
			code,
			code_verifier: verifier,
			client_id: clientId,
			redirect_uri: redirectUri,
			resource,
		}
		vi.mocked(validateConnection).mockRejectedValueOnce(
			new McpUnavailableError(),
		)
		let failed = await exchange(args)
		expect(failed.status).toBe(503)
		expect(await failed.json()).toEqual({ error: "temporarily_unavailable" })
		let issued = await exchange(args)
		expect(issued.status).toBe(200)
		let tokens: { refresh_token: string } = await issued.json()
		let refresh = {
			grant_type: "refresh_token",
			refresh_token: tokens.refresh_token,
			client_id: clientId,
			resource,
		}
		vi.mocked(validateConnection).mockRejectedValueOnce(
			new McpUnavailableError(),
		)
		expect((await exchange(refresh)).status).toBe(503)
		expect((await exchange(refresh)).status).toBe(200)
		expect((await exchange(refresh)).status).toBe(400)
	})

	test("uses invalid_grant for invalid credentials", async () => {
		let token = await getMcpConfig().tokens.seal("refresh_token", {
			jti: crypto.randomUUID(),
			clientId: "https://custom.example/client.json",
			resource: "https://www.alkalye.com/mcp",
			scope: "alkalye",
			credential: "revoked",
		})
		vi.mocked(validateConnection).mockRejectedValueOnce(
			new InvalidConnectionError(),
		)
		let response = await POST(
			createContext({
				request: new Request("https://www.alkalye.com/oauth/token", {
					method: "POST",
					body: new URLSearchParams({
						grant_type: "refresh_token",
						refresh_token: token,
						client_id: "https://custom.example/client.json",
						resource: "https://www.alkalye.com/mcp",
					}),
				}),
				defaultLocale: "en",
				locals: {},
			}),
		)
		expect(response.status).toBe(400)
		expect(await response.json()).toEqual({ error: "invalid_grant" })
	})
})
