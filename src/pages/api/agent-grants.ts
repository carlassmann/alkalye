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
		.max(5_000),
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
		await runWithAgentAccount(
			config.syncServer,
			credentials,
			async agent => {
				let account = await withDeadline(
					agent.account.$jazz.ensureLoaded({
						resolve: { root: { documents: true, spaces: true } },
					}),
					20_000,
				)
				let rollbacks: (() => void)[] = []
				try {
					let updates = await withDeadline(
						Promise.all(
							input.updates.map(update => resolveGrantUpdate(account, update)),
						),
						20_000,
					)
					for (let update of updates) {
						let rollback = applyGrantUpdate(account, update)
						if (rollback) rollbacks.push(rollback)
					}
					await agent.account.$jazz.waitForAllCoValuesSync({ timeout: 10_000 })
				} catch (error) {
					for (let rollback of rollbacks.reverse()) rollback()
					if (rollbacks.length > 0) {
						await agent.account.$jazz
							.waitForAllCoValuesSync({ timeout: 10_000 })
							.catch(() => undefined)
					}
					throw error
				}
			},
			false,
		)
		return json({ ok: true })
	} catch (error) {
		console.error("[agent-grants] update failed", error)
		return json({ error: "Could not update agent access" }, 400)
	}
}

type GrantUpdate = z.infer<typeof requestSchema>["updates"][number]
type ResolvedGrantUpdate =
	| {
			kind: "document"
			action: "add" | "remove"
			id: string
			addition?: co.loaded<typeof Document>
	  }
	| {
			kind: "space"
			action: "add" | "remove"
			id: string
			addition?: co.loaded<typeof Space>
	  }

async function resolveGrantUpdate(
	account: AgentGrantAccount,
	update: GrantUpdate,
): Promise<ResolvedGrantUpdate> {
	if (update.resource.kind === "document") {
		let existing = account.root.documents.some(
			document => document?.$jazz.id === update.resource.id,
		)
		if (update.action === "remove" || existing) {
			return {
				kind: "document",
				action: update.action,
				id: update.resource.id,
			}
		}
		let document = await Document.load(update.resource.id, { loadAs: account })
		if (!document.$isLoaded)
			throw new Error("Document is not shared with agent")
		return {
			kind: "document",
			action: update.action,
			id: update.resource.id,
			addition: document,
		}
	}
	let existing = account.root.spaces?.some(
		space => space?.$jazz.id === update.resource.id,
	)
	if (update.action === "remove" || existing) {
		return { kind: "space", action: update.action, id: update.resource.id }
	}
	let space = await Space.load(update.resource.id, { loadAs: account })
	if (!space.$isLoaded) throw new Error("Space is not shared with agent")
	return {
		kind: "space",
		action: update.action,
		id: update.resource.id,
		addition: space,
	}
}

function applyGrantUpdate(
	account: AgentGrantAccount,
	update: ResolvedGrantUpdate,
) {
	if (update.kind === "document") {
		return applyDocumentGrant(account, update)
	}
	return applySpaceGrant(account, update)
}

function applyDocumentGrant(
	account: AgentGrantAccount,
	update: Extract<ResolvedGrantUpdate, { kind: "document" }>,
) {
	let documents = account.root.documents
	let index = documents.findIndex(document => document?.$jazz.id === update.id)
	if (update.action === "remove") {
		let document = index === -1 ? undefined : documents[index]
		if (!document) return undefined
		documents.$jazz.splice(index, 1)
		return () =>
			documents.$jazz.splice(Math.min(index, documents.length), 0, document)
	}
	if (index !== -1 || !update.addition) return undefined
	documents.$jazz.push(update.addition)
	return () => {
		let addedIndex = documents.findIndex(
			document => document?.$jazz.id === update.id,
		)
		if (addedIndex !== -1) documents.$jazz.splice(addedIndex, 1)
	}
}

function applySpaceGrant(
	account: AgentGrantAccount,
	update: Extract<ResolvedGrantUpdate, { kind: "space" }>,
) {
	let spaces = account.root.spaces
	if (!spaces) throw new Error("Agent spaces are unavailable")
	let index = spaces.findIndex(space => space?.$jazz.id === update.id)
	if (update.action === "remove") {
		let space = index === -1 ? undefined : spaces[index]
		if (!space) return undefined
		spaces.$jazz.splice(index, 1)
		return () => spaces.$jazz.splice(Math.min(index, spaces.length), 0, space)
	}
	if (index !== -1 || !update.addition) return undefined
	spaces.$jazz.push(update.addition)
	return () => {
		let addedIndex = spaces.findIndex(space => space?.$jazz.id === update.id)
		if (addedIndex !== -1) spaces.$jazz.splice(addedIndex, 1)
	}
}

async function withDeadline<Result>(
	promise: Promise<Result>,
	timeoutMs: number,
) {
	let timeout: ReturnType<typeof setTimeout> | undefined
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timeout = setTimeout(
					() => reject(new Error("Grant validation timed out")),
					timeoutMs,
				)
			}),
		])
	} finally {
		if (timeout) clearTimeout(timeout)
	}
}

function json(body: unknown, status: number = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	})
}
