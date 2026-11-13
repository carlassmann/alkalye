import { renderExport } from "./render-export"
import { Buffer } from "node:buffer"
import { readFile, writeFile, mkdir, rm } from "node:fs/promises"
import { dirname } from "node:path"
import process from "node:process"
import { Effect } from "effect"
import * as Option from "effect/Option"
import { z } from "zod"
import { RecoveryPhrase } from "jazz-tools/passphrase"
import { mintLocalFirstTokenInJs } from "jazz-tools/thin"
import { entropyToMnemonic } from "@scure/bip39"
import { wordlist } from "@/app/features/auth/lib/wordlist"
import { resolveCliConfig, type CliConfig } from "./config"
import { AuthError, CliUsageError, UnexpectedCliError } from "./errors"
import { printData, printError, printContent } from "./output"
import { interpretEscapes } from "./parse"
import type { GlobalArgs } from "./options"

export { runCommand, executeCommand }

function runCommand<A extends GlobalArgs>(
	command: string,
	args: A,
	handler: (config: CliConfig) => Promise<unknown>,
) {
	return Effect.tryPromise({
		try: async () => {
			let config = await resolveCliConfig({
				json: args.json,
				quiet: args.quiet,
				verbose: args.verbose,
				server: Option.getOrUndefined(args.server),
				syncPeer: Option.getOrUndefined(args.syncPeer),
				timeout: Option.getOrUndefined(args.timeout),
				home: Option.getOrUndefined(args.home),
			})
			let data = await handler(config)
			if (!config.quiet && data !== undefined)
				printData({
					json: config.json,
					command,
					data,
					meta: config.verbose ? { serverUrl: config.serverUrl } : undefined,
				})
		},
		catch: error =>
			error instanceof AuthError || error instanceof CliUsageError
				? error
				: new UnexpectedCliError({
						message: error instanceof Error ? error.message : String(error),
					}),
	}).pipe(
		Effect.tapError(error =>
			Effect.sync(() =>
				printError({
					json: args.json,
					command,
					error: { type: error._tag, message: error.message },
				}),
			),
		),
	)
}

async function executeCommand(
	command: string,
	raw: object,
	config: CliConfig,
): Promise<unknown> {
	let args: Record<string, unknown> = Object.fromEntries(
		Object.entries(raw).map(([key, value]) => [
			key,
			Option.isOption(value) ? Option.getOrUndefined(value) : value,
		]),
	)
	if (command === "auth.logout") {
		await rm(config.authFile, { force: true })
		return { loggedOut: true }
	}
	if (command === "auth.signup" || command === "auth.login") {
		let phrase = await input(
			args,
			"passphrase",
			"passphraseFile",
			"passphraseStdin",
		)
		if (!phrase && command === "auth.signup")
			phrase = entropyToMnemonic(
				crypto.getRandomValues(new Uint8Array(32)),
				wordlist,
			)
		if (!phrase)
			throw new CliUsageError({
				message: "Provide --passphrase-file or --passphrase-stdin",
			})
		let secret = RecoveryPhrase.toSecret(phrase.trim())
		for (let field of ["passphrase", "passphraseFile", "passphraseStdin"])
			delete args[field]
		let result = await remoteCommand(command, args, secret, config)
		await mkdir(dirname(config.authFile), { recursive: true, mode: 0o700 })
		await writeFile(
			config.authFile,
			JSON.stringify({ secret, serverUrl: config.serverUrl }),
			{ mode: 0o600 },
		)
		return command === "auth.signup"
			? {
					...z.record(z.string(), z.unknown()).parse(result),
					passphrase: phrase.trim(),
				}
			: result
	}
	if (
		command === "doc.export" &&
		typeof args.file === "string" &&
		(args.theme === undefined ||
			(typeof args.theme === "string" &&
				(args.theme.endsWith(".theme.md") || args.theme.includes("/"))))
	)
		return renderExport(
			args,
			async () => {
				throw new AuthError({ message: "Sign in to load a saved theme" })
			},
			config.timeoutMs,
		)
	let saved: unknown
	try {
		saved = JSON.parse(await readFile(config.authFile, "utf8"))
	} catch {
		throw new AuthError({ message: "Not signed in. Run alkalye auth login." })
	}
	let { secret, serverUrl } = z
		.object({ secret: z.string(), serverUrl: z.string() })
		.parse(saved)
	if (serverUrl !== config.serverUrl)
		throw new AuthError({
			message: "Credentials belong to another server. Sign in for this server.",
		})
	if (command === "auth.passphrase")
		return { passphrase: RecoveryPhrase.fromSecret(secret) }
	if (args.offline || args.local)
		throw new CliUsageError({
			message: "Jazz v2 CLI requires an online backend.",
		})
	let content = await input(args, "content", "contentFile", "stdin")
	if (content !== undefined)
		args.content =
			typeof args.content === "string" ? interpretEscapes(content) : content
	for (let field of ["passphrase", "passphraseFile", "passphraseStdin"])
		delete args[field]
	if (typeof args.file === "string" && command === "doc.asset.add")
		args.data = Buffer.from(await readFile(args.file)).toString("base64")
	if (typeof args.source === "string" && command.startsWith("theme."))
		args.sourceContent = await readFile(args.source, "utf8")
	if (command === "doc.export")
		return renderExport(
			args,
			(command, args) => remoteCommand(command, args, secret, config),
			config.timeoutMs,
		)
	let result = await remoteCommand(command, args, secret, config)
	if (command === "doc.content" && !config.json && typeof result === "string") {
		if (!config.quiet) printContent(result)
		return undefined
	}
	return result
}

async function remoteCommand(
	command: string,
	args: Record<string, unknown>,
	secret: string,
	config: CliConfig,
) {
	let response = await fetch(`${config.serverUrl}/api/cli`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: `Bearer ${mintLocalFirstTokenInJs(secret, `${config.serverUrl}/jazz`)}`,
		},
		body: JSON.stringify({ command, args }),
		signal: AbortSignal.timeout(config.timeoutMs),
	})
	let body: unknown = await response.json()
	if (!response.ok)
		throw new Error(z.object({ error: z.string() }).parse(body).error)
	return z.object({ data: z.unknown() }).parse(body).data
}
async function input(
	args: Record<string, unknown>,
	inline: string,
	file: string,
	stdin: string,
) {
	let count = [
		typeof args[inline] === "string",
		typeof args[file] === "string",
		args[stdin] === true,
	].filter(Boolean).length
	if (count > 1)
		throw new CliUsageError({
			message: `Choose one of --${inline}, --${file}, --${stdin}`,
		})
	if (typeof args[inline] === "string") return args[inline]
	if (typeof args[file] === "string") return readFile(args[file], "utf8")
	if (args[stdin] === true) {
		let chunks: Buffer[] = []
		for await (let chunk of process.stdin) chunks.push(Buffer.from(chunk))
		return Buffer.concat(chunks).toString("utf8")
	}
	return undefined
}
