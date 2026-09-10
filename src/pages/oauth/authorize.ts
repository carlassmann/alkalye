import { Buffer } from "node:buffer"
import type { APIRoute } from "astro"
import { authorizationRequestSchema } from "@/mcp/oauth"

export { GET }

export const prerender = false

let GET: APIRoute = ({ request }) => {
	try {
		let url = new URL(request.url)
		let parsed = authorizationRequestSchema.parse(
			Object.fromEntries(url.searchParams),
		)
		let oauth = Buffer.from(JSON.stringify(parsed)).toString("base64url")
		return Response.redirect(new URL(`/app/settings?oauth=${oauth}`, url), 302)
	} catch {
		return new Response("Invalid OAuth authorization request", { status: 400 })
	}
}
