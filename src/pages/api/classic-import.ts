import type { APIRoute } from "astro"
import { jazz } from "@/jazz/server"
import {
	challenge,
	claimClassicAccount,
	importClassicItem,
	uploadChunk,
	importStagedItem,
} from "@/app/features/classic-import/server"
export const prerender = false
export let POST: APIRoute = async ({ request }) => {
	try {
		let db = await jazz.forReqUser(request)
		let accountId = db.getAuthState().session?.user
		if (!accountId) return new Response("Unauthorized", { status: 401 })
		let action = new URL(request.url).searchParams.get("action")
		let result =
			action === "challenge"
				? await challenge(accountId)
				: action === "claim"
					? await claimClassicAccount(accountId, await request.json())
					: action === "chunk"
						? await uploadChunk(accountId, await request.json())
						: action === "staged-item"
							? await importStagedItem(accountId, await request.json())
							: await importClassicItem(accountId, await request.json())
		return Response.json(result)
	} catch (error) {
		return Response.json(
			{
				error: error instanceof Error ? error.message : "Classic import failed",
			},
			{ status: 400 },
		)
	}
}
