import { run } from "../platform/effects"
import { runNativeCli } from "./main"

export function cliEffect(argv: string[]) {
	return runNativeCli(argv, argv.includes("auth"))
}
export function runCli(argv: string[]) {
	return run(cliEffect(argv))
}
