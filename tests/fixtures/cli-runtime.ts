import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import { runMain } from "../../src/cli/runtime"

if (import.meta.main)
	runMain(
		Effect.yieldNow.pipe(
			Effect.andThen(
				Effect.acquireRelease(Console.log("ready"), () =>
					Console.log("cleaning").pipe(Effect.andThen(Effect.never)),
				).pipe(Effect.andThen(Effect.never), Effect.scoped),
			),
		),
		{ disableErrorReporting: true },
	)
