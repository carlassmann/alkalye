import * as Cause from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as FiberHandle from "effect/FiberHandle"
import * as FiberSet from "effect/FiberSet"
import * as Schedule from "effect/Schedule"
import * as Semaphore from "effect/Semaphore"
import * as Stream from "effect/Stream"
import { createElement } from "react"
import { createRoot } from "react-dom/client"
import {
	DEFAULT_EMBED_DEFINITIONS,
	InstancePresenceRecordType,
	Tldraw,
	UserRecordType,
	iconTypes,
	parseTldrawJsonFile,
	serializeTldrawJson,
} from "tldraw"
import type {
	Editor,
	TLEventInfo,
	TLInstancePresence,
	TLUiAssetUrlOverrides,
	TLUiOverrides,
	TldrawOptions,
} from "tldraw"
import type { Replica } from "../../shared/crdt"
import type { Presence } from "../../shared/model"
import {
	darkPreviewField,
	maximumPreview,
	parseTldrawFile,
	previewField,
	previewKey,
	stampPreview,
	writeBatches,
} from "../../shared/whiteboard"
import { icon } from "../icons"
import type { Markup } from "../language"
import { html, locale, translate } from "../language"
import { editorPreview, previewFonts, textOptions } from "../whiteboard-preview"
import {
	createBoardStore,
	createBoardSync,
	restoreDraft,
} from "../whiteboard-store"
import type { BoardSync, Draft } from "../whiteboard-store"

export interface DrawingSession {
	readonly replica: Pick<Replica, "fields" | "text">
	readonly uuid: Effect.Effect<string, unknown>
	writable(): boolean
	write(
		board: string,
		values: [string, string][],
		embed?: boolean,
	): Effect.Effect<unknown, unknown>
	readonly changes: Stream.Stream<unknown>
	readonly presenceChanges: Stream.Stream<unknown>
	people(): readonly Presence[]
	announce(value: Presence): Effect.Effect<unknown, unknown>
	undo(): Effect.Effect<unknown, unknown>
	redo(): Effect.Effect<unknown, unknown>
}
interface WhiteboardOptions {
	actor: string
	name: string
	boardId: string
	session: DrawingSession
	report(error: unknown): void
	documentId: string
	dialog: HTMLDialogElement
	showDialog(title: string, body: string | Markup): void
}

let assetUrls = {
	fonts: Object.fromEntries(
		["draw", "sans", "serif", "mono"].flatMap(family =>
			["", "_italic", "_bold", "_italic_bold"].map(style => [
				"tldraw_" + family + style,
				family === "mono" ? previewFonts.tldraw_mono : previewFonts.tldraw_sans,
			]),
		),
	),
	icons: Object.fromEntries(
		iconTypes.map(name => [name, `/tldraw/icons/0_merged.svg#${name}`]),
	),
	translations: {
		en: "/tldraw/translations/en.json",
		de: "/tldraw/translations/de.json",
	},
	// Embeds are turned off, but tldraw still preloads their icons.
	embedIcons: Object.fromEntries(
		DEFAULT_EMBED_DEFINITIONS.map(embed => [
			embed.type,
			`/tldraw/embed-icons/${embed.type}.png`,
		]),
	),
} satisfies TLUiAssetUrlOverrides

let components = { MainMenu: null, PageMenu: null, SharePanel: null }

// Drawings hold vector shapes only: no pages beyond the first, and nothing that
// would embed media or reach the network.
let tldrawOptions: Partial<TldrawOptions> = {
	maxPages: 1,
	text: textOptions,
	onBeforePasteFromClipboard({ content }) {
		if (content.type === "files") return false
		if (content.type === "tldraw" && content.content.assets.length > 0)
			return false
	},
	experimental__onDropOnCanvas({ event }) {
		return event.dataTransfer.files.length > 0
	},
}

let flushDelay = 400
let heartbeat = 2000

