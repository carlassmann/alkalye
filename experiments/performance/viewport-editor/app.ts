import { ViewportEditor } from "./editor"
import { NativeFloorEditor } from "./native-floor"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as FiberSet from "effect/FiberSet"
import * as Layer from "effect/Layer"
import * as Queue from "effect/Queue"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import { BrowserAccount } from "../../../src/client/browser-account"
import { BrowserStorage, Storage } from "../../../src/client/storage"
import { createViewportSession } from "./session-client"
import { verifySessionWorker } from "./session-verify"
let params = new URLSearchParams(location.search)
let size = Number(params.get("size") ?? 131072)
let long = params.get("fixture") === "long"
let source = (
	long
		? "A long paragraph with **bold** and ==highlight==. "
		: "A document paragraph with **bold** and [a link](https://example.org).\n\n"
)
	.repeat(Math.ceil(size / 40))
	.slice(0, size)
let host = document.querySelector("main")
if (!(host instanceof HTMLElement)) throw Error("Missing host")
let caption = document.querySelector("p")
if (caption)
	caption.textContent = `${params.get("mode") ?? "bounded"} · ${size} characters · ${long ? "one wrapped paragraph" : "many paragraphs"}`
if (params.get("mode") === "session") {
	let running = Effect.runFork(
		Effect.scoped(openSession(host)).pipe(
			Effect.provide(FetchHttpClient.layer),
			Effect.catchCause(cause =>
				Effect.sync(() => showStatus("Failed: " + String(cause))),
			),
		),
	)
	window.addEventListener("pagehide", event => {
		if (event.persisted) return
		Effect.runFork(Fiber.interrupt(running))
	})
} else {
	let editor =
		params.get("mode") === "bare"
			? new NativeFloorEditor(host, source)
			: new ViewportEditor(host, source, params.get("mode") !== "full")
	Object.defineProperty(window, "viewportExperiment", { value: editor })
}

function showStatus(text: string) {
	let status = document.querySelector("output")
	if (status) status.textContent = text
}

