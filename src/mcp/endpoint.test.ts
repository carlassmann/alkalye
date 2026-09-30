import { createContext } from "astro/middleware"
import { describe, expect, test, vi } from "vitest"
import { getMcpConfig } from "@/mcp/config"
import { POST } from "../pages/mcp"

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
