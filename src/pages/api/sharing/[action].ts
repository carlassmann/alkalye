import process from "node:process"
import type { APIRoute } from "astro"
import { jazz } from "@/jazz/server"
import { sharingOperation } from "@/jazz/sharing/operations"

export const prerender = false
export let POST: APIRoute = async ({ request, params, url }) => {
	let accountId: string
	let publicOrigin: string
	try {
		await jazz.ready()
		let publicUrl = process.env.WORK_WEB_URL
			? process.env.WORK_WEB_URL + "/jazz"
			: (process.env.JAZZ_PUBLIC_URL ?? url.origin + "/jazz")
		let db = await jazz.forReqUser(request)
		let user = db.getAuthState().session?.user
		if (!user) throw new Error("Device account required")
		accountId = user
		publicOrigin = new URL(publicUrl).origin
	} catch {
		return new Response("Invalid device proof", { status: 401 })
	}
	try {
		return Response.json(
			await sharingOperation(
				jazz,
				accountId,
				params.action ?? "",
				await request.json(),
				publicOrigin,
			),
		)
	} catch (error) {
		return new Response(
			error instanceof Error ? error.message : "Sharing failed",
			{ status: 400 },
		)
	}
}
