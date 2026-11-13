import type { APIRoute } from "astro"
import { z } from "zod"
import { jazz } from "@/jazz/server"
import { executeServerCommand } from "@/cli/server"

export { POST }
export const prerender = false

let POST: APIRoute = async ({ request }) => {
	let db
	try {
		db = await jazz.forReqUser(request)
	} catch {
		return Response.json({ error: "Authentication required" }, { status: 401 })
	}
	try {
		let { command, args } = z
			.object({ command: z.string(), args: z.unknown() })
			.parse(await request.json())
		let data = await executeServerCommand(
			db,
			command,
			args,
			new URL(request.url).origin,
		)
		return Response.json({ data }, { headers: { "cache-control": "no-store" } })
	} catch (error) {
		console.error("[cli] command failed", error)
		return Response.json(
			{
				error: "The command failed. Check its arguments and your permissions.",
			},
			{ status: 400 },
		)
	}
}
