import { ALKALYE_MCP_BASE_URL, ALKALYE_MCP_TOKEN_KEY } from "astro:env/server"
import { createTokenCodec } from "./token"
import { createEphemeralReplayStore } from "./replay-store"

export { getMcpConfig }

let replayStore = createEphemeralReplayStore()

function getMcpConfig() {
	let baseUrl = requiredUrl(ALKALYE_MCP_BASE_URL, "ALKALYE_MCP_BASE_URL")

	return {
		baseUrl,
		tokens: createTokenCodec(ALKALYE_MCP_TOKEN_KEY),
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
