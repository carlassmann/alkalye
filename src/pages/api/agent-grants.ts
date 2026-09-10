import type { APIRoute } from "astro"
import { z } from "zod"
import { co } from "jazz-tools"
import { Document, Space, UserAccount } from "@/schema"
import { agentCredentialsSchema } from "@/mcp/credentials"
import { getMcpConfig } from "@/mcp/config"
import { openAgentAccount } from "@/mcp/jazz"

export { POST }

export const prerender = false

let requestSchema = z.object({
	credential: z.string(),
	action: z.enum(["add", "remove"]),
	resource: z.discriminatedUnion("kind", [
		z.object({ kind: z.literal("document"), id: z.string() }),
		z.object({ kind: z.literal("space"), id: z.string() }),
	]),
})

type AgentGrantAccount = co.loaded<
	typeof UserAccount,
	{ root: { documents: true; spaces: true } }
>

let POST: APIRoute = async ({ request }) => {
	try {
		let body: unknown = await request.json()
		let input = requestSchema.parse(body)
		let config = getMcpConfig()
		let credentials = await config.tokens.open(
			"connection",
			input.credential,
			agentCredentialsSchema,
		)
		let agent = await openAgentAccount(config.syncServer, credentials)
		try {
			let account = await agent.account.$jazz.ensureLoaded({
				resolve: { root: { documents: true, spaces: true } },
			})
			if (input.resource.kind === "document") {
				await updateDocumentGrant(account, input.action, input.resource.id)
			} else {
				await updateSpaceGrant(account, input.action, input.resource.id)
			}
			await agent.account.$jazz.waitForAllCoValuesSync({ timeout: 10_000 })
			return json({ ok: true })
		} finally {
			await agent.close()
		}
	} catch (error) {
		console.error("[agent-grants] update failed", error)
		return json({ error: "Could not update agent access" }, 400)
	}
}

async function updateDocumentGrant(
	account: AgentGrantAccount,
	action: "add" | "remove",
	documentId: string,
) {
	let index = account.root.documents.findIndex(
		document => document?.$jazz.id === documentId,
	)
	if (action === "remove") {
		if (index !== -1) account.root.documents.$jazz.splice(index, 1)
		return
	}
	if (index !== -1) return
	let document = await Document.load(documentId, { loadAs: account })
	if (!document.$isLoaded) throw new Error("Document is not shared with agent")
	account.root.documents.$jazz.push(document)
}

async function updateSpaceGrant(
	account: AgentGrantAccount,
	action: "add" | "remove",
	spaceId: string,
) {
	let spaces = account.root.spaces
	if (!spaces) throw new Error("Agent spaces are unavailable")
	let index = spaces.findIndex(space => space?.$jazz.id === spaceId)
	if (action === "remove") {
		if (index !== -1) spaces.$jazz.splice(index, 1)
		return
	}
	if (index !== -1) return
	let space = await Space.load(spaceId, { loadAs: account })
	if (!space.$isLoaded) throw new Error("Space is not shared with agent")
	spaces.$jazz.push(space)
}

function json(body: unknown, status: number = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	})
}
