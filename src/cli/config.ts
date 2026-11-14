import { homedir } from "node:os"
import { join } from "node:path"
import process from "node:process"
import { ConfigError } from "./errors"

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
	let timeoutMs = flags.timeout ?? Number(process.env.ALKALYE_TIMEOUT ?? 30_000)
	if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
		throw new ConfigError({ message: "Timeout must be a positive integer" })
	let serverUrl = new URL(
		flags.server ?? process.env.ALKALYE_SERVER ?? "https://alkalye.com",
	).origin
	if (
		!serverUrl.startsWith("https://") &&
		!/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(serverUrl)
	)
		throw new ConfigError({ message: "Server must use HTTPS" })
	return {
		json: flags.json ?? false,
		verbose: flags.verbose ?? false,
		quiet: flags.quiet ?? false,
		serverUrl,
		syncPeer: `${serverUrl}/jazz`,
		timeoutMs,
		homeDir,
		authFile: join(homeDir, "auth", "state.json"),
		baseUrl: serverUrl,
	}
}
