import { ChangeSet, type Text } from "@codemirror/state"
import {
	interactionWork,
	type InteractionWork,
} from "@/app/lib/interaction-work"
import type {
	EditorStatistics,
	StatisticsRequest,
	StatisticsResponse,
	StatisticsReplacement,
} from "./editor-statistics-protocol"

export { createEditorStatistics }
export type { StatisticsWorker }

type StatisticsWorker = {
	postMessage(request: StatisticsRequest): void
	terminate(): void
	onmessage: ((event: MessageEvent<StatisticsResponse>) => void) | null
	onerror: ((event: ErrorEvent) => void) | null
	onmessageerror: ((event: MessageEvent) => void) | null
}

function createEditorStatistics(
	initial: Text,
	makeWorker: () => StatisticsWorker = createWorker,
	work: InteractionWork = interactionWork,
) {
	let content = initial
	let revision = 0
	let sentRevision = -1
	let inFlight: number | undefined
	let changes: ChangeSet | undefined
	let worker: StatisticsWorker | undefined
	let timeout: ReturnType<typeof setTimeout> | undefined
	let listeners = new Set<(stats: EditorStatistics | null) => void>()
	let snapshot: EditorStatistics | null = null
	let requestKey = {}
	let publishKey = {}
	let disposed = false
	let retryCount = 0
	let retryTimer: ReturnType<typeof setTimeout> | undefined

	function queue() {
		if (disposed || !listeners.size || inFlight !== undefined) return
		if (sentRevision === revision) return
		work.schedule(requestKey, send)
	}

	function send() {
		if (disposed || !listeners.size || inFlight !== undefined) return
		try {
			if (!worker) {
				worker = makeWorker()
				worker.onmessage = receive
				worker.onerror = event => {
					event.preventDefault()
					recoverWorker()
				}
				worker.onmessageerror = recoverWorker
			}
			let request: StatisticsRequest
			if (changes === undefined) {
				request = { type: "reset", revision, content: content.toString() }
			} else {
				let replacements: StatisticsReplacement[] = []
				changes.iterChanges((from, to, _from, _to, inserted) => {
					replacements.push({ from, to, inserted: inserted.toString() })
				})
				request = {
					type: "replace",
					revision,
					baseRevision: sentRevision,
					replacements,
				}
			}
			inFlight = revision
			sentRevision = revision
			changes = ChangeSet.empty(content.length)
			timeout = setTimeout(recoverWorker, 10_000)
			worker.postMessage(request)
		} catch {
			recoverWorker()
		}
	}

	function receive(event: MessageEvent<StatisticsResponse>) {
		let response = event.data
		if (disposed || response.revision !== inFlight) return
		clearTimeout(timeout)
		inFlight = undefined
		retryCount = 0
		if (response.type === "resync") {
			resetWorker()
			queue()
			return
		}
		if (response.revision === revision) {
			work.schedule(publishKey, () => {
				if (disposed || response.revision !== revision) return
				snapshot = response.stats
				for (let listener of listeners) listener(snapshot)
			})
		}
		queue()
	}

	function recoverWorker() {
		resetWorker()
		if (disposed || !listeners.size || retryCount >= 1) return
		retryCount++
		retryTimer = setTimeout(queue, 1_000)
	}

	function resetWorker() {
		clearTimeout(retryTimer)
		clearTimeout(timeout)
		work.cancel(requestKey)
		work.cancel(publishKey)
		if (worker) {
			worker.onmessage = null
			worker.onerror = null
			worker.onmessageerror = null
			worker.terminate()
		}
		worker = undefined
		inFlight = undefined
		sentRevision = -1
		changes = undefined
	}

	return {
		update(nextChanges: ChangeSet, nextContent: Text) {
			if (disposed) return
			content = nextContent
			revision++
			retryCount = 0
			clearTimeout(retryTimer)
			if (changes) changes = changes.compose(nextChanges)
			queue()
		},
		subscribe(listener: (stats: EditorStatistics | null) => void) {
			if (disposed) return () => {}
			listeners.add(listener)
			listener(snapshot)
			queue()
			return () => {
				listeners.delete(listener)
				if (!listeners.size) resetWorker()
			}
		},
		dispose() {
			disposed = true
			listeners.clear()
			resetWorker()
		},
	}
}

function createWorker(): StatisticsWorker {
	return new Worker(new URL("./editor-statistics.worker.ts", import.meta.url), {
		type: "module",
	})
}
