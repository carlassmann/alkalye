import type { APIRoute } from "astro"
import { jazz } from "@/jazz/server"
import {
	challenge,
	claimClassicAccount,
	importClassicItem,
	uploadChunk,
	importStagedItem,
	prepareClassicItem,
	lookupClassicItem,
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
				: action === "lookup"
					? await lookupClassicItem(accountId, await readImportRequest(request))
					: action === "prepare"
						? await prepareClassicItem(
								accountId,
								await readImportRequest(request),
							)
						: action === "claim"
							? await claimClassicAccount(
									accountId,
									await readImportRequest(request),
								)
							: action === "chunk"
								? await uploadChunk(accountId, await readImportRequest(request))
								: action === "staged-item"
									? await importStagedItem(
											accountId,
											await readImportRequest(request),
										)
									: await importClassicItem(
											accountId,
											await readImportRequest(request),
										)
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

async function readImportRequest(request: Request): Promise<unknown> {
	let reader = request.body?.getReader()
	if (!reader) throw new Error("Classic import body required")
	let chunks = []
	let length = 0
	while (true) {
		let part = await reader.read()
		if (part.done) break
		length += part.value.length
		if (length > 3 * 1024 * 1024) {
			await reader.cancel()
			throw new Error("Classic request too large; use chunks")
		}
		chunks.push(part.value)
	}
	let bytes = new Uint8Array(length)
	let offset = 0
	for (let chunk of chunks) {
		bytes.set(chunk, offset)
		offset += chunk.length
	}
	return JSON.parse(new TextDecoder().decode(bytes))
}
