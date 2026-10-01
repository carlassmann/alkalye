export { InvalidConnectionError, InvalidGrantError, McpUnavailableError }

class InvalidConnectionError extends Error {
	constructor() {
		super("MCP connection is disconnected")
		this.name = "InvalidConnectionError"
	}
}

class McpUnavailableError extends Error {
	constructor(cause?: unknown) {
		super("MCP is temporarily unavailable", { cause })
		this.name = "McpUnavailableError"
	}
}

class InvalidGrantError extends Error {
	constructor() {
		super("invalid_grant")
		this.name = "InvalidGrantError"
	}
}
