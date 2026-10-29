import { homedir } from "node:os"
import { join } from "node:path"
import process from "node:process"
import { ConfigError } from "@/cli/errors"

export { resolveCliConfig }
export type { CliConfig, CliFlags }

type CliFlags = {
	json?: boolean
	verbose?: boolean
	quiet?: boolean
	server?: string
	syncPeer?: string
	timeout?: number
	home?: string
}

type CliConfig = {
	json: boolean
	verbose: boolean
	quiet: boolean
	serverUrl: string
	syncPeer: string
	timeoutMs: number
	homeDir: string
	authFile: string
	baseUrl: string
}

async function resolveCliConfig(flags: CliFlags): Promise<CliConfig> {
	let homeDir =
		flags.home ??
		process.env.ALKALYE_CLI_HOME ??
		join(homedir(), ".alkalye", "cli")
	let timeoutMs =
		flags.timeout ??
		(process.env.ALKALYE_TIMEOUT ? Number(process.env.ALKALYE_TIMEOUT) : 10_000)
	if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
		throw new ConfigError({ message: "Timeout must be a positive integer" })
	}

	let serverUrl = resolveServerUrl(flags.server)
	let remote =
		flags.syncPeer || process.env.ALKALYE_SYNC_PEER
			? null
			: await fetchServerConfig(serverUrl)
	let syncPeer =
		flags.syncPeer ??
		process.env.ALKALYE_SYNC_PEER ??
		remote?.syncPeer ??
		process.env.PUBLIC_JAZZ_SYNC_SERVER
	if (!syncPeer) {
		throw new ConfigError({
			message:
				"Missing sync peer. Set --sync-peer, ALKALYE_SYNC_PEER, or point --server at an Alkalye deployment.",
		})
	}
	if (!isWsUrl(syncPeer)) {
		throw new ConfigError({ message: "Sync peer must be ws:// or wss:// URL" })
	}

	return {
		json: flags.json ?? false,
		verbose: flags.verbose ?? false,
		quiet: flags.quiet ?? false,
		serverUrl,
		syncPeer,
		timeoutMs,
		homeDir,
		authFile: join(homeDir, "auth", "state.json"),
		baseUrl:
			process.env.ALKALYE_BASE_URL ??
			remote?.baseUrl ??
			serverUrl ??
			"https://alkalye.com",
	}
}

function isWsUrl(value: string): boolean {
	return value.startsWith("ws://") || value.startsWith("wss://")
}

function resolveServerUrl(value: string | undefined): string {
	let server = value ?? process.env.ALKALYE_SERVER ?? "https://alkalye.com"
	try {
		return new URL(server).toString().replace(/\/$/, "")
	} catch {
		throw new ConfigError({
			message: "Server must be a valid http:// or https:// URL",
		})
	}
}

async function fetchServerConfig(serverUrl: string) {
	let endpoint = `${serverUrl}/.well-known/alkalye-cli.json`

	try {
		let response = await fetch(endpoint, {
			headers: { accept: "application/json" },
		})
		if (!response.ok) {
			throw new ConfigError({
				message: `Failed to load CLI config from ${endpoint}`,
			})
		}

		let data = (await response.json()) as {
			syncPeer?: unknown
			baseUrl?: unknown
		}
		if (typeof data.syncPeer !== "string" || !isWsUrl(data.syncPeer)) {
			throw new ConfigError({
				message: `Invalid syncPeer in ${endpoint}`,
			})
		}

		return {
			syncPeer: data.syncPeer,
			baseUrl:
				typeof data.baseUrl === "string" && data.baseUrl.length > 0
					? data.baseUrl
					: serverUrl,
		}
	} catch (error) {
		if (error instanceof ConfigError) throw error
		throw new ConfigError({
			message: `Could not reach ${endpoint}`,
		})
	}
}
