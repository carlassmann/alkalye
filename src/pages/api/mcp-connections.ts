import type { APIRoute } from "astro"
import { z } from "zod"
import { revokeUserConnection } from "@/mcp/jazz"

export { DELETE }
export const prerender = false

let DELETE: APIRoute = async ({ request }) => {
	try {
		let body: unknown = await request.json()
		let { connectionId } = z.object({ connectionId: z.uuid() }).parse(body)
		await revokeUserConnection(request, connectionId)
		return json({ ok: true })
	} catch {
		return json({ error: "Could not disconnect agent connection" }, 400)
	}
}

function json(body: unknown, status = 200) {
	return Response.json(body, {
		status,
		headers: { "cache-control": "no-store" },
	})
}