// Edits a failed close could not write, by board, restored when the board
// opens again in this tab so a lost connection or permission does not lose
// them.
let drafts = new Map<string, Draft>()

export function openWhiteboard(
	options: Omit<WhiteboardOptions, "boardId"> & { boardId?: string },
) {
	let { session, documentId, showDialog } = options
	let id =
		options.boardId ||
		session.replica.fields(documentId).whiteboard ||
		Effect.runSync(session.uuid)
	showDialog(translate("Whiteboard"), whiteboardMarkup(session, documentId, id))
	let component = options.dialog.querySelector("alkalye-whiteboard")
	if (!(component instanceof WhiteboardElement))
		throw new Error("Whiteboard element is not registered")
	component.configure({ ...options, boardId: id })
}

function whiteboardMarkup(
	session: DrawingSession,
	documentId: string,
	id: string,
) {
	let embedded = session.replica.text(documentId).includes(`asset:${id}`)
	let embedLabel = translate(embedded ? "Done" : "Embed drawing")
	return html`<alkalye-whiteboard data-whiteboard>
		<div class="board-bar" role="toolbar" aria-label="Drawing">
			<button
				type="button"
				id="drawing-undo"
				aria-label="Undo"
				title="Undo (⌘Z)"
				data-writes
			>
				${icon("undo-2")}
			</button>
			<button
				type="button"
				id="drawing-redo"
				aria-label="Redo"
				title="Redo (⇧⌘Z)"
				data-writes
			>
				${icon("redo-2")}
			</button>
			<span class="board-people" data-drawing-people aria-live="polite"></span>
			<span class="read-only" data-read-only hidden>Read only</span>
			<span class="board-spacer"></span>
			<button
				type="button"
				id="export-drawing"
				title="Download editable drawing"
				aria-label="Download editable drawing"
			>
				${icon("download")}<span>.tldr</span>
			</button>
			<button
				type="button"
				id="export-svg"
				title="Download as SVG image"
				aria-label="Download as SVG image"
			>
				${icon("image")}<span>SVG</span>
			</button>
			<label class="board-import" title="Import drawing" data-writes>
				${icon("upload")}<span>Import drawing</span>
				<input
					id="import-drawing"
					type="file"
					accept=".tldr,application/json"
				/>
			</label>
			<button
				type="button"
				class="primary"
				id="embed-board"
				aria-label="${embedLabel}"
				data-writes
			>
				${icon(embedded ? "check" : "image-plus")}<span>${embedLabel}</span>
			</button>
		</div>
		<div class="board-canvas" data-board-canvas></div>
		<div class="board-error" data-board-error hidden>
			<p></p>
			<button type="button" id="retry-board">Try again</button>
		</div>
	</alkalye-whiteboard>`
}

export class WhiteboardElement extends HTMLElement {
	private options: WhiteboardOptions | undefined
	private lifetime: Fiber.Fiber<void, unknown> | undefined
	private current: Editor | undefined
	// The mounted tldraw editor, for the browser tests and for debugging.
	get editor() {
		return this.current
	}
	configure(options: WhiteboardOptions) {
		this.options = options
		if (this.isConnected) this.connectedCallback()
	}
	connectedCallback() {
		let options = this.options
		if (!options || this.lifetime) return
		let element = this
		this.lifetime = Effect.runFork(
			Effect.scoped(
				mountBoard(this, options, editor => {
					element.current = editor
				}),
			).pipe(
				Effect.catchCause(cause =>
					Effect.sync(() => {
						if (Cause.hasInterruptsOnly(cause)) return
						element.current = undefined
						element.lifetime = undefined
						showFailure(element, cause, () => element.connectedCallback())
					}),
				),
			),
		)
	}
	disconnectedCallback() {
		let lifetime = this.lifetime
		this.lifetime = undefined
		this.current = undefined
		if (lifetime) Effect.runFork(Fiber.interrupt(lifetime))
	}
	connectedMoveCallback() {}
}
customElements.define("alkalye-whiteboard", WhiteboardElement)

