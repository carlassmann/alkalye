import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as FiberSet from "effect/FiberSet"
import * as Stream from "effect/Stream"
import { menuNavigation } from "../ui/menu"
import type { Replica } from "../../shared/crdt"
import type { Presence } from "../../shared/model"
import type { Camera, Viewport } from "../drawing-camera"
import {
	cameraViewBox,
	fitBounds,
	nextZoomStop,
	panBy,
	screenToWorld,
	worldToScreen,
	zoomAt,
} from "../drawing-camera"
import { drawingFont, drawingPreview, shapeElement, svg } from "../drawing-svg"
import type { Markup } from "../language"
import { html, joinMarkup, rawMarkup, translate } from "../language"
import { drawingPresence } from "./drawing-presence"
import type { DrawingIcon } from "./whiteboard-icons"
import { drawingIcon } from "./whiteboard-icons"

import type {
	Bounds,
	DrawingTool,
	Point,
	ResizeHandle,
	Shape,
	ShapeDash,
} from "../../shared/drawing"
import {
	boundsContain,
	boundsFromCorners,
	canFill,
	drawingOrder,
	drawingShapes,
	orderBelow,
	resizeBounds,
	scaleShape,
	shapeBounds,
	shapesInBounds,
	textLineHeight,
	textSize,
	tintColor,
	translateShape,
	unionBounds,
} from "../../shared/drawing"
import { importDrawing } from "../../shared/drawing-import"

export interface DrawingSession {
	readonly replica: Pick<Replica, "fields" | "text" | "clock" | "actor">
	readonly uuid: Effect.Effect<string, unknown>
	writable(): boolean
	version(): number
	write(
		board: string,
		values: [string, string][],
		embed?: boolean,
	): Effect.Effect<unknown, unknown>
	readonly changes: Stream.Stream<unknown>
	readonly presenceChanges: Stream.Stream<unknown>
	people(): readonly Presence[]
	announce(value: Presence): Effect.Effect<unknown, unknown>
	undo?(): Effect.Effect<unknown, unknown>
	redo?(): Effect.Effect<unknown, unknown>
}
interface WhiteboardOptions {
	actor: string
	name: string
	boardId?: string
	session: DrawingSession
	report(error: unknown): void
	documentId: string
	dialog: HTMLDialogElement
	showDialog(title: string, body: string | Markup): void
}
interface Change {
	key: string
	before: string
	after: string
}
type FillMode = "none" | "tint" | "solid"
type DashMode = "solid" | ShapeDash
interface DrawingStyle {
	color: string
	width: number
	fill: FillMode
	dash: DashMode
}
interface ToolChoice {
	tool: DrawingTool
	label: string
	key: string
}
// Shapes keyed by register; `undefined` marks a shape that is being removed.
type ShapeOverlay = Map<string, Shape | undefined>
type Gesture =
	| { kind: "draw"; pointerId: number; key: string; shape: Shape; from: Point }
	| {
			kind: "move"
			pointerId: number
			from: Point
			originals: Map<string, Shape>
	  }
	| {
			kind: "resize"
			pointerId: number
			handle: ResizeHandle
			from: Point
			bounds: Bounds
			originals: Map<string, Shape>
	  }
	| {
			kind: "marquee"
			pointerId: number
			from: Point
			to: Point
			base: Set<string>
	  }
	| { kind: "erase"; pointerId: number; erased: Set<string> }
	| { kind: "pan"; pointerId: number; last: Point }
	| { kind: "pinch"; distance: number; center: Point; camera: Camera }
interface TextEditing {
	key: string
	shape: Shape
	created: boolean
}

let toolChoices: ToolChoice[] = [
	{ tool: "select", label: "Select", key: "v" },
	{ tool: "pan", label: "Hand", key: "h" },
	{ tool: "pen", label: "Draw", key: "d" },
	{ tool: "eraser", label: "Eraser", key: "e" },
	{ tool: "arrow", label: "Arrow", key: "a" },
	{ tool: "line", label: "Line", key: "l" },
	{ tool: "rectangle", label: "Rectangle", key: "r" },
	{ tool: "ellipse", label: "Ellipse", key: "o" },
	{ tool: "text", label: "Text", key: "t" },
]
let swatches = [
	["#1d1d1d", "Black"],
	["#9fa8b2", "Grey"],
	["#e03131", "Red"],
	["#f76707", "Orange"],
	["#f1ac4b", "Yellow"],
	["#099268", "Green"],
	["#4465e9", "Blue"],
	["#4ba1f1", "Light blue"],
	["#ae3ec9", "Violet"],
]
let sizes: [number, string, string][] = [
	[2, "S", "Small"],
	[4, "M", "Medium"],
	[8, "L", "Large"],
	[12, "XL", "Extra large"],
]
let fills: [FillMode, string][] = [
	["none", "No fill"],
	["tint", "Tinted fill"],
	["solid", "Solid fill"],
]
let dashes: [DashMode, string][] = [
	["solid", "Solid"],
	["dashed", "Dashed"],
	["dotted", "Dotted"],
]
let creationTools: DrawingTool[] = [
	"pen",
	"rectangle",
	"ellipse",
	"line",
	"arrow",
	"text",
]
let handles: ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"]

export function openWhiteboard(options: WhiteboardOptions) {
	let { session, documentId, dialog, showDialog } = options
	let id =
		options.boardId ||
		session.replica.fields(documentId).whiteboard ||
		Effect.runSync(session.uuid)
	showDialog(translate("Whiteboard"), whiteboardMarkup())
	let component = dialog.querySelector("alkalye-whiteboard")
	if (!(component instanceof WhiteboardElement))
		throw new Error("Whiteboard element is not registered")
	component.configure({ ...options, boardId: id })
}

