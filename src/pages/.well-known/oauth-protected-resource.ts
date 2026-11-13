import type { APIRoute } from "astro"
import { getMcpConfig } from "@/mcp/config"
import { protectedResourceMetadata } from "@/mcp/metadata"

export { GET, OPTIONS }

export const prerender = false

let GET: APIRoute = () => {
	let { baseUrl } = getMcpConfig()
	return metadata(protectedResourceMetadata(baseUrl))
}

let OPTIONS: APIRoute = () =>
	new Response(null, { status: 204, headers: cors() })

function metadata(body: unknown) {
	return new Response(JSON.stringify(body), {
		headers: { ...cors(), "content-type": "application/json" },
	})
}

function cors() {
	return {
		"access-control-allow-origin": "*",
		"access-control-allow-methods": "GET, OPTIONS",
	}
}