function mountBoard(
	root: HTMLElement,
	options: WhiteboardOptions,
	mounted: (editor: Editor | undefined) => void,
) {
	return Effect.gen(function* () {
		let { session, dialog, boardId } = options
		let canvas = part(root, "[data-board-canvas]")
		part(root, "[data-board-error]").hidden = true
		dialog.classList.add("wide")
		yield* Effect.addFinalizer(() =>
			Effect.sync(() => {
				let current = dialog.querySelector(
					"alkalye-whiteboard, alkalye-theme-workbench",
				)
				if (!current || current === root) dialog.classList.remove("wide")
			}),
		)
		yield* tldrawStyles
		let tasks = yield* FiberSet.make()
		let fork = yield* FiberSet.runtime(tasks)<never>()
		let store = createBoardStore()
		let sync = yield* Effect.acquireRelease(
			Effect.sync(() =>
				createBoardSync(
					store,
					() => session.replica.fields(boardId),
					options.report,
				),
			),
			sync => Effect.sync(sync.dispose),
		)
		let draft = drafts.get(boardId)
		// A refresh can arrive before tldraw delivers its next frame of edits.
		yield* Effect.acquireRelease(
			Effect.sync(() => {
				function protectDrawing(event: BeforeUnloadEvent) {
					if (!session.writable() || !sync.pending()) return
					event.preventDefault()
					event.returnValue = ""
				}
				window.addEventListener("beforeunload", protectDrawing)
				return protectDrawing
			}),
			protectDrawing =>
				Effect.sync(() =>
					window.removeEventListener("beforeunload", protectDrawing),
				),
		)
		drafts.delete(boardId)
		if (draft && session.writable() && !sync.newer()) restoreDraft(store, draft)
		let ready = yield* Deferred.make<Editor>()
		let dark = darkPage(root)
		yield* Effect.acquireRelease(
			Effect.sync(() => {
				let react = createRoot(canvas)
				react.render(
					createElement(Tldraw, {
						store,
						licenseKey: process.env.PUBLIC_TLDRAW_LICENSE_KEY,
						locale: locale(),
						colorScheme: dark ? "dark" : "light",
						assetUrls,
						components,
						options: tldrawOptions,
						overrides: overrides(
							() => history(false),
							() => history(true),
						),
						onMount: editor => {
							Deferred.doneUnsafe(ready, Effect.succeed(editor))
						},
					}),
				)
				return react
			}),
			react =>
				Effect.sync(() => {
					mounted(undefined)
					react.unmount()
				}),
		)
		let editor = yield* Deferred.await(ready)
		mounted(editor)
		editor.registerExternalAssetHandler("file", null)
		editor.registerExternalAssetHandler("url", null)
		editor.registerExternalContentHandler("files", null)
		editor.registerExternalContentHandler("file-replace", null)
		editor.registerExternalContentHandler("embed", null)
		editor.registerExternalContentHandler("url", null)
		let writer = yield* Semaphore.make(1)
		let flushes = yield* FiberHandle.make()
		let schedule = yield* FiberHandle.runtime(flushes)<never>()
		let flush = writer.withPermits(1)(
			Effect.uninterruptible(writePending(editor, sync, options)),
		)
		let flushSoon = (): Effect.Effect<void, unknown> =>
			Effect.sleep(flushDelay).pipe(
				Effect.andThen(
					Effect.suspend(() =>
						editor.inputs.getIsPointing() ? flushSoon() : flush,
					),
				),
			)
		yield* Effect.acquireRelease(
			Effect.sync(() =>
				store.listen(
					() => schedule(flushSoon().pipe(Effect.catchCause(reportCause))),
					{
						source: "user",
						scope: "document",
					},
				),
			),
			stop => Effect.sync(stop),
		)
		// Closing the board writes whatever is still pending before tldraw is
		// unmounted, since the preview is rendered by the live editor. What
		// cannot be written is kept for the next time the board opens.
		yield* Effect.addFinalizer(() =>
			FiberHandle.clear(flushes).pipe(
				Effect.andThen(drain(flush, sync)),
				Effect.catchCause(cause =>
					Effect.sync(() => options.report(causeError(cause))),
				),
				Effect.andThen(
					Effect.sync(() => {
						let unsaved = sync.unsaved()
						if (
							(unsaved.records.length || unsaved.removed.length) &&
							session.writable() &&
							!sync.newer()
						) {
							drafts.set(boardId, unsaved)
							options.report(
								new Error(
									"The drawing could not be saved; its changes return when you open it again",
								),
							)
						}
					}),
				),
			),
		)
		let presence = yield* boardPresence(editor, options, fork)
		let appearance = new MutationObserver(() =>
			editor.setColorMode(darkPage(root) ? "dark" : "light"),
		)
		appearance.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["data-appearance"],
		})
		let scheme = matchMedia("(prefers-color-scheme: dark)")
		let schemeChanged = () =>
			editor.setColorMode(darkPage(root) ? "dark" : "light")
		scheme.addEventListener("change", schemeChanged)
		yield* Effect.addFinalizer(() =>
			Effect.sync(() => {
				appearance.disconnect()
				scheme.removeEventListener("change", schemeChanged)
			}),
		)
		let controls = boardControls(root, editor, options, {
			flush,
			fork,
			history,
		})
		yield* Effect.addFinalizer(() => Effect.sync(controls.dispose))
		refresh()
		editor.zoomToFit()
		if (draft) schedule(flushSoon().pipe(Effect.catchCause(reportCause)))
		yield* Stream.merge(session.changes, session.presenceChanges).pipe(
			Stream.runForEach(() => Effect.sync(refresh)),
			Effect.forkScoped({ startImmediately: true }),
		)
		yield* Stream.fromEventListener(dialog, "close").pipe(
			Stream.filter(() => !dialog.open),
			Stream.take(1),
			Stream.runDrain,
		)

		function refresh() {
			sync.pull()
			let writable = session.writable() && !sync.newer()
			if (editor.getIsReadonly() === writable) {
				if (!writable) sync.discard()
				editor.updateInstanceState({ isReadonly: !writable })
			}
			presence.paint()
			controls.paint(writable)
		}
		function reportCause(cause: Cause.Cause<unknown>) {
			return Effect.sync(() => options.report(causeError(cause)))
		}
		function history(redo: boolean) {
			fork(
				flush.pipe(
					Effect.andThen(
						Effect.suspend(() =>
							session.writable()
								? redo
									? session.redo()
									: session.undo()
								: Effect.void,
						),
					),
					Effect.catchCause(cause =>
						Effect.sync(() => options.report(causeError(cause))),
					),
				),
			)
		}
	})
}

