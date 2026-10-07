import { run } from "../platform/effects"
import { runNativeCli } from "./main"

export function cliEffect(argv: string[]) {
	return runNativeCli(
		argv,
		argv.includes("auth") ||
			argv.includes("--api-key") ||
			argv.some(value => value.startsWith("--api-key=")),
	)
}
export function runCli(argv: string[]) {
	return run(cliEffect(argv))
}
