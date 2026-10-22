export {
	createInteractionWork,
	interactionWork,
	trackInteractions,
	yieldBackgroundWork,
}
export type { InteractionWork }

type InteractionWork = ReturnType<typeof createInteractionWork>
type PendingWork = { run: () => void; cancel: AbortController }

let interactionWork = createInteractionWork()
let trackingCount = 0
let stopTracking: (() => void) | undefined

function createInteractionWork() {
	let interacting = false
	let idleTimer: ReturnType<typeof setTimeout> | undefined
	let waiters = new Set<() => void>()
	let pending = new Map<unknown, PendingWork>()

	function interact() {
		interacting = true
		clearTimeout(idleTimer)
		idleTimer = setTimeout(release, 100)
	}

	function release() {
		interacting = false
		clearTimeout(idleTimer)
		idleTimer = undefined
		for (let resolve of waiters) resolve()
	}

	function waitForIdle(maximumWait = 500, signal?: AbortSignal): Promise<void> {
		if (!interacting || signal?.aborted) return Promise.resolve()
		return new Promise(resolve => {
			let timeout = setTimeout(finish, maximumWait)
			waiters.add(finish)
			signal?.addEventListener("abort", finish, { once: true })
			function finish() {
				clearTimeout(timeout)
				waiters.delete(finish)
				signal?.removeEventListener("abort", finish)
				resolve()
			}
		})
	}

	function schedule(key: unknown, run: () => void, maximumWait = 500) {
		let existing = pending.get(key)
		if (existing) {
			existing.run = run
			return
		}
		let task = { run, cancel: new AbortController() }
		pending.set(key, task)
		// Yield even when idle so optional work cannot run inside the edit/save.
		setTimeout(() => {
			void waitForIdle(maximumWait, task.cancel.signal).then(() => {
				if (pending.get(key) !== task) return
				pending.delete(key)
				task.run()
			})
		}, 0)
	}

	function cancel(key: unknown) {
		pending.get(key)?.cancel.abort()
		pending.delete(key)
	}

	return { interact, release, waitForIdle, schedule, cancel }
}

function trackInteractions() {
	if (trackingCount++ === 0) {
		let listeners = new AbortController()
		let options = { capture: true, passive: true, signal: listeners.signal }
		function interact() {
			if (document.visibilityState === "visible") interactionWork.interact()
		}
		for (let type of [
			"keydown",
			"beforeinput",
			"input",
			"pointerdown",
			"wheel",
			"scroll",
			"touchmove",
			"compositionstart",
			"compositionupdate",
			"selectionchange",
		])
			document.addEventListener(type, interact, options)
		document.addEventListener(
			"pointermove",
			event => {
				if (event.buttons) interact()
			},
			options,
		)
		document.addEventListener(
			"visibilitychange",
			() => {
				if (document.visibilityState !== "visible") interactionWork.release()
			},
			options,
		)
		window.addEventListener(
			"pagehide",
			() => interactionWork.release(),
			options,
		)
		stopTracking = () => listeners.abort()
	}
	let stopped = false
	return () => {
		if (stopped) return
		stopped = true
		if (--trackingCount === 0) {
			stopTracking?.()
			stopTracking = undefined
			interactionWork.release()
		}
	}
}

async function yieldBackgroundWork(maximumWait = 16) {
	await new Promise<void>(resolve => setTimeout(resolve, 0))
	await interactionWork.waitForIdle(maximumWait)
}
