import * as Effect from "effect/Effect"

export function withBrowserLock<A, E, R>(
	name: string,
	work: Effect.Effect<A, E, R>,
	locks: LockManager,
) {
	return Effect.callback<A, E, R>((resume, signal) => {
		let release: (() => void) | undefined
		locks
			.request(name, { signal }, () => {
				if (signal.aborted) return
				return new Promise<void>(finish => {
					release = finish
					resume(work.pipe(Effect.ensuring(Effect.sync(finish))))
				})
			})
			.catch(cause => resume(Effect.die(cause)))
		return Effect.sync(() => release?.())
	})
}
