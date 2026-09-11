export { updateAgentGrants }
export type { AgentGrantUpdate }

interface AgentGrantUpdate {
	action: "add" | "remove"
	resource: { kind: "document" | "space"; id: string }
}

async function updateAgentGrants(
	credential: string,
	updates: AgentGrantUpdate[],
) {
	for (let index = 0; index < updates.length; index += 100) {
		let response = await fetch("/api/agent-grants", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				credential,
				updates: updates.slice(index, index + 100),
			}),
			signal: AbortSignal.timeout(20_000),
		})
		if (!response.ok) throw new Error("Could not update agent access")
	}
}
