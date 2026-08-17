#!/usr/bin/env bun

import { NodeContext, NodeRuntime } from "@effect/platform-node"
import { defaultTeardown } from "@effect/platform/Runtime"
import { Effect } from "effect"
import process from "node:process"
import { cli } from "@/cli/app"
import { getExitCode } from "@/cli/errors"
import { renderCustomHelp } from "@/cli/help"
import { version } from "@/cli/version"

let args = process.argv.slice(2)

let help = renderCustomHelp(args, version)
if (help) {
	process.stdout.write(`${help}\n`)
	process.exit(0)
}

let { strippedArgs, envVars } = extractGlobalFlags(args)

for (let [key, value] of Object.entries(envVars)) {
	if (!process.env[key]) process.env[key] = value
}

cli([process.argv[0], process.argv[1], ...strippedArgs]).pipe(
	Effect.provide(NodeContext.layer),
	Effect.catchAll(error =>
		Effect.sync(() => {
			exitAfterOutputFlush(getExitCode(error))
		}),
	),
	NodeRuntime.runMain({
		teardown: exit => defaultTeardown(exit, exitAfterOutputFlush),
	}),
)

function exitAfterOutputFlush(code: number) {
	let pendingStreams = 2
	function finishStream() {
		pendingStreams--
		if (pendingStreams === 0) process.exit(code)
	}
	process.stdout.write("", finishStream)
	process.stderr.write("", finishStream)
}

type GlobalFlagResult = {
	strippedArgs: string[]
	envVars: Record<string, string>
}

function extractGlobalFlags(args: string[]): GlobalFlagResult {
	let envVars: Record<string, string> = {}
	let strippedArgs: string[] = []
	let index = 0

	while (index < args.length) {
		let arg = args[index]
		let nextArg = args[index + 1]

		if (arg === "--server" && nextArg && !nextArg.startsWith("-")) {
			envVars.ALKALYE_SERVER = nextArg
			index += 2
		} else if (arg.startsWith("--server=")) {
			envVars.ALKALYE_SERVER = arg.slice("--server=".length)
			index += 1
		} else if (arg === "--sync-peer" && nextArg && !nextArg.startsWith("-")) {
			envVars.ALKALYE_SYNC_PEER = nextArg
			index += 2
		} else if (arg.startsWith("--sync-peer=")) {
			envVars.ALKALYE_SYNC_PEER = arg.slice("--sync-peer=".length)
			index += 1
		} else if (arg === "--home" && nextArg && !nextArg.startsWith("-")) {
			envVars.ALKALYE_CLI_HOME = nextArg
			index += 2
		} else if (arg.startsWith("--home=")) {
			envVars.ALKALYE_CLI_HOME = arg.slice("--home=".length)
			index += 1
		} else if (arg === "--timeout" && nextArg && !nextArg.startsWith("-")) {
			index += 2
		} else if (arg.startsWith("--timeout=")) {
			index += 1
		} else if (arg === "--json" || arg === "-j") {
			strippedArgs.push(arg)
			index += 1
		} else if (arg === "--verbose" || arg === "-v") {
			strippedArgs.push(arg)
			index += 1
		} else if (arg === "--quiet" || arg === "-q") {
			strippedArgs.push(arg)
			index += 1
		} else {
			strippedArgs.push(arg)
			index += 1
		}
	}

	return { strippedArgs, envVars }
}
