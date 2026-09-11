export { readJsonResponse, updateAgentGrants }
export type { AgentGrantUpdate }

interface AgentGrantUpdate {
	action: "add" | "remove"
	resource: { kind: "document" | "space"; id: string }
}

async function readJsonResponse(response: Response): Promise<unknown> {
	let body = await response.text()
	if (!body) return undefined

	try {
		let value: unknown = JSON.parse(body)
		return value
	} catch {
		return undefined
	}
}

async function updateAgentGrants(
	credential: string,
	updates: AgentGrantUpdate[],
) {
	if (updates.length === 0) return
	let response = await fetch("/api/agent-grants", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ credential, updates }),
		signal: AbortSignal.timeout(150_000),
	})
	if (!response.ok) throw new Error("Could not update agent access")
}