function openSession(host: HTMLElement) {
	return Effect.gen(function* () {
		showStatus("Opening cached document…")
		let storage = yield* Effect.acquireRelease(Storage.open(), storage =>
			Effect.sync(() => storage.close()),
		)
		let context = yield* Layer.build(
			BrowserAccount.layer(location.origin).pipe(
				Layer.provide(Layer.succeed(BrowserStorage, storage)),
			),
		)
		let account = Context.get(context, BrowserAccount)
		if (navigator.onLine) yield* account.connect
		let client = yield* createViewportSession("/session-worker.js")
		let epoch = crypto.randomUUID()
		let documentId = params.get("document") ?? "viewport-" + size
		let recovered = yield* storage.get(
			"prototype-recovery-source:" + documentId,
		)
		let opened = yield* client.Open({
			document: documentId,
			subject: account.subject,
			epoch,
			source: typeof recovered === "string" ? recovered : source,
			origin: location.origin,
			create: params.get("create") !== "false",
		})
		let revision = opened.revision
		let workerSamples: number[] = []
		let syncing = false
		let sequence = 0,
			pending = 0,
			durable = 0,
			failure = ""
		let edits = yield* Queue.bounded<{
			start: number
			end: number
			insert: string
			sequence: number
		}>(64)
		yield* Effect.addFinalizer(() => Queue.shutdown(edits))
		let editor = new ViewportEditor(host, opened.content, true, {
			onEdit(edit) {
				pending++
				sequence++
				if (!Queue.offerUnsafe(edits, { ...edit, sequence }))
					failure = "Admission limit reached; draft retained in this tab"
				updateStatus()
			},
		})
		function updateStatus() {
			editor.element.readOnly = Boolean(failure) || syncing
			showStatus(
				failure ||
					(pending ? `${pending} edits awaiting durability` : "Saved locally"),
			)
		}
		function preventUnload(event: BeforeUnloadEvent) {
			if (!pending && !failure) return
			event.preventDefault()
			event.returnValue = ""
		}
		yield* Effect.acquireRelease(
			Effect.sync(() => window.addEventListener("beforeunload", preventUnload)),
			() =>
				Effect.sync(() =>
					window.removeEventListener("beforeunload", preventUnload),
				),
		)
		yield* Effect.gen(function* () {
			while (true) {
				let edit = yield* Queue.take(edits)
				if (failure) yield* Effect.never
				let result = yield* client
					.Replace({
						epoch,
						baseRevision: revision,
						sequence: edit.sequence,
						start: edit.start,
						remove: edit.end - edit.start,
						text: edit.insert,
					})
					.pipe(Effect.result)
				if (result._tag === "Failure") {
					failure = "Draft retained: " + String(result.failure)
				} else {
					workerSamples.push(result.success.milliseconds)
					if (workerSamples.length > 200) workerSamples.shift()
					revision = result.success.revision
					durable = edit.sequence
					pending--
				}
				updateStatus()
			}
		}).pipe(Effect.forkScoped)
		let syncButton = document.querySelector("#sync")
		if (!(syncButton instanceof HTMLButtonElement)) throw Error("Missing sync")
		let run = yield* FiberSet.makeRuntime()
		let runPromise = yield* FiberSet.makeRuntimePromise()
		function sync() {
			if (pending || syncing || failure || editor.isComposing) return
			syncing = true
			editor.element.readOnly = true
			let startingSequence = sequence
			showStatus("Syncing…")
			run(
				client.Sync({ epoch }).pipe(
					Effect.tap(state =>
						Effect.sync(() => {
							if (sequence !== startingSequence) {
								failure = "Typed during sync; draft retained for recovery"
								updateStatus()
								return
							}
							revision = state.revision
							editor.updateSource(state.content)
							showStatus("Synced")
						}),
					),
					Effect.catchCause(cause =>
						Effect.sync(() => {
							showStatus(
								"Sync unavailable; local draft retained: " + String(cause),
							)
						}),
					),
					Effect.ensuring(
						Effect.sync(() => {
							syncing = false
							editor.element.readOnly = Boolean(failure)
						}),
					),
				),
			)
		}
		yield* Effect.acquireRelease(
			Effect.sync(() => syncButton.addEventListener("click", sync)),
			() => Effect.sync(() => syncButton.removeEventListener("click", sync)),
		)
		let copy = document.querySelector("#copy-draft")
		if (!(copy instanceof HTMLButtonElement)) throw Error("Missing copy")
		function copyDraft() {
			void navigator.clipboard.writeText(editor.value).then(
				() => showStatus("Draft copied"),
				cause => showStatus("Could not copy draft: " + String(cause)),
			)
		}
		yield* Effect.acquireRelease(
			Effect.sync(() => copy.addEventListener("click", copyDraft)),
			() => Effect.sync(() => copy.removeEventListener("click", copyDraft)),
		)
		let recover = document.querySelector("#recover-draft")
		if (!(recover instanceof HTMLButtonElement)) throw Error("Missing recovery")
		function recoverDraft() {
			let document = "recovered-" + crypto.randomUUID()
			let content = editor.value
			run(
				storage.set("prototype-recovery-source:" + document, content).pipe(
					Effect.tap(() =>
						Effect.sync(() => {
							pending = 0
							failure = ""
							let url = new URL(location.href)
							url.searchParams.set("document", document)
							url.searchParams.set("create", "true")
							location.assign(url)
						}),
					),
					Effect.catchCause(cause =>
						Effect.sync(() =>
							showStatus("Could not preserve recovery copy: " + String(cause)),
						),
					),
				),
			)
		}
		yield* Effect.acquireRelease(
			Effect.sync(() => recover.addEventListener("click", recoverDraft)),
			() =>
				Effect.sync(() => recover.removeEventListener("click", recoverDraft)),
		)
		Object.defineProperty(window, "viewportExperiment", { value: editor })
		Object.defineProperty(window, "viewportSession", {
			value: {
				client,
				subject: account.subject,
				read: () => runPromise(client.Read({ epoch })),
				peerEdit: (start: number, remove: number, text: string) =>
					runPromise(
						Effect.scoped(
							Effect.gen(function* () {
								let peer = yield* createViewportSession("/session-worker.js")
								let peerEpoch = crypto.randomUUID()
								let state = yield* peer.Open({
									document: documentId,
									subject: account.subject,
									epoch: peerEpoch,
									source: "",
									origin: location.origin,
									create: false,
								})
								yield* peer.Replace({
									epoch: peerEpoch,
									baseRevision: state.revision,
									sequence: 1,
									start,
									remove,
									text,
								})
								return yield* peer.Read({ epoch: peerEpoch })
							}),
						),
					),
				workerSamples,
				epoch,
				get revision() {
					return revision
				},
				get pending() {
					return pending
				},
				get durable() {
					return durable
				},
				get failure() {
					return failure
				},
			},
		})
		Object.defineProperty(window, "verifyViewportWorker", {
			value: () =>
				runPromise(verifySessionWorker("/session-worker.js", account.subject)),
		})
		updateStatus()
		yield* Effect.never
	})
}
