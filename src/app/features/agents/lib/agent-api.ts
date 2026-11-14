import { mintLocalFirstTokenInJs } from "jazz-tools/thin"

export { readJsonResponse, deviceAuthorization, disconnectMcpConnection }

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

function deviceAuthorization(key: string, origin = window.location.origin) {
	return {
		authorization: `Bearer ${mintLocalFirstTokenInJs(key, `${origin}/jazz`)}`,
	}
}

async function disconnectMcpConnection(connectionId: string, key: string) {
	let response = await fetch("/api/mcp-connections", {
		method: "DELETE",
		headers: {
			"content-type": "application/json",
			...deviceAuthorization(key),
		},
		body: JSON.stringify({ connectionId }),
	})
	if (!response.ok) throw new Error("Could not disconnect agent connection")
}
