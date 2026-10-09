import * as Effect from "effect/Effect"

export interface InstallPromptEvent extends Event {
	prompt(): Promise<void>
	readonly userChoice: Promise<{ readonly outcome: "accepted" | "dismissed" }>
}

declare global {
	interface WindowEventMap {
		beforeinstallprompt: InstallPromptEvent
	}
}

export interface Installation {
	readonly installed: () => boolean
	readonly available: () => boolean
	readonly hint: () => boolean
	readonly subscribe: (listener: () => void) => () => void
	readonly dismissHint: () => void
	readonly prompt: () => Promise<"accepted" | "dismissed" | "unavailable">
}

export function isInstalled() {
	return (
		matchMedia("(display-mode: standalone)").matches ||
		("standalone" in navigator && navigator.standalone === true)
	)
}

export function isIOS() {
	return (
		/iPhone|iPad|iPod/i.test(navigator.userAgent) ||
		(/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
	)
}

export function isMobile() {
	return (
		isIOS() ||
		/Android|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
		matchMedia("(pointer: coarse)").matches
	)
}

// Browsers may offer installation while asynchronous application layers open.
let earlyPrompt: InstallPromptEvent | undefined
let earlyInstalled = false
function captureEarlyPrompt(event: InstallPromptEvent) {
	event.preventDefault()
	earlyPrompt = event
}
function captureEarlyInstalled() {
	earlyInstalled = true
	earlyPrompt = undefined
}
if (typeof window !== "undefined") {
	window.addEventListener("beforeinstallprompt", captureEarlyPrompt)
	window.addEventListener("appinstalled", captureEarlyInstalled)
}

export let makeInstallation = Effect.acquireRelease(
	Effect.sync(() => {
		let events = new AbortController()
		let media = matchMedia("(display-mode: standalone)")
		window.removeEventListener("beforeinstallprompt", captureEarlyPrompt)
		window.removeEventListener("appinstalled", captureEarlyInstalled)
		let installed = earlyInstalled || isInstalled()
		let prompt = installed ? undefined : earlyPrompt
		earlyPrompt = undefined
		earlyInstalled = false
		let listeners = new Set<() => void>()
		let dismissed = false
		let ready = false
		try {
			dismissed = localStorage.getItem("pwa-install-hint-dismissed") === "true"
		} catch {}
		function notify() {
			for (let listener of listeners) listener()
		}
		function refresh() {
			installed = isInstalled()
			if (installed) prompt = undefined
			notify()
		}
		window.addEventListener(
			"beforeinstallprompt",
			event => {
				event.preventDefault()
				if (!installed) prompt = event
				notify()
			},
			{ signal: events.signal },
		)
		window.addEventListener(
			"appinstalled",
			() => {
				installed = true
				prompt = undefined
				notify()
			},
			{ signal: events.signal },
		)
		media.addEventListener("change", refresh, { signal: events.signal })
		let timer = setTimeout(() => {
			ready = true
			notify()
		}, 2000)
		let installation: Installation = {
			installed: () => installed,
			available: () => !installed && prompt !== undefined,
			hint: () =>
				!events.signal.aborted &&
				ready &&
				isMobile() &&
				!installed &&
				!dismissed,
			subscribe(listener) {
				listeners.add(listener)
				listener()
				return () => {
					listeners.delete(listener)
				}
			},
			dismissHint() {
				dismissed = true
				try {
					localStorage.setItem("pwa-install-hint-dismissed", "true")
				} catch {}
				notify()
			},
			async prompt() {
				let captured = prompt
				if (!captured || installed || events.signal.aborted)
					return "unavailable"
				prompt = undefined
				// Invoke before notifying listeners so the trusted click retains activation.
				try {
					let requested = captured.prompt()
					notify()
					await requested
				} catch (error) {
					notify()
					throw error
				}
				return (await captured.userChoice).outcome
			},
		}
		return {
			installation,
			close() {
				events.abort()
				clearTimeout(timer)
				prompt = undefined
				listeners.clear()
			},
		}
	}),
	owner => Effect.sync(() => owner.close()),
).pipe(Effect.map(owner => owner.installation))