// Writes the records changed since the last write, then fresh previews, in
// as few actions as the server accepts. A failed write keeps its records for
// the next attempt.
function writePending(
	editor: Editor,
	sync: BoardSync,
	options: WhiteboardOptions,
) {
	return Effect.gen(function* () {
		let { session, boardId } = options
		if (!session.writable()) return
		let current = session.replica.fields(boardId)
		let values = sync.take()
		if (!values.length) return
		let key = previewKey({ ...current, ...Object.fromEntries(values) })
		for (let dark of [false, true]) {
			let field = dark ? darkPreviewField : previewField
			let preview = yield* Effect.tryPromise(() =>
				editorPreview(editor, dark),
			).pipe(Effect.orElseSucceed(() => ""))
			let stamped = stampPreview(preview, key)
			values.push([
				field,
				preview && stamped.length <= maximumPreview ? stamped : "",
			])
		}
		let written: [string, string][] = []
		yield* Effect.forEach(
			writeBatches(values, current),
			batch =>
				session
					.write(boardId, batch)
					.pipe(Effect.tap(() => Effect.sync(() => written.push(...batch)))),
			{ discard: true },
		).pipe(
			Effect.onExit(() =>
				Effect.sync(() => {
					sync.settle(written)
					sync.restore(values.filter(value => !written.includes(value)))
				}),
			),
		)
	})
}

