import * as Effect from "effect/Effect"

// Updates never reload an open page while someone is typing. Production
// also waits for permission before activating its new offline cache.
export function watchUpdates(
	signal: AbortSignal,
	offer: (apply: () => void) => void,
) {
	return Effect.tryPromise(() =>
		navigator.serviceWorker.register("/sw.js"),
	).pipe(
		Effect.tap(registration =>
			Effect.sync(() => {
				let offered = false
				let controlled = Boolean(navigator.serviceWorker.controller)
				let development = process.env.NODE_ENV === "development"
				navigator.serviceWorker.addEventListener(
					"controllerchange",
					() => {
						if (!development || !controlled || offered) return
						offered = true
						offer(() => location.reload())
					},
					{ signal },
				)
				function check() {
					if (development) return
					let waiting = registration.waiting
					if (offered || !waiting || !navigator.serviceWorker.controller) return
					offered = true
					offer(() => {
						navigator.serviceWorker.addEventListener(
							"controllerchange",
							() => location.reload(),
							{ once: true, signal },
						)
						waiting.postMessage("activate")
					})
				}
				registration.addEventListener(
					"updatefound",
					() =>
						registration.installing?.addEventListener("statechange", check, {
							signal,
						}),
					{ signal },
				)
				check()
			}),
		),
	)
}
