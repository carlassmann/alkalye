import { InvalidConnectionError } from "./errors"
import { createContext } from "astro/middleware"
import { describe, expect, test, vi } from "vitest"
import { mcpHandler } from "@/mcp/server"
import { McpUnavailableError } from "./errors"
import { getMcpConfig } from "@/mcp/config"
import { validateConnection } from "@/mcp/connection"
import { POST } from "../pages/mcp"

vi.mock("@/mcp/connection", () => ({ validateConnection: vi.fn() }))

vi.mock("@/mcp/server", () => ({
	mcpHandler: { fetch: vi.fn(() => Response.json({ connected: true })) },
}))

describe("MCP client connections", () => {
	test.each([
		"https://claude.ai",
		"https://cursor.com",
		"https://custom.example",
		undefined,
	])("accepts authenticated requests from %s", async origin => {
		let config = getMcpConfig()
		let token = await config.tokens.seal(
			"access_token",
			{
				clientId: "https://custom.example/client.json",
				resource: "https://www.alkalye.com/mcp",
				scope: "alkalye",
				credential: "wrapped-agent",
			},
			Date.now() + 60_000,
		)
		let headers = new Headers({
			authorization: `Bearer ${token}`,
			host: "www.alkalye.com",
		})
		if (origin) headers.set("origin", origin)
		let request = new Request("https://www.alkalye.com/mcp", {
			method: "POST",
			headers,
		})
		let response = await POST(
			createContext({ request, defaultLocale: "en", locals: {} }),
		)
		expect(response.status).toBe(200)
		expect(response.headers.get("access-control-allow-origin")).toBe("*")
		expect(await response.json()).toEqual({ connected: true })
	})

	test("rejects a disconnected connection before dispatch", async () => {
		vi.mocked(validateConnection).mockRejectedValueOnce(
			new InvalidConnectionError(),
		)
		let token = await getMcpConfig().tokens.seal(
			"access_token",
			{
				clientId: "https://custom.example/client.json",
				resource: "https://www.alkalye.com/mcp",
				scope: "alkalye",
				credential: "revoked",
			},
			Date.now() + 60_000,
		)
		let request = new Request("https://www.alkalye.com/mcp", {
			method: "POST",
			headers: { authorization: `Bearer ${token}` },
		})
		let response = await POST(
			createContext({ request, defaultLocale: "en", locals: {} }),
		)
		expect(response.status).toBe(401)
	})

	test.each(["connection", "handler"])(
		"returns 503 for %s failures without challenging authentication",
		async failure => {
			if (failure === "connection")
				vi.mocked(validateConnection).mockRejectedValueOnce(
					new McpUnavailableError(),
				)
			else
				vi.mocked(mcpHandler.fetch).mockRejectedValueOnce(
					new Error("Handler failed"),
				)
			let token = await getMcpConfig().tokens.seal(
				"access_token",
				{
					clientId: "https://custom.example/client.json",
					resource: "https://www.alkalye.com/mcp",
					scope: "alkalye",
					credential: "active",
				},
				Date.now() + 60_000,
			)
			let response = await POST(
				createContext({
					request: new Request("https://www.alkalye.com/mcp", {
						method: "POST",
						headers: { authorization: `Bearer ${token}` },
					}),
					defaultLocale: "en",
					locals: {},
				}),
			)
			expect(response.status).toBe(503)
			expect(response.headers.get("www-authenticate")).toBeNull()
		},
	)

	test("still requires authentication from arbitrary origins", async () => {
		let request = new Request("https://www.alkalye.com/mcp", {
			method: "POST",
			headers: { origin: "https://custom.example" },
		})
		let response = await POST(
			createContext({ request, defaultLocale: "en", locals: {} }),
		)
		expect(response.status).toBe(401)
	})

	test("rejects requests routed through an unexpected host", async () => {
		let request = new Request("https://www.alkalye.com/mcp", {
			method: "POST",
			headers: { host: "attacker.example" },
		})
		let response = await POST(
			createContext({ request, defaultLocale: "en", locals: {} }),
		)
		expect(response.status).toBe(403)
	})
})