function drain(flush: Effect.Effect<void, unknown>, sync: BoardSync) {
	return Effect.gen(function* () {
		for (let attempt = 0; attempt < 3 && sync.pending(); attempt++) yield* flush
	})
}

function overrides(undo: () => void, redo: () => void): TLUiOverrides {
	return {
		tools(_editor, tools) {
			let drawing = { ...tools }
			delete drawing.asset
			delete drawing.embed
			return drawing
		},
		// Undo and redo travel through the document's history, so a drawing
		// step undoes like any other change and stays undone for collaborators.
		actions(_editor, actions) {
			let drawing = { ...actions }
			delete drawing["insert-media"]
			delete drawing["insert-embed"]
			delete drawing["toggle-dark-mode"]
			let previous = drawing.undo,
				next = drawing.redo
			if (previous) drawing.undo = { ...previous, onSelect: undo }
			if (next) drawing.redo = { ...next, onSelect: redo }
			return drawing
		},
	}
}

function boardControls(
	root: HTMLElement,
	editor: Editor,
	options: WhiteboardOptions,
	actions: {
		flush: Effect.Effect<void, unknown>
		fork: (effect: Effect.Effect<void>) => unknown
		history(redo: boolean): void
	},
) {
	let { session, boardId, documentId, dialog, report } = options
	let events = new AbortController()
	let signal = events.signal
	let input = part(root, "#import-drawing")
	function run(task: Effect.Effect<unknown, unknown>) {
		actions.fork(
			task.pipe(
				Effect.asVoid,
				Effect.catchCause(cause =>
					Effect.sync(() => report(causeError(cause))),
				),
			),
		)
	}
	part(root, "#drawing-undo").addEventListener(
		"click",
		() => actions.history(false),
		{ signal },
	)
	part(root, "#drawing-redo").addEventListener(
		"click",
		() => actions.history(true),
		{ signal },
	)
	part(root, "#export-drawing").addEventListener(
		"click",
		() =>
			run(
				Effect.tryPromise(() => serializeTldrawJson(editor)).pipe(
					Effect.map(json =>
						download(new Blob([json], { type: "application/json" }), ".tldr"),
					),
				),
			),
		{ signal },
	)
	part(root, "#export-svg").addEventListener(
		"click",
		() =>
			run(
				Effect.tryPromise(() =>
					editor.getSvgString([...editor.getCurrentPageShapeIds()], {
						background: true,
						padding: 16,
					}),
				).pipe(
					Effect.map(result => {
						if (!result) throw new Error("Draw something before exporting")
						download(new Blob([result.svg], { type: "image/svg+xml" }), ".svg")
					}),
				),
			),
		{ signal },
	)
	input.addEventListener(
		"change",
		() => {
			if (!(input instanceof HTMLInputElement)) return
			let file = input.files?.[0]
			input.value = ""
			if (file) run(importFile(file))
		},
		{ signal },
	)
	part(root, "#embed-board").addEventListener(
		"click",
		() => {
			if (session.replica.text(documentId).includes(`asset:${boardId}`)) {
				dialog.close()
				return
			}
			run(
				actions.flush.pipe(
					Effect.andThen(
						session.write(boardId, [["name", translate("Whiteboard")]], true),
					),
					Effect.andThen(Effect.sync(() => dialog.close())),
				),
			)
		},
		{ signal },
	)
	// Escape first leaves text editing, clears the selection or returns to the
	// select tool; only an idle board lets it close the dialog.
	root.addEventListener(
		"keydown",
		event => {
			if (event.key !== "Escape") return
			if (
				editor.getEditingShapeId() ||
				editor.getSelectedShapeIds().length ||
				editor.getCurrentToolId() !== "select" ||
				editor.menus.getOpenMenus().length
			)
				event.preventDefault()
		},
		{ signal, capture: true },
	)
	return {
		paint(writable: boolean) {
			for (let control of root.querySelectorAll<HTMLElement>("[data-writes]")) {
				control.toggleAttribute("disabled", !writable)
				control.toggleAttribute("aria-disabled", !writable)
			}
			part(root, "[data-read-only]").hidden = writable
			if (input instanceof HTMLInputElement) input.disabled = !writable
		},
		dispose: () => events.abort(),
	}

	// The file is checked as a whole first, then tldraw migrates and
	// validates every record before any of it reaches the board.
	function importFile(file: File) {
		return Effect.gen(function* () {
			if (!session.writable()) throw new Error("This document is read-only")
			let text = yield* Effect.tryPromise(() => file.text())
			let value: unknown = JSON.parse(text)
			parseTldrawFile(value)
			let parsed = parseTldrawJsonFile({
				json: text,
				schema: editor.store.schema,
			})
			if (!parsed.ok) throw new Error("This drawing could not be read")
			let imported = parsed.value
			try {
				let pages = new Set<string>(
					imported.query
						.records("page")
						.get()
						.map(page => page.id),
				)
				let shapes = imported.query.records("shape").get()
				editor.putContentOntoCurrentPage(
					{
						schema: imported.schema.serialize(),
						assets: [],
						rootShapeIds: shapes
							.filter(shape => pages.has(shape.parentId))
							.map(shape => shape.id),
						shapes,
						bindings: imported.query.records("binding").get(),
					},
					{ select: true },
				)
			} finally {
				imported.dispose()
			}
			editor.zoomToSelection()
			yield* actions.flush
		})
	}
	function download(blob: Blob, extension: string) {
		let url = URL.createObjectURL(blob)
		let link = document.createElement("a")
		link.href = url
		link.download =
			(session.replica.fields(boardId).name || translate("Whiteboard")) +
			extension
		link.click()
		setTimeout(() => URL.revokeObjectURL(url), 1000)
	}
}

