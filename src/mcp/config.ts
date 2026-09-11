import { PUBLIC_JAZZ_SYNC_SERVER } from "astro:env/client"
import {
	ALKALYE_MCP_ALLOWED_CLIENT_HOSTS,
	ALKALYE_MCP_BASE_URL,
	ALKALYE_MCP_TOKEN_KEY,
} from "astro:env/server"
import { createTokenCodec } from "./token"
import { createEphemeralReplayStore } from "./replay-store"

export { getMcpConfig }

let replayStore = createEphemeralReplayStore()

function getMcpConfig() {
	let baseUrl = requiredUrl(ALKALYE_MCP_BASE_URL, "ALKALYE_MCP_BASE_URL")
	let syncServer = requiredWebSocketUrl(
		PUBLIC_JAZZ_SYNC_SERVER,
		"PUBLIC_JAZZ_SYNC_SERVER",
	)

	return {
		baseUrl,
		syncServer,
		tokens: createTokenCodec(ALKALYE_MCP_TOKEN_KEY),
		allowedClientHosts: (
			ALKALYE_MCP_ALLOWED_CLIENT_HOSTS ?? "chatgpt.com,openai.com"
		)
			.split(",")
			.map(host => host.trim().toLowerCase())
			.filter(Boolean),
		replayStore,
	}
}

function requiredUrl(input: string, name: string): URL {
	let value = new URL(input)
	if (value.protocol !== "https:" && value.hostname !== "localhost") {
		throw new Error(`${name} must use HTTPS`)
	}
	return value
}

function requiredWebSocketUrl(value: string, name: string): string {
	if (!value.startsWith("ws://") && !value.startsWith("wss://")) {
		throw new Error(`${name} must use WebSocket transport`)
	}
	return value
}
