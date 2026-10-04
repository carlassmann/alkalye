import * as Cause from "effect/Cause"
import * as Exit from "effect/Exit"
import * as Runtime from "effect/Runtime"
import * as CliError from "effect/cli/CliError"

export let runMain = Runtime.makeRunMain(({ fiber, teardown }) => {
	let termination: "SIGINT" | "SIGTERM" | undefined
	function interrupt() {
		terminate("SIGINT")
	}
	function stop() {
		terminate("SIGTERM")
	}
	function terminate(signal: "SIGINT" | "SIGTERM") {
		if (termination) process.exit(signal === "SIGINT" ? 130 : 143)
		termination = signal
		fiber.interruptUnsafe(fiber.id)
	}
	process.on("SIGINT", interrupt)
	process.on("SIGTERM", stop)
	fiber.addObserver(exit => {
		process.removeListener("SIGINT", interrupt)
		process.removeListener("SIGTERM", stop)
		if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)) {
			let error = Cause.squash(exit.cause)
			if (!CliError.isCliError(error))
				console.error(error instanceof Error ? error.message : error)
		}
		teardown(exit, code => {
			if (termination) process.exit(termination === "SIGINT" ? 130 : 143)
			process.exitCode = code
		})
	})
})