function whiteboardMarkup() {
	return html`<alkalye-whiteboard data-whiteboard>
		<div class="whiteboard-stage">
			<svg id="whiteboard" aria-label="Drawing canvas" tabindex="0"></svg>
			<textarea
				id="drawing-text"
				class="text-editor"
				aria-label="Text"
				maxlength="2000"
				rows="1"
				hidden
			></textarea>
			<p class="empty-hint" data-empty-hint hidden>
				Pick a tool below to start drawing
			</p>
			<div class="panel board-menu">
				<details id="drawing-menu">
					<summary aria-label="Drawing menu" title="Menu">
						${drawingIcon("menu")}
					</summary>
					<div class="menu-items" role="menu">
						${menuItem("export-drawing", "download", "Download editable drawing")}
						${menuItem("export-svg", "image", "Download as SVG image")}
						<label role="menuitem" class="file-item" data-writes>
							${drawingIcon("upload")}<span>Import drawing…</span>
							<input id="import-drawing" type="file" accept=".tldr,.json" />
						</label>
						<hr />
						${menuItem("select-all", "select-all", "Select all")}
						${menuItem("zoom-fit", "fit", "Zoom to fit")}
						<hr />
						${menuItem("clear-board", "clear", "Clear board")}
					</div>
				</details>
				<button
					type="button"
					id="drawing-undo"
					aria-label="Undo"
					title="Undo (⌘Z)"
					data-writes
				>
					${drawingIcon("undo")}
				</button>
				<button
					type="button"
					id="drawing-redo"
					aria-label="Redo"
					title="Redo (⇧⌘Z)"
					data-writes
				>
					${drawingIcon("redo")}
				</button>
			</div>
			<div class="board-status">
				<span data-drawing-people aria-live="polite"></span>
				<span class="read-only" data-read-only hidden>Read only</span>
				<button type="button" class="primary" id="embed-board" data-writes>
					${drawingIcon("embed")}<span>Embed drawing</span>
				</button>
			</div>
			${stylePanelMarkup()}
			<div class="panel tool-palette" role="toolbar" aria-label="Drawing tools">
				${joinMarkup(toolChoices.map(toolButton), "")}
			</div>
			<div class="panel zoom-controls" role="group" aria-label="Zoom">
				<button
					type="button"
					id="zoom-board-out"
					aria-label="Zoom out"
					title="Zoom out (−)"
				>
					${drawingIcon("minus")}
				</button>
				<button
					type="button"
					id="reset-board"
					aria-label="Reset zoom"
					title="Reset zoom (⇧0)"
				>
					100%
				</button>
				<button
					type="button"
					id="zoom-board-in"
					aria-label="Zoom in"
					title="Zoom in (+)"
				>
					${drawingIcon("plus")}
				</button>
			</div>
		</div>
	</alkalye-whiteboard>`
}

function menuItem(id: string, icon: DrawingIcon, label: string) {
	return html`<button type="button" role="menuitem" id="${id}">
		${drawingIcon(icon)}<span>${translate(label)}</span>
	</button>`
}

function toolButton(choice: ToolChoice) {
	let label = translate(choice.label)
	return html`<button
		type="button"
		data-tool="${choice.tool}"
		aria-label="${label}"
		title="${label} (${choice.key.toUpperCase()})"
		aria-pressed="${choice.tool === "select"}"
	>
		${drawingIcon(choice.tool === "pan" ? "pan" : choice.tool)}
	</button>`
}

function stylePanelMarkup() {
	return html`<section
		class="panel style-panel"
		id="drawing-style"
		aria-label="Style"
		hidden
	>
		<div class="swatches" role="group" aria-label="Color">
			${joinMarkup(
				swatches.map(
					([color, name]) =>
						html`<button
							type="button"
							data-color="${color}"
							aria-label="${translate(name ?? "")}"
							title="${translate(name ?? "")}"
							style="--swatch: ${color}"
						></button>`,
				),
			)}
			<label class="custom-color" title="Custom color">
				<input
					id="ink-color"
					type="color"
					value="#1d1d1d"
					aria-label="Custom color"
				/>
			</label>
		</div>
		<div class="segmented" role="group" aria-label="Stroke size">
			${joinMarkup(
				sizes.map(
					([width, short, name]) =>
						html`<button
							type="button"
							data-size="${width}"
							aria-label="${translate(name)}"
							title="${translate(name)}"
						>
							${short}
						</button>`,
				),
			)}
		</div>
		<div class="segmented" role="group" aria-label="Fill" data-fill-styles>
			${joinMarkup(
				fills.map(
					([fill, name]) =>
						html`<button
							type="button"
							data-fill="${fill}"
							aria-label="${translate(name)}"
							title="${translate(name)}"
						>
							${fillIcon(fill)}
						</button>`,
				),
			)}
		</div>
		<div
			class="segmented"
			role="group"
			aria-label="Line style"
			data-dash-styles
		>
			${joinMarkup(
				dashes.map(
					([dash, name]) =>
						html`<button
							type="button"
							data-dash="${dash}"
							aria-label="${translate(name)}"
							title="${translate(name)}"
						>
							${dashIcon(dash)}
						</button>`,
				),
			)}
		</div>
		<div
			class="selection-actions"
			role="group"
			aria-label="Arrange"
			data-selection-actions
		>
			${actionButton("duplicate-shape", "duplicate", "Duplicate (⌘D)")}
			${actionButton("back-shape", "back", "Send to back ([)")}
			${actionButton("front-shape", "front", "Bring to front (])")}
			${actionButton("delete-shape", "trash", "Delete (⌫)")}
		</div>
	</section>`
}

function actionButton(id: string, icon: DrawingIcon, label: string) {
	return html`<button
		type="button"
		id="${id}"
		aria-label="${translate(label)}"
		title="${translate(label)}"
	>
		${drawingIcon(icon)}
	</button>`
}

function fillIcon(fill: FillMode) {
	let paint =
		fill === "solid"
			? "currentColor"
			: fill === "tint"
				? "color-mix(in oklch, currentColor 25%, transparent)"
				: "none"
	return rawMarkup(
		`<svg class="icon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3" fill="${paint}" style="fill: ${paint}" stroke="currentColor" stroke-width="2"/></svg>`,
	)
}

function dashIcon(dash: DashMode) {
	let pattern = dash === "dashed" ? "5 4" : dash === "dotted" ? "0 4.5" : "none"
	return rawMarkup(
		`<svg class="icon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h18" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="${pattern}"/></svg>`,
	)
}

export class WhiteboardElement extends HTMLElement {
	private options: WhiteboardOptions | undefined
	private lifetime: Fiber.Fiber<void, never> | undefined
	configure(options: WhiteboardOptions) {
		this.options = options
		if (this.isConnected) this.connectedCallback()
	}
	connectedCallback() {
		let options = this.options
		if (!options || this.lifetime) return
		this.lifetime = Effect.runFork(
			Effect.scoped(
				Effect.gen(function* () {
					let writes = yield* FiberSet.make()
					let run = yield* FiberSet.runtimePromise(writes)<never>()
					let view = yield* Effect.acquireRelease(
						Effect.sync(() => createWhiteboardView(options, run)),
						view =>
							Effect.sync(() => {
								view.finish()
								view.dispose()
							}).pipe(Effect.andThen(FiberSet.awaitEmpty(writes))),
					)
					yield* Stream.merge(
						options.session.changes,
						options.session.presenceChanges,
					).pipe(
						Stream.runForEach(() => Effect.sync(view.paint)),
						Effect.forkScoped({ startImmediately: true }),
					)
					yield* Stream.fromEventListener(options.dialog, "close").pipe(
						Stream.filter(() => !options.dialog.open),
						Stream.take(1),
						Stream.runDrain,
					)
				}),
			),
		)
	}
	disconnectedCallback() {
		let lifetime = this.lifetime
		this.lifetime = undefined
		if (lifetime) Effect.runFork(Fiber.interrupt(lifetime))
	}
	connectedMoveCallback() {}
}
customElements.define("alkalye-whiteboard", WhiteboardElement)

