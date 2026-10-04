import * as HttpClient from "effect/http/HttpClient"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import { ApplicationError } from "./errors"

export function attempt<A>(operation: string, work: () => A) {
	return Effect.try({
		try: work,
		catch: cause => new ApplicationError({ operation, cause }),
	})
}
export function promise<A>(
	operation: string,
	work: (signal: AbortSignal) => PromiseLike<A>,
) {
	return Effect.tryPromise({
		try: work,
		catch: cause => new ApplicationError({ operation, cause }),
	})
}
export async function run<A, E>(
	effect: Effect.Effect<A, E, HttpClient.HttpClient>,
	signal?: AbortSignal,
): Promise<A> {
	let exit = await Effect.runPromiseExit(
		effect.pipe(Effect.provide(FetchHttpClient.layer)),
		{ signal },
	)
	if (Exit.isSuccess(exit)) return exit.value
	for (let reason of exit.cause.reasons) {
		if (Cause.isFailReason(reason)) throw reason.error
		if (Cause.isDieReason(reason)) throw reason.defect
	}
	throw new DOMException("Cancelled", "AbortError")
}