// Peers on this board appear as tldraw collaborators: their cursors are
// presence records merged as remote changes, so they are never written to
// the document.
function boardPresence(
	editor: Editor,
	options: WhiteboardOptions,
	fork: (effect: Effect.Effect<void>) => unknown,
) {
	let { session, actor, name, boardId, documentId } = options
	let pointer: { x: number; y: number } | undefined
	let last = 0
	let onEvent = (info: TLEventInfo) => {
		if (info.type !== "pointer" || info.name !== "pointer_move") return
		let point = editor.inputs.getCurrentPagePoint()
		pointer = { x: point.x, y: point.y }
		if (performance.now() - last > 60) announce(true)
	}
	editor.on("event", onEvent)
	let container = editor.getContainer()
	let leave = () => {
		pointer = undefined
		announce(true)
	}
	container.addEventListener("pointerleave", leave)
	return Effect.gen(function* () {
		// Last on close, so the final announcement says the board is closed.
		yield* Effect.addFinalizer(() =>
			Effect.sync(() => {
				editor.off("event", onEvent)
				container.removeEventListener("pointerleave", leave)
				pointer = undefined
			}).pipe(
				Effect.andThen(session.announce(presenceOf(false))),
				Effect.ignore,
			),
		)
		yield* Effect.sync(() => {
			announce(true)
			paint()
		}).pipe(
			Effect.repeat(Schedule.spaced(heartbeat)),
			Effect.forkScoped({ startImmediately: true }),
		)
		return { paint }
	})

	function presenceOf(open: boolean): Presence {
		return {
			actor,
			name,
			document: documentId,
			board: boardId,
			boardOpen: open,
			drawingActive: open && Boolean(pointer),
			cursor: 0,
			slide: 0,
			x: pointer?.x ?? 0,
			y: pointer?.y ?? 0,
			time: Date.now(),
		}
	}
	function announce(open: boolean) {
		last = performance.now()
		fork(session.announce(presenceOf(open)).pipe(Effect.ignore))
	}
	function paint() {
		let now = Date.now()
		let peers = session
			.people()
			.filter(
				person =>
					person.actor !== actor &&
					person.board === boardId &&
					person.boardOpen &&
					now - person.time < 10_000,
			)
		let status = editor
			.getContainer()
			.closest("alkalye-whiteboard")
			?.querySelector("[data-drawing-people]")
		if (status)
			status.textContent = peers.length
				? `${peers.length} ${peers.length === 1 ? "other" : "others"} on this whiteboard`
				: ""
		let page = editor.getCurrentPageId()
		let records: TLInstancePresence[] = peers.map(person =>
			InstancePresenceRecordType.create({
				id: InstancePresenceRecordType.createId(person.actor),
				userId: UserRecordType.createId(person.actor),
				userName: person.name.slice(0, 40),
				currentPageId: page,
				color: peerColor(person.actor),
				lastActivityTimestamp: person.time,
				cursor: person.drawingActive
					? { x: person.x, y: person.y, type: "default", rotation: 0 }
					: null,
			}),
		)
		let keep = new Set(records.map(record => record.id))
		let stale = editor.store.query
			.records("instance_presence")
			.get()
			.filter(record => !keep.has(record.id))
			.map(record => record.id)
		editor.store.mergeRemoteChanges(() => {
			if (stale.length) editor.store.remove(stale)
			if (records.length) editor.store.put(records)
		})
	}
}

