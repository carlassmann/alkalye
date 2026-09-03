import {
	experimental_JazzMessageChannel,
	isControlledAccount,
	type Account,
} from "jazz-tools"
import type {
	MessagePortLike,
	PostMessageTarget,
} from "cojson/src/CojsonMessageChannel/types.js"
import type {
	DocumentSaveWorkerRequest,
	DocumentSaveWorkerResponse,
} from "./document-save-protocol"

export { createBackgroundDocumentSave, type BackgroundDocumentSave }

type BackgroundDocumentSave = {
	save(content: string): Promise<void>
	close(): void
}

function createBackgroundDocumentSave(
	documentId: string,
	account: Account,
): BackgroundDocumentSave {
	if (!isControlledAccount(account)) {
		throw new Error("Background saving requires a controlled account")
	}

	let worker = new Worker(
		new URL("./document-save.worker.ts", import.meta.url),
		{
			type: "module",
		},
	)
	let ready = deferred<void>()
	let requests = new Map<number, ReturnType<typeof deferred<void>>>()
	let nextRequestId = 1
	let closed = false

	worker.addEventListener(
		"message",
		(event: MessageEvent<DocumentSaveWorkerResponse>) => {
			let response = event.data
			if (response.type === "ready") {
				ready.resolve()
				return
			}
			if (response.type === "saved") {
				requests.get(response.requestId)?.resolve()
				requests.delete(response.requestId)
				return
			}
			if (response.type === "failed") {
				let error = new Error(response.message)
				if (response.requestId === undefined) {
					ready.reject(error)
					return
				}
				requests.get(response.requestId)?.reject(error)
				requests.delete(response.requestId)
				return
			}
			worker.terminate()
		},
	)

	let initialize: DocumentSaveWorkerRequest = {
		type: "initialize",
		accountId: account.$jazz.id,
		accountSecret: account.$jazz.localNode.getCurrentAgent().agentSecret,
		documentId,
	}
	worker.postMessage(initialize)
	let target = new WorkerMessageTarget(worker)
	void experimental_JazzMessageChannel
		.expose(target, {
			loadAs: account,
		})
		.catch(ready.reject)

	return {
		async save(content) {
			if (closed) throw new Error("Background save is closed")
			await ready.promise
			let requestId = nextRequestId++
			let result = deferred<void>()
			requests.set(requestId, result)
			let request: DocumentSaveWorkerRequest = {
				type: "save",
				requestId,
				content,
			}
			worker.postMessage(request)
			return result.promise
		},
		close() {
			if (closed) return
			closed = true
			worker.postMessage({ type: "close" } satisfies DocumentSaveWorkerRequest)
		},
	}
}

class WorkerMessageTarget implements PostMessageTarget {
	private worker: Worker

	constructor(worker: Worker) {
		this.worker = worker
	}

	postMessage(message: unknown, transfer?: MessagePortLike[]): void
	postMessage(
		message: unknown,
		targetOrigin: string,
		transfer?: MessagePortLike[],
	): void
	postMessage(
		message: unknown,
		transferOrTargetOrigin?: MessagePortLike[] | string,
		transfer?: MessagePortLike[],
	) {
		let ports =
			typeof transferOrTargetOrigin === "string"
				? transfer
				: transferOrTargetOrigin
		let nativePorts: MessagePort[] = []
		for (let port of ports ?? []) {
			if (!(port instanceof MessagePort)) {
				throw new Error("Jazz supplied a non-browser message port")
			}
			nativePorts.push(port)
		}
		this.worker.postMessage(message, nativePorts)
	}
}

function deferred<T>() {
	let resolvePromise: (value: T | PromiseLike<T>) => void = () => {}
	let rejectPromise: (reason?: unknown) => void = () => {}
	let promise = new Promise<T>((resolve, reject) => {
		resolvePromise = resolve
		rejectPromise = reject
	})
	return { promise, resolve: resolvePromise, reject: rejectPromise }
}
