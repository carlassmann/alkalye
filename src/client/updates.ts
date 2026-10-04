import * as Effect from "effect/Effect"

// A new build installs in the background and waits. The person chooses when
// to switch, so an update never reloads the page while they are typing.
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
				function check() {
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