let peerColors = [
	"#e03131",
	"#4465e9",
	"#099268",
	"#f76707",
	"#ae3ec9",
	"#1098ad",
]

function peerColor(actor: string) {
	let hash = 0
	for (let character of actor) hash = (hash * 31 + character.charCodeAt(0)) | 0
	return peerColors[Math.abs(hash) % peerColors.length] ?? "#4465e9"
}

// tldraw's stylesheet is loaded the first time a board opens, from the copy
// the app serves and caches for offline use.
let tldrawStyles = Effect.callback<void, Error>(resume => {
	let existing = document.querySelector<HTMLLinkElement>("link[data-tldraw]")
	if (existing?.sheet) return resume(Effect.void)
	let link = existing ?? document.createElement("link")
	let loaded = () => resume(Effect.void)
	let failed = () => {
		link.remove()
		resume(Effect.fail(new Error("The drawing editor could not load")))
	}
	link.addEventListener("load", loaded, { once: true })
	link.addEventListener("error", failed, { once: true })
	if (!existing) {
		link.rel = "stylesheet"
		link.href = "/tldraw/tldraw.css"
		link.dataset.tldraw = ""
		document.head.append(link)
	}
	return Effect.sync(() => {
		link.removeEventListener("load", loaded)
		link.removeEventListener("error", failed)
	})
})

function darkPage(root: HTMLElement) {
	return getComputedStyle(root).colorScheme.includes("dark")
}

function part(root: HTMLElement, selector: string) {
	let element = root.querySelector(selector)
	if (!(element instanceof HTMLElement))
		throw new Error("Drawing control missing: " + selector)
	return element
}

function showFailure(root: HTMLElement, cause: unknown, retry: () => void) {
	let panel = root.querySelector<HTMLElement>("[data-board-error]")
	if (!panel) return
	panel.hidden = false
	let message = panel.querySelector("p")
	if (message) message.textContent = causeError(cause).message
	let button = panel.querySelector<HTMLButtonElement>("#retry-board")
	if (button) button.onclick = retry
}

function causeError(cause: unknown) {
	let error = Cause.isCause(cause) ? Cause.squash(cause) : cause
	return error instanceof Error ? error : new Error(String(error))
}
