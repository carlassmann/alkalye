import * as Effect from "effect/Effect"

export function watchUpdates(
	signal: AbortSignal,
	offer: (apply: () => void) => void,
	offlineReady?: () => void,
) {
	return Effect.tryPromise(() =>
		navigator.serviceWorker.register("/sw.js"),
	).pipe(
		Effect.tap(registration =>
			Effect.sync(() => {
				if (signal.aborted) return
				let offered = false
				let applying = false
				let controller = navigator.serviceWorker.controller
				let changed = false
				let development = process.env.NODE_ENV === "development"
				function apply() {
					if (signal.aborted || applying) return
					applying = true
					// Another tab may already have activated the offered worker.
					if (changed || !registration.waiting) location.reload()
					else registration.waiting.postMessage("activate")
				}
				function check() {
					if (signal.aborted || offered || !controller) return
					if (!changed && (development || !registration.waiting)) return
					offered = true
					offer(apply)
				}
				navigator.serviceWorker.addEventListener(
					"controllerchange",
					() => {
						if (!controller) {
							controller = navigator.serviceWorker.controller
							offlineReady?.()
							return
						}
						changed = true
						if (applying) location.reload()
						else check()
					},
					{ signal },
				)
				function watchInstalling() {
					registration.installing?.addEventListener("statechange", check, {
						signal,
					})
				}
				registration.addEventListener("updatefound", watchInstalling, {
					signal,
				})
				function refresh() {
					if (signal.aborted || !navigator.onLine) return
					// Failed offline checks leave the current worker and edits intact.
					void registration.update().catch(() => undefined)
					check()
				}
				window.addEventListener("focus", refresh, { signal })
				window.addEventListener("online", refresh, { signal })
				document.addEventListener(
					"visibilitychange",
					() => {
						if (document.visibilityState === "visible") refresh()
					},
					{ signal },
				)
				watchInstalling()
				check()
				refresh()
			}),
		),
	)
}
