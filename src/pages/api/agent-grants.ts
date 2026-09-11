import type { APIRoute } from "astro"
import { z } from "zod"
import { co } from "jazz-tools"
import { Document, Space, UserAccount } from "@/schema"
import { agentCredentialsSchema } from "@/mcp/credentials"
import { getMcpConfig } from "@/mcp/config"
import { runWithAgentAccount } from "@/mcp/jazz"

export { POST }

export const prerender = false

let resourceSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("document"), id: z.string() }),
	z.object({ kind: z.literal("space"), id: z.string() }),
])
let requestSchema = z.object({
	credential: z.string(),
	updates: z
		.array(
			z.object({
				action: z.enum(["add", "remove"]),
				resource: resourceSchema,
			}),
		)
		.min(1)
		.max(500),
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
		await runWithAgentAccount(config.syncServer, credentials, async agent => {
			let account = await agent.account.$jazz.ensureLoaded({
				resolve: { root: { documents: true, spaces: true } },
			})
			for (let update of input.updates) {
				if (update.resource.kind === "document") {
					await updateDocumentGrant(account, update.action, update.resource.id)
				} else {
					await updateSpaceGrant(account, update.action, update.resource.id)
				}
			}
			await agent.account.$jazz.waitForAllCoValuesSync({ timeout: 10_000 })
		})
		return json({ ok: true })
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
