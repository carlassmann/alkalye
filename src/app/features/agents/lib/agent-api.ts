import type { co } from "jazz-tools"
import { McpConnection } from "./schema"

export { readJsonResponse, disconnectMcpConnection }

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

async function disconnectMcpConnection(
	connection: co.loaded<typeof McpConnection>,
	sync: () => Promise<void>,
) {
	connection.$jazz.set("revokedAt", new Date())
	// Local revocation must survive server outages and token-key rotation.
	await Promise.allSettled([
		sync(),
		fetch("/api/mcp-connections", {
			method: "DELETE",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ credential: connection.credential }),
			signal: AbortSignal.timeout(5_000),
		}),
	])
}
