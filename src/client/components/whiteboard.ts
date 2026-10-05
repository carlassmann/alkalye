import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as FiberSet from "effect/FiberSet"
import * as Stream from "effect/Stream"
import { connectPopover, menuNavigation } from "../ui/menu"
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
import type { DrawingPalette } from "../drawing-svg"
import {
	drawingFont,
	drawingImage,
	labelCenter,
	shapeContent,
	shapeTransform,
	svg,
} from "../drawing-svg"
import type { Markup } from "../language"
import { html, joinMarkup, rawMarkup, translate } from "../language"
import { drawingPresence } from "./drawing-presence"
import type { DrawingIcon } from "./whiteboard-icons"
import { drawingIcon } from "./whiteboard-icons"

import type {
	Bounds,
	DrawingEntry,
	DrawingTool,
	Point,
	ResizeHandle,
	Shape,
	ShapeDash,
} from "../../shared/drawing"
import {
	boundsCenter,
	boundsContain,
	boundsFromCorners,
	boundsIntersect,
	canFill,
	canLabel,
	drawingOrder,
	drawingShapes,
	flipShape,
	labelSize,
	labelWidth,
	localBounds,
	orderBelow,
	orderedDrawing,
	resizeBounds,
	resizeRotatedShape,
	rotateShape,
	rotates,
	scaleShape,
	shapeBounds,
	shapeCenter,
	shapeCorners,
	shapesInBounds,
	terminals,
	textLineHeight,
	textSize,
	tintColor,
	toWorld,
	translateShape,
	unionBounds,
} from "../../shared/drawing"
import {
	bindingAt,
	boundArrows,
	keepBindings,
	releaseArrows,
	resolveArrow,
	resolveDrawing,
} from "../../shared/drawing-arrows"
import {
	clipboardText,
	drawingClipboardType,
	drawingDocument,
	rekeyShapes,
} from "../../shared/drawing-clipboard"
import { importDrawingEntries } from "../../shared/drawing-import"
import { hasPressure } from "../../shared/drawing-ink"
import type {
	Alignment,
	Distribution,
	Guide,
} from "../../shared/drawing-layout"
import {
	alignmentOffsets,
	distributionOffsets,
	snapBounds,
} from "../../shared/drawing-layout"
import {
	contrastInk,
	darkCanvas,
	inkColor,
	lightCanvas,
} from "../../shared/drawing-palette"

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
type Terminal = "start" | "end"
type ArrangeAction =
	| Alignment
	| Distribution
	| "rotate"
	| "flip-horizontal"
	| "flip-vertical"
	| "group"
	| "ungroup"
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
// Transforming gestures wait for the pointer to travel a few pixels, so a
// click that only selects never rewrites the shapes it lands on.
interface Drag {
	pointerId: number
	down: Point
	started: boolean
}
type Gesture =
	| { kind: "draw"; pointerId: number; key: string; shape: Shape; from: Point }
	| (Drag & {
			kind: "move"
			from: Point
			bounds: Bounds
			originals: Map<string, Shape>
			targets: Bounds[]
	  })
	| (Drag & {
			kind: "resize"
			handle: ResizeHandle
			from: Point
			bounds: Bounds
			originals: Map<string, Shape>
			targets: Bounds[]
	  })
	| (Drag & {
			kind: "rotate"
			center: Point
			from: number
			base: number | undefined
			originals: Map<string, Shape>
	  })
	| (Drag & {
			kind: "endpoint"
			key: string
			terminal: Terminal
			original: Shape
	  })
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
	label: boolean
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
let arrangeChoices: [ArrangeAction, DrawingIcon, string, string][] = [
	["left", "align-left", "Align left", "⌥A"],
	["center", "align-center", "Align centre", "⌥H"],
	["right", "align-right", "Align right", "⌥D"],
	["top", "align-top", "Align top", "⌥W"],
	["middle", "align-middle", "Align middle", "⌥V"],
	["bottom", "align-bottom", "Align bottom", "⌥S"],
	["horizontal", "distribute-horizontal", "Distribute horizontally", "⌥⇧H"],
	["vertical", "distribute-vertical", "Distribute vertically", "⌥⇧V"],
	["rotate", "rotate", "Rotate 90°", ""],
	["flip-horizontal", "flip-horizontal", "Flip horizontally", "⇧H"],
	["flip-vertical", "flip-vertical", "Flip vertically", "⇧V"],
	["group", "group", "Group", "⌘G"],
	["ungroup", "ungroup", "Ungroup", "⇧⌘G"],
]
let alignKeys: Record<string, Alignment> = {
	KeyA: "left",
	KeyH: "center",
	KeyD: "right",
	KeyW: "top",
	KeyV: "middle",
	KeyS: "bottom",
}
let creationTools: DrawingTool[] = [
	"pen",
	"rectangle",
	"ellipse",
	"line",
	"arrow",
	"text",
]
let handles: ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"]
let rotationStep = Math.PI / 12

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
			${actionButton("arrange-shape", "more", "Arrange")}
		</div>
		<div
			id="drawing-arrange"
			class="arrange-menu"
			role="menu"
			aria-label="Arrange"
			popover="auto"
		>
			${joinMarkup(
				arrangeChoices.map(
					([action, icon, label, shortcut]) =>
						html`${
								action === "horizontal" ||
								action === "rotate" ||
								action === "group"
									? rawMarkup('<hr role="separator" />')
									: ""
							}<button
								type="button"
								role="menuitem"
								data-arrange="${action}"
								tabindex="-1"
							>
								${drawingIcon(icon)}<span>${translate(label)}</span
								><kbd>${shortcut}</kbd>
							</button>`,
				),
				"",
			)}
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
	let arrangeElement = root.querySelector("#arrange-shape")
	if (
		!(canvasElement instanceof SVGSVGElement) ||
		!(textElement instanceof HTMLTextAreaElement) ||
		!(colorElement instanceof HTMLInputElement) ||
		!(menuElement instanceof HTMLDetailsElement) ||
		!(importElement instanceof HTMLInputElement) ||
		!(arrangeElement instanceof HTMLButtonElement)
	)
		throw new Error("Drawing controls missing")
	let board = canvasElement,
		textEditor = textElement,
		customColor = colorElement,
		menu = menuElement,
		drawingInput = importElement,
		arrangeTrigger = arrangeElement
	let stage = element(".whiteboard-stage"),
		stylePanel = element("#drawing-style"),
		arrangePanel = element("#drawing-arrange"),
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
	let focusedGroup: string | undefined
	let camera: Camera = { x: 0, y: 0, zoom: 1 }
	let viewport: Viewport = { width: 0, height: 0 }
	let fitted = false
	let gesture: Gesture | undefined
	let guides: Guide[] = []
	let bindingHint: string | undefined
	let overlay: ShapeOverlay = new Map()
	let pending: ShapeOverlay = new Map()
	let editing: TextEditing | undefined
	let touches = new Map<number, Point>()
	let pointer: Point | undefined
	let penSeen = false
	let spaceHeld = false
	let lastTap = { time: 0, point: { x: 0, y: 0 } }
	let clipboardSource = { payload: "", count: -1 }
	let undo: Change[][] = [],
		redo: Change[][] = []
	let shapeFields: Record<string, string> | undefined
	let shapeVersion = -1
	let cachedShapes = new Map<string, Shape>()
	let paintedFields: Record<string, string> | undefined
	let groups = new Map<string, SVGElement>()
	let hidden = new Set<string>()
	let fading = new Set<string>()
	let palette: DrawingPalette = { ink: color => color, canvas: lightCanvas }
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
	// The page's appearance can change while the board is open, from the
	// app's preference or from the system; both arrive as a colour scheme.
	let appearance = new MutationObserver(updateAppearance)
	appearance.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["data-appearance"],
	})
	matchMedia("(prefers-color-scheme: dark)").addEventListener(
		"change",
		updateAppearance,
		{ signal },
	)
	updateAppearance()

	function updateAppearance() {
		let dark = getComputedStyle(root).colorScheme.includes("dark")
		if (root.dataset.ink === (dark ? "dark" : "light")) return
		root.dataset.ink = dark ? "dark" : "light"
		palette = {
			ink: color => inkColor(color, dark),
			canvas: dark ? darkCanvas : lightCanvas,
		}
		for (let control of elements("[data-color]"))
			control.style.setProperty(
				"--swatch",
				palette.ink(control.dataset.color ?? ""),
			)
		paintedFields = undefined
		if (viewport.width) paint()
	}

	function shapes() {
		let version = session.version()
		if (version !== shapeVersion) {
			shapeVersion = version
			shapeFields = session.replica.fields(id)
			cachedShapes = drawingShapes(shapeFields)
		}
		return cachedShapes
	}
	// Stored shapes with this view's unsaved drafts applied.
	function view() {
		let base = shapes()
		if (!overlay.size && !pending.size) return base
		let result = new Map(base),
			added = false
		for (let [key, shape] of [...pending, ...overlay]) {
			if (!shape) {
				result.delete(key)
				continue
			}
			if (!result.has(key)) added = true
			result.set(key, shape)
		}
		return added ? orderedDrawing(result) : result
	}
	function currentShape(key: string) {
		if (overlay.has(key)) return overlay.get(key)
		if (pending.has(key)) return pending.get(key)
		return shapes().get(key)
	}
	// A shape as it is drawn, with arrow terminals resolved against targets.
	function shown(key: string, values = view()) {
		let shape = values.get(key)
		return (
			shape &&
			resolveArrow(shape, target =>
				target === key ? undefined : values.get(target),
			)
		)
	}
	function selectedShapes(values = view()) {
		let result = new Map<string, Shape>()
		for (let [key] of values) {
			if (!selected.has(key)) continue
			let shape = shown(key, values)
			if (shape) result.set(key, shape)
		}
		return result
	}
	function selectionBounds(values = view()) {
		return unionBounds([...selectedShapes(values).values()].map(shapeBounds))
	}
	function travels(key: string) {
		return selected.has(key)
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
		return unionBounds([...resolveDrawing(shapes()).values()].map(shapeBounds))
	}
	function visibleBounds(): Bounds {
		return {
			x: camera.x,
			y: camera.y,
			width: viewport.width / camera.zoom,
			height: viewport.height / camera.zoom,
		}
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
		let drafts = view()
		pruneSelection(drafts)
		paintShapes(values)
		paintDrafts(drafts)
		paintSelection(drafts)
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
		for (let key of selected) if (!values.has(key)) selected.delete(key)
		if (!selected.size) focusedGroup = undefined
	}
	function shapeGroup(attribute: string, key: string, shape: Shape) {
		let group = svg("g", { [attribute]: key })
		let transform = shapeTransform(shape)
		if (transform) group.setAttribute("transform", transform)
		group.append(shapeContent(shape, palette), hitArea(shape))
		return group
	}
	function paintShapes(values: Map<string, Shape>) {
		if (paintedFields === shapeFields) return
		paintedFields = shapeFields
		baseLayer.replaceChildren()
		groups.clear()
		hidden.clear()
		fading.clear()
		for (let [key, shape] of resolveDrawing(values)) {
			let group = shapeGroup("data-shape", key, shape)
			baseLayer.append(group)
			groups.set(key, group)
		}
	}
	// Drafts cover the shapes being changed and every arrow attached to them,
	// so arrows follow a dragged target before anything is saved.
	function paintDrafts(values: Map<string, Shape>) {
		let changed = new Set([...pending.keys(), ...overlay.keys()])
		let drafts = new Set([...changed, ...boundArrows(values, changed)])
		if (editing) drafts.add(editing.key)
		for (let key of hidden)
			if (!drafts.has(key)) groups.get(key)?.removeAttribute("display")
		for (let key of drafts) groups.get(key)?.setAttribute("display", "none")
		hidden = drafts
		let erasing = gesture?.kind === "erase" ? gesture.erased : new Set<string>()
		for (let key of fading)
			if (!erasing.has(key)) groups.get(key)?.removeAttribute("data-erasing")
		for (let key of erasing) groups.get(key)?.setAttribute("data-erasing", "")
		fading = new Set(erasing)
		draftLayer.replaceChildren()
		if (!drafts.size) return
		for (let key of values.keys()) {
			if (!drafts.has(key)) continue
			let shape = shown(key, values)
			if (!shape) continue
			if (key === editing?.key) {
				if (!editing.label) continue
				shape = { ...shape, text: "" }
			}
			draftLayer.append(shapeGroup("data-draft", key, shape))
		}
	}
	function hitArea(shape: Shape) {
		if (shape.kind === "text" || canFill(shape))
			return svg("rect", { ...localBounds(shape), class: "hit-area" })
		return svg("polyline", {
			points: shape.points.map(point => `${point.x},${point.y}`).join(" "),
			class: "hit-stroke",
		})
	}
	function paintSelection(values: Map<string, Shape>) {
		selectionLayer.replaceChildren()
		let scale = 1 / camera.zoom
		let target = bindingHint ? shown(bindingHint, values) : undefined
		if (target)
			selectionLayer.append(
				svg("polygon", {
					points: pointList(shapeCorners(target)),
					class: "binding-target",
				}),
			)
		for (let guide of guides)
			selectionLayer.append(
				svg(
					"line",
					guide.axis === "x"
						? { x1: guide.at, x2: guide.at, y1: guide.from, y2: guide.to }
						: { y1: guide.at, y2: guide.at, x1: guide.from, x2: guide.to },
				),
			)
		for (let line of selectionLayer.querySelectorAll("line"))
			line.setAttribute("class", "snap-guide")
		let shownShapes = selectedShapes(values)
		if (shownShapes.size > 1)
			for (let shape of shownShapes.values())
				selectionLayer.append(
					svg("polygon", {
						points: pointList(shapeCorners(shape)),
						class: "outline",
					}),
				)
		let handlesShown = session.writable() && !editing
		let [single] = shownShapes.size === 1 ? [...shownShapes.values()] : []
		if (gesture?.kind !== "draw" && single && isSegment(single)) {
			if (handlesShown)
				for (let terminal of terminals)
					selectionLayer.append(endpointHandle(single, terminal, scale, values))
		} else if (gesture?.kind !== "draw" && shownShapes.size) {
			let frame =
				single?.rotation && rotates(single)
					? svg("g", { transform: shapeTransform(single) ?? "" })
					: svg("g", {})
			let bounds = single?.rotation
				? localBounds(single)
				: unionBounds([...shownShapes.values()].map(shapeBounds))
			if (bounds) {
				let box = padded(bounds, 4 * scale)
				frame.append(svg("rect", { ...box, class: "selection" }))
				if (handlesShown) {
					for (let handle of handles)
						frame.append(handleElement(box, handle, scale))
					frame.append(rotateHandle(box, scale))
				}
				selectionLayer.append(frame)
			}
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
	function rotateHandle(box: Bounds, scale: number) {
		let x = box.x + box.width / 2,
			y = box.y - 22 * scale
		let group = svg("g", { "data-handle": "rotate" })
		group.append(
			svg("line", {
				x1: x,
				x2: x,
				y1: box.y,
				y2: y,
				class: "rotate-stem",
			}),
			svg("circle", { cx: x, cy: y, r: 11 * scale, class: "handle-reach" }),
			svg("circle", { cx: x, cy: y, r: 5 * scale, class: "rotate-handle" }),
		)
		return group
	}
	function endpointHandle(
		shape: Shape,
		terminal: Terminal,
		scale: number,
		values: Map<string, Shape>,
	) {
		let point =
			terminal === "start"
				? shape.points[0]
				: shape.points[shape.points.length - 1]
		let bound = shape[terminal] && values.has(shape[terminal]?.shape ?? "")
		let group = svg("g", { "data-handle": terminal })
		group.toggleAttribute("data-bound", Boolean(bound))
		group.append(
			svg("circle", {
				cx: point?.x ?? 0,
				cy: point?.y ?? 0,
				r: 12 * scale,
				class: "handle-reach",
			}),
			svg("circle", {
				cx: point?.x ?? 0,
				cy: point?.y ?? 0,
				r: 5 * scale,
				class: "endpoint-handle",
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
		let values = view()
		let chosen = [...selected]
			.map(key => values.get(key))
			.filter(shape => shape !== undefined)
		let visible =
			writable && (chosen.length > 0 || creationTools.includes(tool))
		stylePanel.hidden = !visible
		if (!visible) {
			if (arrangeMenu.isOpen()) arrangeMenu.close(false)
			return
		}
		let current = chosen[0] ? shapeStyle(chosen[0]) : style
		let kinds = chosen.length
			? chosen.map(shape => shape.kind)
			: [toolKind(tool)]
		element("[data-fill-styles]").hidden = !kinds.some(kind =>
			canFill({ kind }),
		)
		element("[data-dash-styles]").hidden = kinds.every(kind => kind === "text")
		element("[data-selection-actions]").hidden = chosen.length === 0
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
		let units = arrangeUnits(values).size
		for (let control of elements("[data-arrange]")) {
			let action = control.dataset.arrange
			let enabled =
				action === "horizontal" || action === "vertical"
					? units >= 3
					: action === "group"
						? chosen.length >= 2
						: action === "ungroup"
							? chosen.some(shape => shape.group)
							: action === "rotate" ||
								  action === "flip-horizontal" ||
								  action === "flip-vertical"
								? chosen.length > 0
								: units >= 2
			if (control instanceof HTMLButtonElement) control.disabled = !enabled
		}
	}

	function positionTextEditor() {
		if (!editing) return
		let shape = (editing.label && shown(editing.key)) || editing.shape
		let rotation = shape.rotation ?? 0
		textEditor.dataset.mode = editing.label ? "label" : "text"
		textEditor.style.fontFamily = drawingFont
		if (editing.label) {
			let center = worldToScreen(camera, toWorld(shape, labelCenter(shape)))
			let solid = shape.fill && shape.fill === shape.color
			textEditor.style.left = `${center.x}px`
			textEditor.style.top = `${center.y}px`
			textEditor.style.width = `${labelWidth(shape) * camera.zoom}px`
			textEditor.style.fontSize = `${labelSize(shape) * camera.zoom}px`
			textEditor.style.color = solid
				? contrastInk(palette.ink(shape.fill ?? shape.color))
				: palette.ink(shape.color)
			textEditor.style.transformOrigin = "50% 50%"
			textEditor.style.transform = `translate(-50%, -50%) rotate(${rotation}rad)`
			return
		}
		let anchor = shape.points[0] ?? { x: 0, y: 0 }
		let screen = worldToScreen(camera, anchor),
			size = textSize(shape) * camera.zoom,
			offset = (textLineHeight(shape) * camera.zoom - size) / 2
		textEditor.style.left = `${screen.x}px`
		textEditor.style.top = `${screen.y - offset}px`
		textEditor.style.width = ""
		textEditor.style.fontSize = `${size}px`
		textEditor.style.color = palette.ink(shape.color)
		textEditor.style.transformOrigin = `0 ${offset}px`
		textEditor.style.transform = rotation ? `rotate(${rotation}rad)` : ""
	}

	// A fallback history for sessions without document undo. It only reverts a
	// register still holding the value this view wrote, so it never rewinds a
	// collaborator's later edit.
	function apply(changes: Change[], backwards = false, settle?: () => void) {
		let fields = session.replica.fields(id)
		let values: [string, string][] = changes
			.filter(
				change =>
					(fields[change.key] ?? "") ===
					(backwards ? change.after : change.before),
			)
			.map(change => [change.key, backwards ? change.before : change.after])
		if (!values.length) {
			settle?.()
			paint()
			return
		}
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
		let unique = new Map(entries)
		for (let [key, shape] of unique) pending.set(key, shape)
		remember(
			[...unique].map(([key, shape]) => [
				key,
				shape ? JSON.stringify(shape) : "",
			]),
			() => {
				for (let [key, shape] of unique)
					if (pending.get(key) === shape) pending.delete(key)
			},
		)
	}
	function remove(keys: Iterable<string>) {
		let deleted = new Set(keys)
		commit([
			...[...deleted].map((key): [string, undefined] => [key, undefined]),
			...releaseArrows(view(), deleted),
		])
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
	function newGroup() {
		return `group:${Effect.runSync(session.uuid)}`
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
	// Grouped shapes are picked as one, unless the group was entered with a
	// double click.
	function members(key: string, values = view()) {
		let group = values.get(key)?.group
		if (!group || group === focusedGroup) return [key]
		return [...values]
			.filter(([, shape]) => shape.group === group)
			.map(([member]) => member)
	}
	function withGroups(keys: Iterable<string>, values = view()) {
		let result = new Set<string>()
		for (let key of keys)
			for (let member of members(key, values)) result.add(member)
		return result
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
		if (shape?.group && shape.group !== focusedGroup && tool === "select") {
			focusedGroup = shape.group
			select([key])
			paint()
			return
		}
		if (shape?.kind === "text") editText(key, shape)
		else if (shape && canLabel(shape) && tool === "select")
			editLabel(key, shape)
		else if (!key) editText(newKey(), newShape("text", point), true)
	}
	function drag(event: PointerEvent): Drag {
		return {
			pointerId: event.pointerId,
			down: localPoint(event),
			started: false,
		}
	}
	function beginSelection(event: PointerEvent, point: Point) {
		let handle =
			event.target instanceof Element
				? event.target.closest("[data-handle]")?.getAttribute("data-handle")
				: undefined
		let values = view()
		let originals = selectedShapes(values)
		let bounds = selectionBounds(values)
		if (
			handle &&
			bounds &&
			session.writable() &&
			beginHandle(event, handle, point, originals, bounds, values)
		)
			return
		let key = shapeKeyAt(event.target)
		if (key && values.get(key)?.group !== focusedGroup) focusedGroup = undefined
		let unit = key ? members(key, values) : []
		if (key && event.shiftKey) {
			let adding = !selected.has(key)
			for (let member of unit)
				if (adding) selected.add(member)
				else selected.delete(member)
		} else if (key && !selected.has(key)) select(unit)
		let insideSelection =
			!key && bounds && boundsContain(bounds, point) && !event.shiftKey
		if ((key || insideSelection) && selected.size && session.writable()) {
			let moving = selectedShapes(values)
			gesture = {
				...drag(event),
				kind: "move",
				from: point,
				bounds: selectionBounds(values) ?? { ...point, width: 1, height: 1 },
				originals: moving,
				targets: snapTargets(values),
			}
		} else if (!key && !insideSelection) {
			if (!event.shiftKey) {
				selected.clear()
				focusedGroup = undefined
			}
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
	function beginHandle(
		event: PointerEvent,
		handle: string,
		point: Point,
		originals: Map<string, Shape>,
		bounds: Bounds,
		values: Map<string, Shape>,
	) {
		let [single] = originals.size === 1 ? [...originals] : []
		if (handle === "rotate") {
			let center = single ? shapeCenter(single[1]) : boundsCenter(bounds)
			gesture = {
				...drag(event),
				kind: "rotate",
				center,
				from: Math.atan2(point.y - center.y, point.x - center.x),
				base:
					single && rotates(single[1]) ? (single[1].rotation ?? 0) : undefined,
				originals,
			}
			return true
		}
		if ((handle === "start" || handle === "end") && single) {
			gesture = {
				...drag(event),
				kind: "endpoint",
				key: single[0],
				terminal: handle,
				original: single[1],
			}
			return true
		}
		let resize = handles.find(value => value === handle)
		if (!resize) return false
		gesture = {
			...drag(event),
			kind: "resize",
			handle: resize,
			from: point,
			bounds,
			originals,
			targets: snapTargets(values),
		}
		return true
	}
	// Other shapes in view, as the edges a moving selection can snap to.
	function snapTargets(values: Map<string, Shape>) {
		let area = padded(visibleBounds(), 200 / camera.zoom)
		let targets: Bounds[] = []
		for (let [key, shape] of values) {
			if (selected.has(key) || shape.kind === "arrow") continue
			let box = shapeBounds(shape)
			if (boundsIntersect(box, area)) targets.push(box)
		}
		return targets
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
		if (kind === "pen") {
			shape.points = [point]
			if (event.pointerType === "pen") shape.pressure = [pressureOf(event)]
		}
		let key = newKey()
		if (kind === "arrow" && !(event.metaKey || event.ctrlKey)) {
			let start = bindingAt(view(), point, { precise: event.altKey })
			if (start) shape.start = start
		}
		gesture = {
			kind: "draw",
			pointerId: event.pointerId,
			key,
			shape,
			from: localPoint(event),
		}
		overlay.set(key, shape)
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
		pointer = point
		presence.move(point)
		if (gesture?.kind === "pinch") {
			pinch(gesture)
			return
		}
		if (!gesture || gesture.pointerId !== event.pointerId) return
		if ("started" in gesture && !gesture.started) {
			let screen = localPoint(event)
			if (distance(screen, gesture.down) < 3) return
			gesture.started = true
		}
		if (gesture.kind === "pan") {
			let next = localPoint(event)
			camera = panBy(camera, {
				x: next.x - gesture.last.x,
				y: next.y - gesture.last.y,
			})
			gesture.last = next
		} else if (gesture.kind === "draw") draw(gesture, event, point)
		else if (gesture.kind === "move") move(gesture, point, event)
		else if (gesture.kind === "resize") resize(gesture, point, event)
		else if (gesture.kind === "rotate") rotate(gesture, point, event.shiftKey)
		else if (gesture.kind === "endpoint") moveEndpoint(gesture, point, event)
		else if (gesture.kind === "marquee") {
			gesture.to = point
			let area = boundsFromCorners(gesture.from, point)
			let values = view()
			select([
				...gesture.base,
				...withGroups(shapesInBounds(resolveDrawing(values), area), values),
			])
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
				) {
					shape.points.push(next)
					shape.pressure?.push(pressureOf(sample))
				}
			}
		} else {
			let start = shape.points[0] ?? point
			let end = event.shiftKey ? constrain(shape.kind, start, point) : point
			shape.points = [start, end]
			if (shape.kind === "arrow") {
				let binding =
					event.metaKey || event.ctrlKey
						? undefined
						: bindingAt(view(), end, {
								exclude: new Set(
									[current.key, shape.start?.shape ?? ""].filter(Boolean),
								),
								precise: event.altKey,
							})
				if (binding) shape.end = binding
				else delete shape.end
				bindingHint = binding?.shape
			}
		}
		current.shape = { ...shape }
		overlay.set(current.key, current.shape)
	}
	function move(
		current: Extract<Gesture, { kind: "move" }>,
		point: Point,
		event: PointerEvent,
	) {
		let delta = { x: point.x - current.from.x, y: point.y - current.from.y }
		let axis: "x" | "y" | undefined
		if (event.shiftKey) {
			axis = Math.abs(delta.x) > Math.abs(delta.y) ? "x" : "y"
			if (axis === "x") delta.y = 0
			else delta.x = 0
		}
		guides = []
		if (!(event.metaKey || event.ctrlKey)) {
			let moved = {
				...current.bounds,
				x: current.bounds.x + delta.x,
				y: current.bounds.y + delta.y,
			}
			let snap = snapBounds(moved, current.targets, 8 / camera.zoom, {
				x: axis === "y" ? [] : [0, 0.5, 1],
				y: axis === "x" ? [] : [0, 0.5, 1],
			})
			delta = { x: delta.x + snap.offset.x, y: delta.y + snap.offset.y }
			guides = snap.guides
		}
		for (let [key, shape] of current.originals)
			overlay.set(key, keepBindings(translateShape(shape, delta), travels))
	}
	function resize(
		current: Extract<Gesture, { kind: "resize" }>,
		point: Point,
		event: PointerEvent,
	) {
		let delta = { x: point.x - current.from.x, y: point.y - current.from.y }
		let originals = [...current.originals]
		let texts = originals.some(([, shape]) => shape.kind === "text")
		let [single] = originals.length === 1 ? originals : []
		guides = []
		if (single?.[1].rotation) {
			overlay.set(
				single[0],
				resizeRotatedShape(
					single[1],
					current.handle,
					delta,
					event.shiftKey || texts,
				),
			)
			return
		}
		// A turned shape cannot stretch along page axes, so a selection holding
		// one scales uniformly.
		let keepAspect =
			event.shiftKey || texts || originals.some(([, shape]) => shape.rotation)
		let next = resizeBounds(current.bounds, current.handle, delta, keepAspect)
		if (!keepAspect && !(event.metaKey || event.ctrlKey)) {
			let snap = snapBounds(next, current.targets, 8 / camera.zoom, {
				x: current.handle.includes("w")
					? [0]
					: current.handle.includes("e")
						? [1]
						: [],
				y: current.handle.includes("n")
					? [0]
					: current.handle.includes("s")
						? [1]
						: [],
			})
			next = resizeBounds(
				current.bounds,
				current.handle,
				{ x: delta.x + snap.offset.x, y: delta.y + snap.offset.y },
				false,
			)
			guides = snap.guides
		}
		for (let [key, shape] of originals)
			overlay.set(
				key,
				keepBindings(scaleShape(shape, current.bounds, next), travels),
			)
	}
	function rotate(
		current: Extract<Gesture, { kind: "rotate" }>,
		point: Point,
		snapping: boolean,
	) {
		let angle =
			Math.atan2(point.y - current.center.y, point.x - current.center.x) -
			current.from
		if (snapping)
			angle =
				current.base === undefined
					? Math.round(angle / rotationStep) * rotationStep
					: Math.round((current.base + angle) / rotationStep) * rotationStep -
						current.base
		for (let [key, shape] of current.originals)
			overlay.set(
				key,
				keepBindings(rotateShape(shape, current.center, angle), travels),
			)
	}
	function moveEndpoint(
		current: Extract<Gesture, { kind: "endpoint" }>,
		point: Point,
		event: PointerEvent,
	) {
		let original = current.original
		let start = current.terminal === "start"
		let other =
			(start
				? original.points[original.points.length - 1]
				: original.points[0]) ?? point
		let next = event.shiftKey ? constrain("line", other, point) : point
		let shape: Shape = {
			...original,
			points: start ? [next, other] : [other, next],
		}
		delete shape[current.terminal]
		bindingHint = undefined
		if (original.kind === "arrow" && !(event.metaKey || event.ctrlKey)) {
			let opposite = original[start ? "end" : "start"]
			let binding = bindingAt(view(), next, {
				exclude: new Set([current.key, opposite?.shape ?? ""]),
				precise: event.altKey,
			})
			if (binding) {
				shape[current.terminal] = binding
				bindingHint = binding.shape
			}
		}
		overlay.set(current.key, shape)
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
		if (!gesture) {
			presence.move()
			pointer = undefined
		}
		if (event.pointerType === "touch") touches.delete(event.pointerId)
	}
	function finishGesture(current: Gesture, event: PointerEvent) {
		gesture = undefined
		guides = []
		bindingHint = undefined
		if (current.kind === "draw") finishDrawing(current, event)
		else if (
			current.kind === "move" ||
			current.kind === "resize" ||
			current.kind === "rotate"
		)
			commit([...overlay].filter(([key]) => current.originals.has(key)))
		else if (current.kind === "endpoint")
			commit([...overlay].filter(([key]) => key === current.key))
		else if (current.kind === "erase") remove(current.erased)
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
		if (shape.pressure && !hasPressure(shape.pressure)) {
			shape = { ...shape }
			delete shape.pressure
		}
		// Bound arrows also record where they were drawn, so a client that cannot
		// see the target, or a target deleted elsewhere, leaves them in place.
		if (shape.kind === "arrow") {
			let values = view()
			shape = {
				...shape,
				points: resolveArrow(shape, key =>
					key === current.key ? undefined : values.get(key),
				).points,
			}
		}
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
		guides = []
		bindingHint = undefined
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
		editing = { key, shape, created, label: false }
		select([key])
		textEditor.value = shape.text
		textEditor.hidden = false
		paint()
		textEditor.focus({ preventScroll: true })
		if (!created) textEditor.select()
	}
	function editLabel(key: string, shape: Shape) {
		cancelGesture()
		editing = { key, shape, created: false, label: true }
		select([key])
		textEditor.value = shape.text
		textEditor.hidden = false
		paint()
		textEditor.focus({ preventScroll: true })
		textEditor.select()
	}
	function editSelected() {
		let [key] = selected
		let shape = key && selected.size === 1 ? currentShape(key) : undefined
		if (!key || !shape) return
		if (shape.kind === "text") editText(key, shape)
		else if (canLabel(shape)) editLabel(key, shape)
	}
	// Text commits onto the shape's latest register, so a collaborator who
	// moved or restyled it while this view was typing keeps that change.
	function commitText() {
		let current = editing
		if (!current) return
		editing = undefined
		let text = textEditor.value.replace(/\s+$/, "")
		textEditor.hidden = true
		textEditor.value = ""
		let latest = current.created ? current.shape : currentShape(current.key)
		if (current.label) {
			if (latest && text !== latest.text)
				commit([[current.key, { ...latest, text }]])
		} else if (!text && current.created) selected.delete(current.key)
		else if (!text) remove([current.key])
		else if (latest && (text !== latest.text || current.created))
			commit([[current.key, { ...latest, text }]])
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
	textEditor.oninput = () => positionTextEditor()

	function styleSelection(change: (shape: Shape) => Shape) {
		commit(
			[...selected].flatMap(key => {
				let shape = currentShape(key)
				return shape ? [[key, change(shape)]] : []
			}),
		)
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
		remove(selected)
		selected.clear()
		paint()
	}
	function orderedSelection(values = view()): [string, Shape][] {
		return [...selectedShapes(values)]
	}
	// New shapes from the clipboard or a duplicate land above everything, with
	// fresh keys and groups, as one action.
	function place(entries: DrawingEntry[], offset: Point) {
		let placed: [string, Shape][] = rekeyShapes(
			entries.map(entry => ({
				id: entry.id,
				shape: translateShape(entry.shape, offset),
			})),
			newKey,
			newGroup,
		).map(([key, shape], index) => [key, { ...shape, order: nextOrder(index) }])
		commit(placed)
		tool = "select"
		focusedGroup = undefined
		select(placed.map(([key]) => key))
		paint()
		return placed
	}
	function duplicateSelection() {
		place(
			orderedSelection().map(([id, shape]) => ({ id, shape })),
			{ x: 24, y: 24 },
		)
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
			[...shapes()]
				.filter(([key]) => selected.has(key))
				.flatMap(([key], index) => {
					let shape = currentShape(key)
					return shape ? [[key, { ...shape, order: order(shape, index) }]] : []
				}),
		)
		paint()
	}
	function transformSelection(change: (shape: Shape, center: Point) => Shape) {
		let values = view()
		let center = boundsCenter(
			selectionBounds(values) ?? { x: 0, y: 0, width: 0, height: 0 },
		)
		commit(
			orderedSelection(values).map(([key, shape]) => [
				key,
				keepBindings(change(shape, center), travels),
			]),
		)
		paint()
	}
	function nudge(delta: Point) {
		transformSelection(shape => translateShape(shape, delta))
	}
	// The things that line up: a group moves as one, and an arrow whose ends
	// are both held by selected shapes simply follows them.
	function arrangeUnits(values = view()) {
		let units = new Map<string, { keys: string[]; bounds: Bounds[] }>()
		function held(binding: Shape["start"]) {
			return Boolean(
				binding && selected.has(binding.shape) && values.has(binding.shape),
			)
		}
		for (let [key, shape] of selectedShapes(values)) {
			if (shape.kind === "arrow" && held(shape.start) && held(shape.end))
				continue
			let unit = shape.group ?? key
			let entry = units.get(unit) ?? { keys: [], bounds: [] }
			entry.keys.push(key)
			entry.bounds.push(shapeBounds(shape))
			units.set(unit, entry)
		}
		return units
	}
	function arrange(action: ArrangeAction) {
		if (!session.writable() || !selected.size) return
		if (action === "group") return groupSelection()
		if (action === "ungroup") return ungroupSelection()
		if (action === "rotate")
			return transformSelection((shape, center) =>
				rotateShape(shape, center, Math.PI / 2),
			)
		if (action === "flip-horizontal" || action === "flip-vertical")
			return transformSelection((shape, center) =>
				flipShape(
					shape,
					center,
					action === "flip-horizontal" ? "horizontal" : "vertical",
				),
			)
		let values = view()
		let units = arrangeUnits(values)
		let boxes = new Map<string, Bounds>()
		for (let [unit, entry] of units) {
			let box = unionBounds(entry.bounds)
			if (box) boxes.set(unit, box)
		}
		let offsets =
			action === "horizontal" || action === "vertical"
				? distributionOffsets(boxes, action)
				: alignmentOffsets(boxes, action)
		let shownShapes = selectedShapes(values)
		commit(
			[...offsets].flatMap(([unit, offset]) =>
				(units.get(unit)?.keys ?? []).flatMap((key): [string, Shape][] => {
					let shape = shownShapes.get(key)
					return shape
						? [[key, keepBindings(translateShape(shape, offset), travels)]]
						: []
				}),
			),
		)
		paint()
	}
	function groupSelection() {
		if (selected.size < 2) return
		let group = newGroup()
		styleSelection(shape => ({ ...shape, group }))
		focusedGroup = undefined
	}
	function ungroupSelection() {
		styleSelection(shape => {
			let next = { ...shape }
			delete next.group
			return next
		})
		focusedGroup = undefined
	}
	function selectAll() {
		tool = "select"
		focusedGroup = undefined
		select(shapes().keys())
		paint()
	}
	function clearBoard() {
		commit([...shapes().keys()].map(key => [key, undefined]))
		selected.clear()
		paint()
	}

	// The clipboard belongs to the board only while the board has focus and no
	// text field does; everywhere else the page keeps its usual behaviour.
	function ownsClipboard() {
		let active = document.activeElement
		return (
			dialog.open &&
			!editing &&
			active instanceof Element &&
			root.contains(active) &&
			!isFormField(active)
		)
	}
	function copySelection(event: ClipboardEvent, cut: boolean) {
		let data = event.clipboardData
		if (!data || !ownsClipboard() || !selected.size) return
		let values = view()
		let entries = orderedSelection(values)
		let payload = JSON.stringify(drawingDocument(entries))
		data.setData(drawingClipboardType, payload)
		data.setData("text/html", clipboardMarkup(entries, payload))
		let text = clipboardText(entries.map(([, shape]) => shape))
		if (text) data.setData("text/plain", text)
		event.preventDefault()
		clipboardSource = { payload, count: cut ? -1 : 0 }
		if (cut && session.writable()) deleteSelection()
	}
	function clipboardMarkup(entries: [string, Shape][], payload: string) {
		let image = document.createElement("img")
		image.alt = clipboardText(entries.map(([, shape]) => shape)) || "Drawing"
		image.src =
			"data:image/svg+xml;charset=utf-8," +
			encodeURIComponent(drawingImage(new Map(entries)))
		image.dataset.alkalyeDrawing = payload
		return image.outerHTML
	}
	function pasteClipboard(event: ClipboardEvent) {
		let data = event.clipboardData
		if (!data || !ownsClipboard() || !session.writable()) return
		let payload =
			data.getData(drawingClipboardType) ||
			embeddedDrawing(data.getData("text/html"))
		let text = data.getData("text/plain")
		let source = payload || (/^\s*\{/.test(text) ? text : "")
		let entries = source
			? clipboardEntries(source, Boolean(payload))
			: undefined
		if (entries?.length) {
			event.preventDefault()
			pasteEntries(entries, source)
		} else if (text.trim()) {
			event.preventDefault()
			pasteText(text)
		}
	}
	function clipboardEntries(source: string, required: boolean) {
		try {
			return importDrawingEntries(JSON.parse(source))
		} catch (error) {
			if (required) options.report(error)
			return undefined
		}
	}
	// Repeated pastes of one copy step down and right, so each stays visible; a
	// cut or a copy from elsewhere lands where it was, or mid-screen when that
	// place is out of view.
	function pasteEntries(entries: DrawingEntry[], payload: string) {
		let count =
			(clipboardSource.payload === payload ? clipboardSource.count : -1) + 1
		clipboardSource = { payload, count }
		let bounds = unionBounds(entries.map(entry => shapeBounds(entry.shape)))
		let visible = visibleBounds()
		let offset =
			!bounds || boundsIntersect(bounds, visible)
				? { x: 24 * count, y: 24 * count }
				: {
						x: visible.x + visible.width / 2 - bounds.x - bounds.width / 2,
						y: visible.y + visible.height / 2 - bounds.y - bounds.height / 2,
					}
		place(entries, offset)
	}
	function pasteText(text: string) {
		let visible = visibleBounds()
		let at = pointer ?? {
			x: visible.x + visible.width / 2,
			y: visible.y + visible.height / 2,
		}
		let shape = { ...newShape("text", at), text: text.slice(0, 2000) }
		shape.points = [at]
		place([{ id: "paste", shape }], { x: 0, y: 0 })
	}

	function download(file: Blob, name: string) {
		let url = URL.createObjectURL(file),
			link = document.createElement("a")
		link.href = url
		link.download = name
		link.click()
		setTimeout(() => URL.revokeObjectURL(url), 1000)
	}
	// Exports keep register keys, so arrows stay attached when the file comes
	// back, and record where bound arrows currently point.
	function exportDrawing() {
		download(
			new Blob(
				[JSON.stringify(drawingDocument(resolveDrawing(shapes())), null, 2)],
				{ type: "application/json" },
			),
			"drawing.alkalye-drawing.json",
		)
	}
	function exportImage() {
		download(
			new Blob([drawingImage(shapes())], { type: "image/svg+xml" }),
			"drawing.svg",
		)
	}
	function importFile() {
		let file = drawingInput.files?.[0]
		drawingInput.value = ""
		if (!file) return
		queue(async () => {
			let entries = importDrawingEntries(JSON.parse(await file.text()))
			let imported = place(entries, { x: 0, y: 0 })
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
	let arrangeMenu = connectPopover(arrangeTrigger, arrangePanel, signal, {
		items: () => elements("[data-arrange]"),
		side: "bottom",
		align: "end",
	})
	for (let item of elements("[data-arrange]"))
		item.onclick = () => {
			let action = arrangeChoices.find(
				([value]) => value === item.dataset.arrange,
			)?.[0]
			if (action) arrange(action)
		}

	function handleKey(event: KeyboardEvent) {
		if (
			event.defaultPrevented ||
			event.isComposing ||
			isFormField(event.target)
		)
			return
		if (
			event.target instanceof Node &&
			((menu.open && itemsPanel.contains(event.target)) ||
				arrangePanel.contains(event.target))
		)
			return
		let handled = handleShortcut(event)
		if (handled) event.preventDefault()
	}
	function handleShortcut(event: KeyboardEvent) {
		let key = event.key.toLowerCase()
		let writable = session.writable()
		if (event.metaKey || event.ctrlKey) return commandShortcut(event, key)
		if (event.altKey) {
			if (!writable || !selected.size) return false
			if (event.shiftKey && event.code === "KeyH")
				return handled(() => arrange("horizontal"))
			if (event.shiftKey && event.code === "KeyV")
				return handled(() => arrange("vertical"))
			let alignment = alignKeys[event.code]
			if (alignment && !event.shiftKey) return handled(() => arrange(alignment))
			return false
		}
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
		if (writable && selected.size) {
			if (key === "delete" || key === "backspace")
				return handled(deleteSelection)
			if (key === "]") return handled(bringToFront)
			if (key === "[") return handled(sendToBack)
			if (key === "enter" && !(event.target instanceof HTMLButtonElement))
				return handled(editSelected)
			if (event.shiftKey && event.code === "KeyH")
				return handled(() => arrange("flip-horizontal"))
			if (event.shiftKey && event.code === "KeyV")
				return handled(() => arrange("flip-vertical"))
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
		let writable = session.writable()
		if (key === "z") return handled(() => travel(!event.shiftKey))
		if (key === "y") return handled(() => travel(false))
		if (key === "a") return handled(selectAll)
		if (key === "d" && selected.size && writable)
			return handled(duplicateSelection)
		if (key === "g" && selected.size && writable)
			return handled(() => arrange(event.shiftKey ? "ungroup" : "group"))
		return false
	}
	function escape() {
		if (menu.open) closeMenu()
		else if (arrangeMenu.isOpen()) arrangeMenu.close()
		else if (gesture) cancelGesture()
		else if (focusedGroup) {
			let group = focusedGroup
			focusedGroup = undefined
			select(
				[...view()]
					.filter(([, shape]) => shape.group === group)
					.map(([key]) => key),
			)
		} else if (selected.size) selected.clear()
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
	// Clipboard events target the document body when nothing is selected, so
	// they are observed there and claimed only by `ownsClipboard`.
	document.addEventListener("copy", event => copySelection(event, false), {
		signal,
	})
	document.addEventListener("cut", event => copySelection(event, true), {
		signal,
	})
	document.addEventListener("paste", pasteClipboard, { signal })
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
			appearance.disconnect()
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

function isSegment(shape: Shape) {
	return (
		(shape.kind === "arrow" || shape.kind === "line") &&
		shape.points.length === 2
	)
}

// Mice report a constant half pressure; only pens are read.
function pressureOf(event: PointerEvent) {
	return Math.round(Math.min(1, Math.max(0, event.pressure)) * 1000) / 1000
}

// Shift snaps lines to 15° steps and boxes to squares and circles.
function constrain(kind: Shape["kind"], start: Point, point: Point): Point {
	let dx = point.x - start.x,
		dy = point.y - start.y
	if (kind === "line" || kind === "arrow") {
		let angle = Math.round(Math.atan2(dy, dx) / rotationStep) * rotationStep,
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

function pointList(points: readonly Point[]) {
	return points.map(point => `${point.x},${point.y}`).join(" ")
}

function distance(first: Point, second: Point) {
	return Math.hypot(second.x - first.x, second.y - first.y)
}

function midpoint(first: Point, second: Point): Point {
	return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }
}

function embeddedDrawing(markup: string) {
	if (!markup.includes("data-alkalye-drawing")) return ""
	let parsed = new DOMParser().parseFromString(markup, "text/html")
	return (
		parsed
			.querySelector("[data-alkalye-drawing]")
			?.getAttribute("data-alkalye-drawing") ?? ""
	)
}

function isFormField(target: EventTarget | null) {
	return (
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		target instanceof HTMLSelectElement ||
		(target instanceof HTMLElement && target.isContentEditable)
	)
}