function createWhiteboardView(
	options: WhiteboardOptions,
	run: <A, E>(task: Effect.Effect<A, E>) => Promise<A>,
) {
	let { session, documentId, dialog } = options
	let foundRoot = dialog.querySelector("alkalye-whiteboard")
	if (!(foundRoot instanceof HTMLElement))
		throw new Error("Drawing component missing")
	let root = foundRoot
	function element(selector: string) {
		let control = root.querySelector(selector)
		if (!(control instanceof HTMLElement))
			throw new Error("Drawing control missing: " + selector)
		return control
	}
	function elements(selector: string) {
		return [...root.querySelectorAll<HTMLElement>(selector)]
	}
	let id = options.boardId ?? ""
	function queue(task: () => Promise<unknown>) {
		void run(
			Effect.tryPromise(task).pipe(
				Effect.catch(error => Effect.sync(() => options.report(error))),
			),
		)
	}
	dialog.classList.add("wide")
	let events = new AbortController()
	let signal = events.signal
	dialog.addEventListener(
		"close",
		() => {
			if (dialog.open) return
			dialog.classList.remove("wide")
			events.abort()
		},
		{ once: true, signal },
	)
	let canvasElement = root.querySelector("svg#whiteboard")
	let textElement = root.querySelector("#drawing-text")
	let colorElement = root.querySelector("#ink-color")
	let menuElement = root.querySelector("#drawing-menu")
	let importElement = root.querySelector("#import-drawing")
	if (
		!(canvasElement instanceof SVGSVGElement) ||
		!(textElement instanceof HTMLTextAreaElement) ||
		!(colorElement instanceof HTMLInputElement) ||
		!(menuElement instanceof HTMLDetailsElement) ||
		!(importElement instanceof HTMLInputElement)
	)
		throw new Error("Drawing controls missing")
	let board = canvasElement,
		textEditor = textElement,
		customColor = colorElement,
		menu = menuElement,
		drawingInput = importElement
	let stage = element(".whiteboard-stage"),
		stylePanel = element("#drawing-style"),
		emptyHint = element("[data-empty-hint]"),
		zoomLabel = element("#reset-board"),
		embedButton = element("#embed-board")

	let tool: DrawingTool = "select"
	let style: DrawingStyle = {
		color: "#1d1d1d",
		width: 4,
		fill: "none",
		dash: "solid",
	}
	let selected = new Set<string>()
	let camera: Camera = { x: 0, y: 0, zoom: 1 }
	let viewport: Viewport = { width: 0, height: 0 }
	let fitted = false
	let gesture: Gesture | undefined
	let overlay: ShapeOverlay = new Map()
	let pending: ShapeOverlay = new Map()
	let editing: TextEditing | undefined
	let touches = new Map<number, Point>()
	let penSeen = false
	let spaceHeld = false
	let lastTap = { time: 0, point: { x: 0, y: 0 } }
	let undo: Change[][] = [],
		redo: Change[][] = []
	let shapeFields: Record<string, string> | undefined
	let shapeVersion = -1
	let cachedShapes = new Map<string, Shape>()
	let paintedFields: Record<string, string> | undefined
	let groups = new Map<string, SVGElement>()
	let hidden = new Set<string>()
	let fading = new Set<string>()
	let baseLayer = svg("g", {}),
		draftLayer = svg("g", { "data-drafts": "" }),
		selectionLayer = svg("g", { "data-selection": "" })
	board.replaceChildren(baseLayer, draftLayer, selectionLayer)
	let presence = drawingPresence({
		board,
		people: session.people,
		announce: value => run(session.announce(value)),
		boardId: id,
		documentId,
		actor: options.actor,
		name: options.name,
		signal,
	})
	let resizes = new ResizeObserver(measure)
	resizes.observe(stage)

	function shapes() {
		let version = session.version()
		if (version !== shapeVersion) {
			shapeVersion = version
			shapeFields = session.replica.fields(id)
			cachedShapes = drawingShapes(shapeFields)
		}
		return cachedShapes
	}
	function currentShape(key: string) {
		if (overlay.has(key)) return overlay.get(key)
		if (pending.has(key)) return pending.get(key)
		return shapes().get(key)
	}
	function selectedShapes() {
		let result = new Map<string, Shape>()
		for (let key of selected) {
			let shape = currentShape(key)
			if (shape) result.set(key, shape)
		}
		return result
	}
	function selectionBounds() {
		return unionBounds([...selectedShapes().values()].map(shapeBounds))
	}

	function measure() {
		viewport = { width: board.clientWidth, height: board.clientHeight }
		if (!fitted && viewport.width > 0 && viewport.height > 0) {
			fitted = true
			camera = fitBounds(contentBounds(), viewport)
		}
		paint()
	}
	function contentBounds() {
		return unionBounds([...shapes().values()].map(shapeBounds))
	}

	function paint() {
		paintControls()
		paintCanvas()
	}
	function paintCanvas() {
		board.setAttribute("viewBox", cameraViewBox(camera, viewport))
		board.dataset.activeTool = spaceHeld ? "pan" : tool
		board.toggleAttribute("data-panning", gesture?.kind === "pan")
		paintGrid()
		let values = shapes()
		pruneSelection(values)
		paintShapes(values)
		paintDrafts()
		paintSelection()
		positionTextEditor()
		emptyHint.hidden = values.size > 0 || pending.size > 0 || Boolean(gesture)
		presence.paint()
	}
	function paintGrid() {
		let size = 24 * camera.zoom
		while (size < 12) size *= 2
		stage.style.setProperty("--grid-size", `${size}px`)
		stage.style.setProperty("--grid-x", `${-camera.x * camera.zoom}px`)
		stage.style.setProperty("--grid-y", `${-camera.y * camera.zoom}px`)
		zoomLabel.textContent = `${Math.round(camera.zoom * 100)}%`
	}
	function pruneSelection(values: Map<string, Shape>) {
		for (let key of selected)
			if (!values.has(key) && !pending.get(key) && !overlay.get(key))
				selected.delete(key)
	}
	function paintShapes(values: Map<string, Shape>) {
		if (paintedFields === shapeFields) return
		paintedFields = shapeFields
		baseLayer.replaceChildren()
		groups.clear()
		hidden.clear()
		fading.clear()
		for (let [key, shape] of values) {
			let group = svg("g", { "data-shape": key })
			group.append(shapeElement(shape), hitArea(shape))
			baseLayer.append(group)
			groups.set(key, group)
		}
	}
	function paintDrafts() {
		let drafts = new Map([...pending, ...overlay])
		let nextHidden = new Set(drafts.keys())
		if (editing) nextHidden.add(editing.key)
		for (let key of hidden)
			if (!nextHidden.has(key)) groups.get(key)?.removeAttribute("display")
		for (let key of nextHidden) groups.get(key)?.setAttribute("display", "none")
		hidden = nextHidden
		let erasing = gesture?.kind === "erase" ? gesture.erased : new Set<string>()
		for (let key of fading)
			if (!erasing.has(key)) groups.get(key)?.removeAttribute("data-erasing")
		for (let key of erasing) groups.get(key)?.setAttribute("data-erasing", "")
		fading = new Set(erasing)
		draftLayer.replaceChildren()
		for (let [key, shape] of drafts) {
			if (!shape || key === editing?.key) continue
			let group = svg("g", { "data-draft": key })
			group.append(shapeElement(shape), hitArea(shape))
			draftLayer.append(group)
		}
	}
	function hitArea(shape: Shape) {
		if (shape.kind === "text" || canFill(shape))
			return svg("rect", { ...shapeBounds(shape), class: "hit-area" })
		return svg("polyline", {
			points: shape.points.map(point => `${point.x},${point.y}`).join(" "),
			class: "hit-stroke",
		})
	}
	function paintSelection() {
		selectionLayer.replaceChildren()
		let scale = 1 / camera.zoom
		let shown = selectedShapes()
		if (shown.size > 1)
			for (let shape of shown.values())
				selectionLayer.append(
					svg("rect", {
						...padded(shapeBounds(shape), 2 * scale),
						class: "outline",
					}),
				)
		let bounds = unionBounds([...shown.values()].map(shapeBounds))
		if (bounds && gesture?.kind !== "draw") {
			let box = padded(bounds, 4 * scale)
			selectionLayer.append(svg("rect", { ...box, class: "selection" }))
			if (session.writable() && !editing)
				for (let handle of handles)
					selectionLayer.append(handleElement(box, handle, scale))
		}
		if (gesture?.kind === "marquee")
			selectionLayer.append(
				svg("rect", {
					...boundsFromCorners(gesture.from, gesture.to),
					class: "marquee",
				}),
			)
	}
	function handleElement(box: Bounds, handle: ResizeHandle, scale: number) {
		let x = handle.includes("w")
				? box.x
				: handle.includes("e")
					? box.x + box.width
					: box.x + box.width / 2,
			y = handle.includes("n")
				? box.y
				: handle.includes("s")
					? box.y + box.height
					: box.y + box.height / 2
		let group = svg("g", { "data-handle": handle })
		let reach = 22 * scale,
			size = 9 * scale
		group.append(
			svg("rect", {
				x: x - reach / 2,
				y: y - reach / 2,
				width: reach,
				height: reach,
				class: "handle-reach",
			}),
			svg("rect", {
				x: x - size / 2,
				y: y - size / 2,
				width: size,
				height: size,
				class: "resize-handle",
			}),
		)
		return group
	}

	function paintControls() {
		let writable = session.writable()
		for (let control of elements("[data-writes], #import-drawing"))
			if (
				control instanceof HTMLButtonElement ||
				control instanceof HTMLInputElement
			)
				control.disabled = !writable
		for (let control of elements("[data-tool]")) {
			let choice = control.dataset.tool
			if (control instanceof HTMLButtonElement)
				control.disabled = !writable && choice !== "select" && choice !== "pan"
			control.setAttribute("aria-pressed", String(choice === tool))
		}
		element("[data-read-only]").hidden = writable
		let embedded = session.replica.text(documentId).includes(`asset:${id}`)
		embedButton.hidden = !writable
		let embedLabel = embedButton.querySelector("span")
		if (embedLabel)
			embedLabel.textContent = translate(embedded ? "Done" : "Embed drawing")
		paintStylePanel(writable)
	}
	function paintStylePanel(writable: boolean) {
		let shown = [...selectedShapes().values()]
		let visible = writable && (shown.length > 0 || creationTools.includes(tool))
		stylePanel.hidden = !visible
		if (!visible) return
		let current = shown[0] ? shapeStyle(shown[0]) : style
		let kinds = shown.length ? shown.map(shape => shape.kind) : [toolKind(tool)]
		element("[data-fill-styles]").hidden = !kinds.some(kind =>
			canFill({ kind }),
		)
		element("[data-dash-styles]").hidden = kinds.every(kind => kind === "text")
		element("[data-selection-actions]").hidden = shown.length === 0
		for (let control of elements("[data-color]"))
			control.setAttribute(
				"aria-pressed",
				String(control.dataset.color === current.color),
			)
		for (let control of elements("[data-size]"))
			control.setAttribute(
				"aria-pressed",
				String(Number(control.dataset.size) === current.width),
			)
		for (let control of elements("[data-fill]"))
			control.setAttribute(
				"aria-pressed",
				String(control.dataset.fill === current.fill),
			)
		for (let control of elements("[data-dash]"))
			control.setAttribute(
				"aria-pressed",
				String(control.dataset.dash === current.dash),
			)
		if (document.activeElement !== customColor)
			customColor.value = current.color
	}

	function positionTextEditor() {
		if (!editing) return
		let anchor = editing.shape.points[0] ?? { x: 0, y: 0 }
		let screen = worldToScreen(camera, anchor),
			size = textSize(editing.shape) * camera.zoom
		textEditor.style.left = `${screen.x}px`
		textEditor.style.top = `${screen.y - (textLineHeight(editing.shape) * camera.zoom - size) / 2}px`
		textEditor.style.fontSize = `${size}px`
		textEditor.style.color = editing.shape.color
		textEditor.style.fontFamily = drawingFont
	}

	function apply(changes: Change[], backwards = false, settle?: () => void) {
		let values: [string, string][] = changes.map(change => [
			change.key,
			backwards ? change.before : change.after,
		])
		queue(() =>
			run(session.write(id, values)).finally(() => {
				settle?.()
				paint()
			}),
		)
	}
	function remember(values: [string, string][], settle?: () => void) {
		let fields = session.replica.fields(id)
		let changes = values
			.map(([key, after]) => ({ key, before: fields[key] ?? "", after }))
			.filter(change => change.before !== change.after)
		if (!session.writable() || !changes.length) {
			settle?.()
			return
		}
		undo.push(changes)
		redo = []
		apply(changes, false, settle)
	}
	// Committed shapes stay drawn from memory until the write lands, so a moved
	// or new shape never flickers back to its previous state.
	function commit(entries: [string, Shape | undefined][]) {
		if (!session.writable() || !entries.length) return
		for (let [key, shape] of entries) pending.set(key, shape)
		remember(
			entries.map(([key, shape]) => [key, shape ? JSON.stringify(shape) : ""]),
			() => {
				for (let [key, shape] of entries)
					if (pending.get(key) === shape) pending.delete(key)
			},
		)
	}
	function travel(backwards: boolean) {
		if (!session.writable()) return
		cancelGesture()
		let command = backwards ? session.undo : session.redo
		if (command) {
			queue(() => run(command()).then(paint))
			return
		}
		let changes = (backwards ? undo : redo).pop()
		if (!changes) return
		;(backwards ? redo : undo).push(changes)
		apply(changes, backwards)
	}

	function localPoint(event: { clientX: number; clientY: number }): Point {
		let rect = board.getBoundingClientRect()
		return { x: event.clientX - rect.left, y: event.clientY - rect.top }
	}
	function worldPoint(event: { clientX: number; clientY: number }) {
		return screenToWorld(camera, localPoint(event))
	}
	function shapeKeyAt(target: EventTarget | null) {
		if (!(target instanceof Element)) return ""
		let found = target.closest("[data-shape], [data-draft]")
		return (
			found?.getAttribute("data-shape") ??
			found?.getAttribute("data-draft") ??
			""
		)
	}
	function newKey() {
		return `shape:${Effect.runSync(session.uuid)}`
	}
	function nextOrder(index = 0) {
		return drawingOrder(session.replica.clock + 1, session.replica.actor, index)
	}
	function newShape(kind: Shape["kind"], point: Point): Shape {
		return {
			order: nextOrder(),
			kind,
			color: style.color,
			width: style.width,
			points: [point, point],
			text: "",
			fill: canFill({ kind }) ? fillColor(style.fill, style.color) : undefined,
			dash: kind === "text" || style.dash === "solid" ? undefined : style.dash,
		}
	}

	function setTool(next: DrawingTool) {
		if (!session.writable() && next !== "select" && next !== "pan") return
		commitText()
		cancelGesture()
		tool = next
		if (next !== "select") selected.clear()
		paint()
	}
	function select(keys: Iterable<string>) {
		selected = new Set(keys)
	}

	board.onpointerdown = event => {
		if (editing) {
			event.preventDefault()
			commitText()
			return
		}
		closeMenu()
		event.preventDefault()
		board.focus({ preventScroll: true })
		if (event.pointerType === "pen") penSeen = true
		if (event.pointerType === "touch") {
			touches.set(event.pointerId, localPoint(event))
			if (touches.size === 2) {
				startPinch()
				return
			}
			if (touches.size > 2) return
		}
		if (gesture) return
		capture(event.pointerId)
		let point = worldPoint(event)
		let panning =
			event.button === 1 ||
			spaceHeld ||
			tool === "pan" ||
			(penSeen && event.pointerType === "touch")
		if (panning) {
			gesture = {
				kind: "pan",
				pointerId: event.pointerId,
				last: localPoint(event),
			}
			paintCanvas()
			return
		}
		if (event.button !== 0) return
		let tapping =
			event.pointerType !== "mouse" && (tool === "select" || tool === "text")
		if (tapping && isDoubleTap(event)) {
			doubleTap(event, point)
			return
		}
		if (tool === "select") beginSelection(event, point)
		else if (tool === "eraser") beginErasing(event)
		else if (tool === "text") beginText(event, point)
		else beginDrawing(event, point)
	}
	function capture(pointerId: number) {
		try {
			board.setPointerCapture(pointerId)
		} catch {
			return
		}
	}
	function isDoubleTap(event: PointerEvent) {
		let point = localPoint(event),
			now = performance.now()
		let double =
			now - lastTap.time < 350 &&
			Math.hypot(point.x - lastTap.point.x, point.y - lastTap.point.y) < 8
		lastTap = { time: double ? 0 : now, point }
		return double
	}
	// Mice double-click natively, honouring the system speed; touch and pens
	// are timed here because browsers do not reliably report their double taps.
	board.ondblclick = event => {
		if (event.button === 0 && !gesture) doubleTap(event, worldPoint(event))
	}
	function doubleTap(event: MouseEvent, point: Point) {
		if (!session.writable() || (tool !== "select" && tool !== "text")) return
		// Pointer capture retargets the click to the canvas, so hit-test instead.
		let key = shapeKeyAt(
				document.elementFromPoint(event.clientX, event.clientY),
			),
			shape = key ? currentShape(key) : undefined
		if (shape?.kind === "text") editText(key, shape)
		else if (!key) editText(newKey(), newShape("text", point), true)
	}
	function beginSelection(event: PointerEvent, point: Point) {
		let handle =
			event.target instanceof Element
				? event.target.closest("[data-handle]")?.getAttribute("data-handle")
				: undefined
		let resize = handles.find(value => value === handle)
		let bounds = selectionBounds()
		if (resize && bounds && session.writable()) {
			gesture = {
				kind: "resize",
				pointerId: event.pointerId,
				handle: resize,
				from: point,
				bounds,
				originals: selectedShapes(),
			}
			return
		}
		let key = shapeKeyAt(event.target)
		if (key && event.shiftKey) {
			if (selected.has(key)) selected.delete(key)
			else selected.add(key)
		} else if (key && !selected.has(key)) select([key])
		let insideSelection =
			!key && bounds && boundsContain(bounds, point) && !event.shiftKey
		if ((key || insideSelection) && selected.size && session.writable())
			gesture = {
				kind: "move",
				pointerId: event.pointerId,
				from: point,
				originals: selectedShapes(),
			}
		else if (!key && !insideSelection) {
			if (!event.shiftKey) selected.clear()
			gesture = {
				kind: "marquee",
				pointerId: event.pointerId,
				from: point,
				to: point,
				base: new Set(selected),
			}
		}
		paint()
	}
	function beginErasing(event: PointerEvent) {
		if (!session.writable()) return
		gesture = { kind: "erase", pointerId: event.pointerId, erased: new Set() }
		eraseAt(event)
	}
	function eraseAt(event: PointerEvent) {
		if (gesture?.kind !== "erase") return
		let key = shapeKeyAt(
			document.elementFromPoint(event.clientX, event.clientY),
		)
		if (!key || gesture.erased.has(key)) return
		gesture.erased.add(key)
		paintCanvas()
	}
	function beginText(event: PointerEvent, point: Point) {
		if (!session.writable()) return
		let key = shapeKeyAt(event.target),
			shape = key ? currentShape(key) : undefined
		if (shape?.kind === "text") editText(key, shape)
		else editText(newKey(), newShape("text", point), true)
	}
	function beginDrawing(event: PointerEvent, point: Point) {
		if (!session.writable()) return
		let kind = toolKind(tool)
		let shape = newShape(kind, point)
		if (kind === "pen") shape.points = [point]
		gesture = {
			kind: "draw",
			pointerId: event.pointerId,
			key: newKey(),
			shape,
			from: localPoint(event),
		}
		overlay.set(gesture.key, shape)
		paintCanvas()
	}
	function startPinch() {
		cancelGesture()
		let [first, second] = [...touches.values()]
		if (!first || !second) return
		gesture = {
			kind: "pinch",
			distance: Math.max(1, distance(first, second)),
			center: midpoint(first, second),
			camera,
		}
	}

	board.onpointermove = event => {
		if (touches.has(event.pointerId))
			touches.set(event.pointerId, localPoint(event))
		let point = worldPoint(event)
		presence.move(point)
		if (gesture?.kind === "pinch") {
			pinch(gesture)
			return
		}
		if (!gesture || gesture.pointerId !== event.pointerId) return
		if (gesture.kind === "pan") {
			let next = localPoint(event)
			camera = panBy(camera, {
				x: next.x - gesture.last.x,
				y: next.y - gesture.last.y,
			})
			gesture.last = next
		} else if (gesture.kind === "draw") draw(gesture, event, point)
		else if (gesture.kind === "move") move(gesture, point, event.shiftKey)
		else if (gesture.kind === "resize") resize(gesture, point, event.shiftKey)
		else if (gesture.kind === "marquee") {
			gesture.to = point
			let area = boundsFromCorners(gesture.from, point)
			select([...gesture.base, ...shapesInBounds(shapes(), area)])
		} else if (gesture.kind === "erase") eraseAt(event)
		paintCanvas()
	}
	function pinch(current: Extract<Gesture, { kind: "pinch" }>) {
		let [first, second] = [...touches.values()]
		if (!first || !second) return
		let center = midpoint(first, second)
		let zoomed = zoomAt(
			current.camera,
			current.center,
			(current.camera.zoom * distance(first, second)) / current.distance,
		)
		camera = panBy(zoomed, {
			x: center.x - current.center.x,
			y: center.y - current.center.y,
		})
		paintCanvas()
	}
	function draw(
		current: Extract<Gesture, { kind: "draw" }>,
		event: PointerEvent,
		point: Point,
	) {
		let shape = current.shape
		if (shape.kind === "pen") {
			let samples = event.getCoalescedEvents?.() ?? []
			for (let sample of samples.length ? samples : [event]) {
				let next = worldPoint(sample),
					last = shape.points[shape.points.length - 1]
				if (
					!last ||
					Math.hypot(next.x - last.x, next.y - last.y) > 1 / camera.zoom
				)
					shape.points.push(next)
			}
		} else {
			let start = shape.points[0] ?? point
			shape.points = [
				start,
				event.shiftKey ? constrain(shape.kind, start, point) : point,
			]
		}
		current.shape = { ...shape }
		overlay.set(current.key, current.shape)
	}
	function move(
		current: Extract<Gesture, { kind: "move" }>,
		point: Point,
		axis: boolean,
	) {
		let delta = { x: point.x - current.from.x, y: point.y - current.from.y }
		if (axis) {
			if (Math.abs(delta.x) > Math.abs(delta.y)) delta.y = 0
			else delta.x = 0
		}
		for (let [key, shape] of current.originals)
			overlay.set(key, translateShape(shape, delta))
	}
	function resize(
		current: Extract<Gesture, { kind: "resize" }>,
		point: Point,
		keepAspect: boolean,
	) {
		let delta = { x: point.x - current.from.x, y: point.y - current.from.y }
		let texts = [...current.originals.values()].some(
			shape => shape.kind === "text",
		)
		let next = resizeBounds(
			current.bounds,
			current.handle,
			delta,
			keepAspect || texts,
		)
		for (let [key, shape] of current.originals)
			overlay.set(key, scaleShape(shape, current.bounds, next))
	}

	board.onpointerup = event => {
		touches.delete(event.pointerId)
		if (gesture?.kind === "pinch") {
			if (touches.size < 2) gesture = undefined
			return
		}
		if (!gesture || gesture.pointerId !== event.pointerId) return
		finishGesture(gesture, event)
	}
	board.onpointercancel = event => {
		touches.delete(event.pointerId)
		if (gesture?.kind === "pinch" || gesture?.pointerId === event.pointerId)
			cancelGesture()
		paint()
	}
	board.onpointerleave = event => {
		if (!gesture) presence.move()
		if (event.pointerType === "touch") touches.delete(event.pointerId)
	}
	function finishGesture(current: Gesture, event: PointerEvent) {
		gesture = undefined
		if (current.kind === "draw") finishDrawing(current, event)
		else if (current.kind === "move" || current.kind === "resize")
			commit([...overlay].filter(([key]) => current.originals.has(key)))
		else if (current.kind === "erase")
			commit([...current.erased].map(key => [key, undefined]))
		overlay.clear()
		paint()
	}
	function finishDrawing(
		current: Extract<Gesture, { kind: "draw" }>,
		event: PointerEvent,
	) {
		let shape = current.shape,
			end = localPoint(event)
		let tiny = Math.hypot(end.x - current.from.x, end.y - current.from.y) < 4
		if (tiny && (shape.kind === "line" || shape.kind === "arrow")) return
		if (tiny && canFill(shape)) shape = defaultSizedShape(shape)
		commit([[current.key, shape]])
		if (shape.kind !== "pen") {
			tool = "select"
			select([current.key])
		}
	}
	function defaultSizedShape(shape: Shape): Shape {
		let center = shape.points[0] ?? { x: 0, y: 0 }
		return {
			...shape,
			points: [
				{ x: center.x - 80, y: center.y - 50 },
				{ x: center.x + 80, y: center.y + 50 },
			],
		}
	}
	function cancelGesture() {
		gesture = undefined
		overlay.clear()
	}

	board.onwheel = event => {
		event.preventDefault()
		let unit =
			event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.height : 1
		let x = event.deltaX * unit,
			y = event.deltaY * unit
		if (event.ctrlKey || event.metaKey) {
			let factor = Math.exp(-Math.max(-60, Math.min(60, y)) * 0.01)
			camera = zoomAt(camera, localPoint(event), camera.zoom * factor)
		} else if (event.shiftKey && !x) camera = panBy(camera, { x: -y, y: 0 })
		else camera = panBy(camera, { x: -x, y: -y })
		paintCanvas()
	}
	function zoomBy(direction: 1 | -1) {
		let center = { x: viewport.width / 2, y: viewport.height / 2 }
		camera = zoomAt(camera, center, nextZoomStop(camera.zoom, direction))
		paintCanvas()
	}
	function resetZoom() {
		camera = zoomAt(
			camera,
			{ x: viewport.width / 2, y: viewport.height / 2 },
			1,
		)
		paintCanvas()
	}
	function zoomToFit(bounds = contentBounds()) {
		camera = fitBounds(bounds, viewport)
		paintCanvas()
	}

	function editText(key: string, shape: Shape, created = false) {
		cancelGesture()
		editing = { key, shape, created }
		select([key])
		textEditor.value = shape.text
		textEditor.hidden = false
		paint()
		textEditor.focus({ preventScroll: true })
		if (!created) textEditor.select()
	}
	function commitText() {
		let current = editing
		if (!current) return
		editing = undefined
		let text = textEditor.value.replace(/\s+$/, "")
		textEditor.hidden = true
		textEditor.value = ""
		if (!text && current.created) selected.delete(current.key)
		else if (!text) commit([[current.key, undefined]])
		else if (text !== current.shape.text || current.created)
			commit([[current.key, { ...current.shape, text }]])
		if (tool === "text") tool = "select"
		board.focus({ preventScroll: true })
		paint()
	}
	textEditor.onblur = () => commitText()
	textEditor.onkeydown = event => {
		let finish =
			event.key === "Escape" ||
			(event.key === "Enter" && (event.metaKey || event.ctrlKey))
		if (!finish) return
		event.preventDefault()
		event.stopPropagation()
		commitText()
	}

	function styleSelection(change: (shape: Shape) => Shape) {
		commit([...selectedShapes()].map(([key, shape]) => [key, change(shape)]))
		paint()
	}
	function chooseColor(color: string) {
		style.color = color
		styleSelection(shape => ({
			...shape,
			color,
			fill: shape.fill ? fillColor(shapeStyle(shape).fill, color) : undefined,
		}))
	}
	function chooseSize(width: number) {
		style.width = width
		styleSelection(shape => ({ ...shape, width }))
	}
	function chooseFill(fill: FillMode) {
		style.fill = fill
		styleSelection(shape =>
			canFill(shape) ? { ...shape, fill: fillColor(fill, shape.color) } : shape,
		)
	}
	function chooseDash(dash: DashMode) {
		style.dash = dash
		styleSelection(shape =>
			shape.kind === "text"
				? shape
				: { ...shape, dash: dash === "solid" ? undefined : dash },
		)
	}

	function deleteSelection() {
		commit([...selected].map(key => [key, undefined]))
		selected.clear()
		paint()
	}
	function duplicateSelection() {
		let copies: [string, Shape][] = orderedSelection().map(
			([, shape], index) => [
				newKey(),
				{ ...translateShape(shape, { x: 24, y: 24 }), order: nextOrder(index) },
			],
		)
		commit(copies)
		select(copies.map(([key]) => key))
		paint()
	}
	function bringToFront() {
		reorder((_, index) => nextOrder(index))
	}
	function sendToBack() {
		let others = [...shapes()]
			.filter(([key]) => !selected.has(key))
			.map(([, shape]) => shape)
		reorder((_, index) => orderBelow(others, session.replica.actor, index))
	}
	function reorder(order: (shape: Shape, index: number) => string) {
		commit(
			orderedSelection().map(([key, shape], index) => [
				key,
				{ ...shape, order: order(shape, index) },
			]),
		)
		paint()
	}
	function orderedSelection() {
		return [...shapes()].filter(([key]) => selected.has(key))
	}
	function nudge(delta: Point) {
		commit(
			[...selectedShapes()].map(([key, shape]) => [
				key,
				translateShape(shape, delta),
			]),
		)
		paint()
	}
	function selectAll() {
		tool = "select"
		select(shapes().keys())
		paint()
	}
	function clearBoard() {
		commit([...shapes().keys()].map(key => [key, undefined]))
		selected.clear()
		paint()
	}

	function download(file: Blob, name: string) {
		let url = URL.createObjectURL(file),
			link = document.createElement("a")
		link.href = url
		link.download = name
		link.click()
		setTimeout(() => URL.revokeObjectURL(url), 1000)
	}
	function exportDrawing() {
		download(
			new Blob(
				[
					JSON.stringify(
						{ format: "alkalye-drawing-v1", shapes: [...shapes().values()] },
						null,
						2,
					),
				],
				{ type: "application/json" },
			),
			"drawing.alkalye-drawing.json",
		)
	}
	function exportImage() {
		download(drawingPreview(session.replica.fields(id)), "drawing.svg")
	}
	function importFile() {
		let file = drawingInput.files?.[0]
		drawingInput.value = ""
		if (!file) return
		queue(async () => {
			let imported: [string, Shape][] = importDrawing(
				JSON.parse(await file.text()),
			).map((shape, index) => [newKey(), { ...shape, order: nextOrder(index) }])
			commit(imported)
			tool = "select"
			select(imported.map(([key]) => key))
			zoomToFit(unionBounds(imported.map(([, shape]) => shapeBounds(shape))))
			paint()
		})
	}
	function embed() {
		if (session.replica.text(documentId).includes(`asset:${id}`)) {
			dialog.close()
			return
		}
		queue(async () => {
			if (!session.writable()) throw new Error("This document is read-only")
			commitText()
			await run(session.write(id, [["name", translate("Whiteboard")]], true))
			dialog.close()
		})
	}
	function closeMenu() {
		menu.open = false
	}

	let menuPanel = menu.querySelector<HTMLElement>(".menu-items")
	let menuTrigger = menu.querySelector("summary")
	if (!menuPanel || !(menuTrigger instanceof HTMLElement))
		throw new Error("Missing drawing menu")
	let itemsPanel = menuPanel
	let trigger = menuTrigger
	let navigation = menuNavigation(
		menuPanel,
		{
			items: () => [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')],
			close: (restore = true) => {
				closeMenu()
				if (restore) trigger.focus({ preventScroll: true })
			},
		},
		signal,
	)
	for (let item of menuPanel.querySelectorAll<HTMLElement>('[role="menuitem"]'))
		item.tabIndex = -1
	itemsPanel.addEventListener(
		"click",
		event => {
			if (
				event.target instanceof Element &&
				event.target.closest('[role="menuitem"]')
			)
				closeMenu()
		},
		{ signal },
	)
	menu.addEventListener(
		"toggle",
		() => {
			if (menu.open) navigation.focus("first")
		},
		{ signal },
	)
	trigger.addEventListener(
		"keydown",
		event => {
			if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
			event.preventDefault()
			event.stopPropagation()
			menu.open = true
			navigation.focus(event.key === "ArrowUp" ? "last" : "first")
		},
		{ signal },
	)

	function handleKey(event: KeyboardEvent) {
		if (
			event.defaultPrevented ||
			event.isComposing ||
			isFormField(event.target)
		)
			return
		if (
			menu.open &&
			event.target instanceof Node &&
			itemsPanel.contains(event.target)
		)
			return
		let handled = handleShortcut(event)
		if (handled) event.preventDefault()
	}
	function handleShortcut(event: KeyboardEvent) {
		let key = event.key.toLowerCase()
		if (event.metaKey || event.ctrlKey) return commandShortcut(event, key)
		if (event.altKey) return false
		if (key === "escape") return escape()
		if (key === " " && !(event.target instanceof HTMLButtonElement)) {
			spaceHeld = true
			paintCanvas()
			return true
		}
		if (event.shiftKey && event.code === "Digit1") return handled(zoomToFit)
		if (event.shiftKey && event.code === "Digit0") return handled(resetZoom)
		if (key === "=" || key === "+") return handled(() => zoomBy(1))
		if (key === "-") return handled(() => zoomBy(-1))
		let writable = session.writable()
		if (writable && selected.size) {
			if (key === "delete" || key === "backspace")
				return handled(deleteSelection)
			if (key === "]") return handled(bringToFront)
			if (key === "[") return handled(sendToBack)
			let step = event.shiftKey ? 10 : 1
			let arrows: Record<string, Point> = {
				arrowleft: { x: -step, y: 0 },
				arrowright: { x: step, y: 0 },
				arrowup: { x: 0, y: -step },
				arrowdown: { x: 0, y: step },
			}
			let delta = arrows[key]
			if (delta) return handled(() => nudge(delta))
		}
		let choice = toolChoices.find(
			value => value.key === key || (key === "p" && value.tool === "pen"),
		)
		if (choice && !event.shiftKey) return handled(() => setTool(choice.tool))
		return false
	}
	function commandShortcut(event: KeyboardEvent, key: string) {
		if (key === "z") return handled(() => travel(!event.shiftKey))
		if (key === "y") return handled(() => travel(false))
		if (key === "a") return handled(selectAll)
		if (key === "d" && selected.size && session.writable())
			return handled(duplicateSelection)
		return false
	}
	function escape() {
		if (menu.open) closeMenu()
		else if (gesture) cancelGesture()
		else if (selected.size) selected.clear()
		else if (tool !== "select") tool = "select"
		else return false
		paint()
		return true
	}
	function handled(action: () => void) {
		action()
		return true
	}
	dialog.addEventListener("keydown", handleKey, { signal })
	dialog.addEventListener(
		"keyup",
		event => {
			if (event.key !== " " || !spaceHeld) return
			spaceHeld = false
			paintCanvas()
		},
		{ signal },
	)
	root.addEventListener(
		"pointerdown",
		event => {
			if (
				menu.open &&
				event.target instanceof Node &&
				!menu.contains(event.target)
			)
				closeMenu()
		},
		{ signal, capture: true },
	)

	for (let button of elements("[data-tool]"))
		button.onclick = () => {
			let next = toolChoices.find(choice => choice.tool === button.dataset.tool)
			if (next) setTool(next.tool)
		}
	for (let button of elements("[data-color]"))
		button.onclick = () => chooseColor(button.dataset.color ?? style.color)
	customColor.onchange = () => chooseColor(customColor.value)
	for (let button of elements("[data-size]"))
		button.onclick = () => chooseSize(Number(button.dataset.size))
	for (let button of elements("[data-fill]"))
		button.onclick = () => {
			let fill = fills.find(([value]) => value === button.dataset.fill)?.[0]
			if (fill) chooseFill(fill)
		}
	for (let button of elements("[data-dash]"))
		button.onclick = () => {
			let dash = dashes.find(([value]) => value === button.dataset.dash)?.[0]
			if (dash) chooseDash(dash)
		}
	function onMenu(selector: string, action: () => void) {
		element(selector).onclick = () => {
			closeMenu()
			action()
		}
	}
	element("#drawing-undo").onclick = () => travel(true)
	element("#drawing-redo").onclick = () => travel(false)
	element("#delete-shape").onclick = deleteSelection
	element("#duplicate-shape").onclick = duplicateSelection
	element("#front-shape").onclick = bringToFront
	element("#back-shape").onclick = sendToBack
	element("#zoom-board-in").onclick = () => zoomBy(1)
	element("#zoom-board-out").onclick = () => zoomBy(-1)
	zoomLabel.onclick = resetZoom
	embedButton.onclick = embed
	onMenu("#export-drawing", exportDrawing)
	onMenu("#export-svg", exportImage)
	onMenu("#select-all", selectAll)
	onMenu("#zoom-fit", () => zoomToFit())
	onMenu("#clear-board", clearBoard)
	drawingInput.onchange = () => {
		closeMenu()
		importFile()
	}

	measure()
	board.focus({ preventScroll: true })
	return {
		paint,
		finish: commitText,
		dispose() {
			events.abort()
			resizes.disconnect()
			for (let node of [root, ...root.querySelectorAll("*")]) {
				if (!(node instanceof HTMLElement) && !(node instanceof SVGElement))
					continue
				node.onclick = null
				node.onchange = null
				node.oninput = null
				node.onblur = null
				node.ondblclick = null
				node.onkeydown = null
				node.onpointerdown = null
				node.onpointermove = null
				node.onpointerup = null
				node.onpointercancel = null
				node.onpointerleave = null
				node.onwheel = null
			}
			let current = dialog.querySelector(
				"alkalye-whiteboard, alkalye-theme-workbench",
			)
			if (!current || current === root) dialog.classList.remove("wide")
		},
	}
}

function toolKind(tool: DrawingTool): Shape["kind"] {
	if (
		tool === "rectangle" ||
		tool === "ellipse" ||
		tool === "line" ||
		tool === "arrow" ||
		tool === "text"
	)
		return tool
	return "pen"
}

function shapeStyle(shape: Shape): DrawingStyle {
	return {
		color: shape.color,
		width: shape.width,
		fill: !shape.fill ? "none" : shape.fill === shape.color ? "solid" : "tint",
		dash: shape.dash ?? "solid",
	}
}

function fillColor(fill: FillMode, color: string) {
	if (fill === "solid") return color
	if (fill === "tint") return tintColor(color)
	return undefined
}

// Shift snaps lines to 15° steps and boxes to squares and circles.
function constrain(kind: Shape["kind"], start: Point, point: Point): Point {
	let dx = point.x - start.x,
		dy = point.y - start.y
	if (kind === "line" || kind === "arrow") {
		let step = Math.PI / 12
		let angle = Math.round(Math.atan2(dy, dx) / step) * step,
			length = Math.hypot(dx, dy)
		return {
			x: start.x + Math.cos(angle) * length,
			y: start.y + Math.sin(angle) * length,
		}
	}
	let side = Math.max(Math.abs(dx), Math.abs(dy))
	return {
		x: start.x + Math.sign(dx || 1) * side,
		y: start.y + Math.sign(dy || 1) * side,
	}
}

function padded(bounds: Bounds, amount: number): Bounds {
	return {
		x: bounds.x - amount,
		y: bounds.y - amount,
		width: bounds.width + amount * 2,
		height: bounds.height + amount * 2,
	}
}

function distance(first: Point, second: Point) {
	return Math.hypot(second.x - first.x, second.y - first.y)
}

function midpoint(first: Point, second: Point): Point {
	return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }
}

function isFormField(target: EventTarget | null) {
	return (
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		target instanceof HTMLSelectElement ||
		(target instanceof HTMLElement && target.isContentEditable)
	)
}
