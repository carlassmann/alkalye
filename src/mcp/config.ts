import { PUBLIC_JAZZ_SYNC_SERVER } from "astro:env/client"
import {
	ALKALYE_MCP_ALLOWED_CLIENT_HOSTS,
	ALKALYE_MCP_BASE_URL,
	ALKALYE_MCP_REDIS_TOKEN,
	ALKALYE_MCP_REDIS_URL,
	ALKALYE_MCP_TOKEN_KEY,
} from "astro:env/server"
import { createTokenCodec } from "./token"
import {
	createInMemoryReplayStore,
	createRedisReplayStore,
} from "./replay-store"

export { getMcpConfig }

let developmentReplayStore = createInMemoryReplayStore()

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
		replayStore: createReplayStore(baseUrl),
	}
}

function createReplayStore(baseUrl: URL) {
	if (ALKALYE_MCP_REDIS_URL && ALKALYE_MCP_REDIS_TOKEN) {
		return createRedisReplayStore({
			url: ALKALYE_MCP_REDIS_URL,
			token: ALKALYE_MCP_REDIS_TOKEN,
		})
	}
	if (
		baseUrl.hostname === "localhost" ||
		baseUrl.hostname.endsWith(".localhost")
	) {
		return developmentReplayStore
	}
	throw new Error(
		"ALKALYE_MCP_REDIS_URL and ALKALYE_MCP_REDIS_TOKEN are required in production",
	)
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
