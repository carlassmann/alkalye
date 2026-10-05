import { assert, browser, evaluate, wait } from "./browser-driver"

// Drawing affordances beyond basic shapes, exercised with real pointer input
// on a fresh board: snapping, bound arrows, labels, rotation, endpoints, the
// native clipboard, arranging, groups, pen pressure and a dark canvas. Escape
// closes the board once nothing is selected, so it is only pressed to clear a
// selection.

// Saved, with no draft still drawn over the committed shapes.
let saved =
	'document.querySelector("#save-status").textContent === "Saved" && document.querySelector("#whiteboard [data-drafts]").childElementCount === 0'
let shapeCount = 'document.querySelectorAll("#whiteboard [data-shape]").length'
let rectangles = `[...document.querySelectorAll("#whiteboard [data-shape]")].filter(group => group.querySelector(":scope > rect:not(.hit-area), :scope > g > rect:first-child"))`
let arrows = `[...document.querySelectorAll("#whiteboard [data-shape]")].filter(group => group.querySelector(":scope > g > polyline + polyline"))`

interface Point {
	x: number
	y: number
}
interface Box extends Point {
	width: number
	height: number
}

export function verifyWhiteboardParity(session: string) {
	evaluate(session, 'document.querySelector("#dialog").close();true')
	wait(session, '!document.querySelector("#dialog").open')
	browser(session, "click", '[data-action="tools"]')
	browser(session, "click", '[data-action="new-whiteboard"]')
	wait(
		session,
		`document.querySelector("#whiteboard") !== null && ${shapeCount} === 0`,
	)
	evaluate(
		session,
		'window.boardErrors = []; addEventListener("error", event => boardErrors.push(String(event.message))); addEventListener("unhandledrejection", event => boardErrors.push(String(event.reason)))',
	)

	browser(session, "press", "r")
	drag(session, canvas(session, 0.2, 0.25), canvas(session, 0.35, 0.45))
	wait(session, `${shapeCount} === 1 && ${saved}`)
	browser(session, "press", "r")
	drag(session, canvas(session, 0.6, 0.25), canvas(session, 0.75, 0.45))
	wait(session, `${shapeCount} === 2 && ${saved}`)
	browser(session, "press", "r")
	drag(session, canvas(session, 0.45, 0.6), canvas(session, 0.55, 0.75))
	wait(session, `${shapeCount} === 3 && ${saved}`)

	let first = rectangle(session, 0),
		third = rectangle(session, 2)
	let grip = screen(session, centre(third))
	let target = {
		x: grip.x + (first.x - third.x) + 4,
		y: grip.y + 40,
	}
	browser(session, "mouse", "move", String(grip.x), String(grip.y))
	browser(session, "mouse", "down")
	for (let step of [0.3, 0.6, 1])
		browser(
			session,
			"mouse",
			"move",
			String(Math.round(grip.x + (target.x - grip.x) * step)),
			String(Math.round(grip.y + (target.y - grip.y) * step)),
		)
	assert(
		Number(
			evaluate(session, 'document.querySelectorAll(".snap-guide").length'),
		) > 0,
		"dragging near another shape's edge shows a snapping guide",
	)
	browser(session, "mouse", "up")
	wait(session, saved)
	assert(
		Math.abs(rectangle(session, 2).x - first.x) < 1e-6 &&
			Number(
				evaluate(session, 'document.querySelectorAll(".snap-guide").length'),
			) === 0,
		"dropping snaps the edge exactly and clears the guide",
	)

	let second = rectangle(session, 1)
	browser(session, "press", "a")
	drag(session, screen(session, centre(first)), screen(session, centre(second)))
	wait(session, `${shapeCount} === 4 && ${saved}`)
	let [start, end] = arrowPoints(session, 0)
	assert(
		Math.abs((start?.x ?? 0) - (first.x + first.width + 4)) < 1 &&
			Math.abs((end?.x ?? 0) - (second.x - 4)) < 1 &&
			Number(
				evaluate(
					session,
					'document.querySelectorAll("[data-handle][data-bound]").length',
				),
			) === 2,
		"an arrow drawn between two shapes binds to both and stops at their outlines",
	)

	browser(session, "press", "Escape")
	drag(
		session,
		screen(session, centre(second)),
		screen(session, { x: centre(second).x, y: centre(second).y + 150 }),
	)
	wait(session, saved)
	let followed = arrowPoints(session, 0)[1]
	assert(
		(followed?.y ?? 0) > (end?.y ?? 0) + 100 &&
			Math.abs((arrowPoints(session, 0)[0]?.x ?? 0) - (start?.x ?? 0)) < 30,
		"moving a target redraws the arrow attached to it",
	)
	browser(session, "press", "Control+z")
	wait(
		session,
		`Math.abs(${JSON.stringify(second.y)} - Number(${rectangles}[1].querySelector("rect").getAttribute("y"))) < 1e-6`,
	)
	assert(
		Math.abs((arrowPoints(session, 0)[1]?.y ?? 0) - (end?.y ?? 0)) < 1,
		"one undo returns the moved target and its arrow together",
	)
	browser(session, "press", "Control+Shift+z")
	wait(
		session,
		`Number(${rectangles}[1].querySelector("rect").getAttribute("y")) > ${second.y + 100}`,
	)
	second = rectangle(session, 1)

	evaluate(
		session,
		`(() => { document.querySelectorAll("[data-target]").forEach(node => node.removeAttribute("data-target")); ${rectangles}[0].querySelector(".hit-area").dataset.target = "" })()`,
	)
	browser(session, "dblclick", "#whiteboard [data-target]")
	wait(
		session,
		'!document.querySelector("#drawing-text").hidden && document.querySelector("#drawing-text").dataset.mode === "label"',
	)
	browser(session, "keyboard", "type", "Start")
	browser(session, "press", "Escape")
	wait(
		session,
		`${rectangles}[0].querySelector("[data-label] text")?.textContent === "Start" && ${saved}`,
	)
	assert(
		Number(evaluate(session, shapeCount)) === 4 &&
			evaluate(
				session,
				`${rectangles}[0].querySelector("[data-label] text").getAttribute("text-anchor") === "middle"`,
			),
		"double-clicking a shape types a centred label inside it, not a separate text",
	)

	clickAt(session, screen(session, centre(first)))
	let handle = point(
		session,
		'document.querySelector("[data-handle=rotate] .rotate-handle")',
	)
	let arrowBefore = arrowPoints(session, 0)[0]
	drag(session, handle, { x: handle.x + 160, y: handle.y + 90 })
	wait(session, saved)
	assert(
		/rotate\(/.test(
			String(
				evaluate(session, `${rectangles}[0].getAttribute("transform") ?? ""`),
			),
		) &&
			evaluate(
				session,
				'document.querySelector("[data-selection] g[transform] .selection") !== null',
			) &&
			distance(arrowPoints(session, 0)[0], arrowBefore) > 1,
		"the rotation handle turns a shape, its selection frame and the arrow attached to it",
	)
	let snapped = rotateWithShift(session)
	assert(
		Math.abs(snapped / 15 - Math.round(snapped / 15)) < 1e-6,
		`Shift snaps rotation to 15° steps (${snapped}°)`,
	)
	wait(session, saved)

	browser(session, "press", "Escape")
	let middle = midpoint(arrowPoints(session, 0))
	clickAt(session, screen(session, middle))
	wait(
		session,
		'document.querySelectorAll("[data-handle=start], [data-handle=end]").length === 2',
	)
	let tip = point(
		session,
		'document.querySelector("[data-handle=end] .endpoint-handle")',
	)
	let away = canvas(session, 0.45, 0.86)
	drag(session, tip, away)
	wait(session, saved)
	assert(
		evaluate(
			session,
			'document.querySelector("[data-handle=end]")?.hasAttribute("data-bound") === false',
		),
		"dragging an arrow's end off its target releases it",
	)
	drag(
		session,
		point(
			session,
			'document.querySelector("[data-handle=end] .endpoint-handle")',
		),
		screen(session, centre(second)),
	)
	wait(session, saved)
	assert(
		evaluate(
			session,
			'document.querySelector("[data-handle=end]")?.hasAttribute("data-bound") === true',
		),
		"dropping the end on a shape binds it again",
	)

	browser(session, "press", "Escape")
	clickAt(session, screen(session, centre(rectangle(session, 0))))
	let copied = copy(session, "copy")
	assert(
		copied.types.includes("application/x-alkalye-drawing") &&
			copied.html.includes("data-alkalye-drawing") &&
			copied.html.includes("data:image/svg+xml") &&
			copied.text === "Start",
		"copying writes the editable drawing, an image and the label text to the native clipboard",
	)
	paste(session, copied.data)
	wait(session, `${shapeCount} === 5 && ${saved}`)
	assert(
		evaluate(
			session,
			`(() => { let pasted = ${rectangles}[3]; return pasted.querySelector("[data-label] text")?.textContent === "Start" && /rotate\\(/.test(pasted.getAttribute("transform") ?? "") && document.querySelectorAll("[data-handle=rotate]").length === 1 })()`,
		) &&
			Math.abs(rectangle(session, 3).x - rectangle(session, 0).x - 24) < 1e-6,
		"pasting creates an editable, rotated, labelled copy offset from the original",
	)
	paste(session, copied.data)
	wait(session, `${shapeCount} === 6 && ${saved}`)
	assert(
		Math.abs(rectangle(session, 4).x - rectangle(session, 0).x - 48) < 1e-6,
		"pasting the same copy again steps further away",
	)
	let cut = copy(session, "cut")
	wait(session, `${shapeCount} === 5 && ${saved}`)
	paste(session, cut.data)
	wait(session, `${shapeCount} === 6 && ${saved}`)
	assert(
		Math.abs(rectangle(session, 4).x - rectangle(session, 0).x - 48) < 1e-6,
		"cutting removes the selection and pasting it lands in place",
	)
	paste(session, { "text/plain": "Plain note" })
	wait(
		session,
		`${shapeCount} === 7 && [...document.querySelectorAll("#whiteboard [data-shape] > text")].some(text => text.textContent === "Plain note") && ${saved}`,
	)
	assert(true, "pasting plain text creates a text shape")
	browser(session, "press", "Delete")
	wait(session, `${shapeCount} === 6 && ${saved}`)
	for (let index of [4, 3]) {
		clickAt(session, screen(session, centre(rectangle(session, index))))
		browser(session, "press", "Delete")
		wait(session, `${shapeCount} === ${index + 1} && ${saved}`)
	}
	evaluate(
		session,
		`(() => { document.querySelectorAll("[data-target]").forEach(node => node.removeAttribute("data-target")); ${rectangles}[0].querySelector(".hit-area").dataset.target = "" })()`,
	)
	browser(session, "dblclick", "#whiteboard [data-target]")
	wait(
		session,
		'document.activeElement === document.querySelector("#drawing-text")',
	)
	let typing = copy(session, "copy")
	browser(session, "press", "Escape")
	wait(session, `document.querySelector("#drawing-text").hidden && ${saved}`)
	assert(
		!typing.types.includes("application/x-alkalye-drawing"),
		"copying inside the label editor keeps the browser's own text clipboard",
	)

	browser(session, "press", "Escape")
	clickAt(session, screen(session, centre(rectangle(session, 0))))
	shiftClick(session, screen(session, centre(rectangle(session, 2))))
	browser(session, "click", "#arrange-shape")
	wait(
		session,
		'document.querySelector("#drawing-arrange").matches(":popover-open") && document.activeElement?.dataset.arrange === "left"',
	)
	browser(session, "press", "ArrowDown")
	assert(
		evaluate(session, 'document.activeElement?.dataset.arrange === "center"'),
		"the arrange menu uses the shared keyboard navigation",
	)
	browser(session, "press", "End")
	assert(
		evaluate(session, 'document.activeElement?.dataset.arrange === "group"') &&
			evaluate(
				session,
				'document.querySelector("[data-arrange=ungroup]").disabled && document.querySelector("[data-arrange=horizontal]").disabled',
			),
		"actions that do not apply to this selection are skipped",
	)
	browser(session, "press", "Escape")
	assert(
		!evaluate(
			session,
			'document.querySelector("#drawing-arrange").matches(":popover-open")',
		) &&
			evaluate(session, 'document.activeElement?.id === "arrange-shape"') &&
			evaluate(session, 'document.querySelector("#dialog").open'),
		"Escape closes the arrange menu and returns focus without closing the board",
	)
	browser(session, "click", "#arrange-shape")
	browser(session, "click", '[data-arrange="top"]')
	wait(session, saved)
	let tops = evaluate(
		session,
		`JSON.stringify([0, 2].map(index => ${rectangles}[index].getBBox && ${rectangles}[index].getBoundingClientRect().top))`,
	)
	let [topA, topC] = JSON.parse(String(tops))
	assert(Math.abs(topA - topC) < 3, "Align top lines the selection up")
	browser(session, "press", "Control+z")
	wait(session, saved)

	browser(session, "press", "Control+g")
	wait(session, saved)
	browser(session, "press", "Escape")
	clickAt(session, screen(session, centre(rectangle(session, 2))))
	assert(
		Number(
			evaluate(
				session,
				'document.querySelectorAll("[data-selection] .outline").length',
			),
		) === 2,
		"grouped shapes are selected together",
	)
	evaluate(
		session,
		`(() => { document.querySelectorAll("[data-target]").forEach(node => node.removeAttribute("data-target")); ${rectangles}[2].querySelector(".hit-area").dataset.target = "" })()`,
	)
	browser(session, "dblclick", "#whiteboard [data-target]")
	assert(
		Number(
			evaluate(
				session,
				'document.querySelectorAll("[data-selection] .outline").length',
			),
		) === 0 &&
			Number(
				evaluate(session, 'document.querySelectorAll("[data-handle]").length'),
			) > 0,
		"double-clicking enters the group and selects one member",
	)
	browser(session, "press", "Escape")
	assert(
		Number(
			evaluate(
				session,
				'document.querySelectorAll("[data-selection] .outline").length',
			),
		) === 2,
		"Escape leaves the group with the whole group selected",
	)
	browser(session, "press", "Control+Shift+g")
	wait(session, saved)
	browser(session, "press", "Escape")
	clickAt(session, screen(session, centre(rectangle(session, 2))))
	assert(
		Number(
			evaluate(
				session,
				'document.querySelectorAll("[data-selection] .outline").length',
			),
		) === 0,
		"ungrouping lets each shape be selected alone",
	)

	browser(session, "press", "Control+a")
	browser(session, "press", "Control+d")
	wait(session, `${shapeCount} === 8 && ${saved}`)
	let [original, copy2] = [arrowPoints(session, 0), arrowPoints(session, 1)]
	assert(
		Number(evaluate(session, `${arrows}.length`)) === 2 &&
			Math.abs((copy2[0]?.x ?? 0) - (original[0]?.x ?? 0) - 24) < 1 &&
			Math.abs((copy2[1]?.y ?? 0) - (original[1]?.y ?? 0) - 24) < 1,
		"duplicating shapes with their arrow keeps the copy attached to the copies",
	)
	browser(session, "press", "Control+z")
	wait(session, `${shapeCount} === 4 && ${saved}`)

	let attached = arrowPoints(session, 0)[1]
	clickAt(session, screen(session, centre(rectangle(session, 1))))
	browser(session, "press", "Delete")
	wait(session, `${shapeCount} === 3 && ${saved}`)
	assert(
		distance(arrowPoints(session, 0)[1], attached) < 1,
		"deleting a target leaves its arrow where it pointed",
	)
	browser(session, "press", "Control+z")
	wait(session, `${shapeCount} === 4 && ${saved}`)
	drag(
		session,
		screen(session, centre(rectangle(session, 1))),
		screen(session, {
			x: centre(rectangle(session, 1)).x,
			y: centre(rectangle(session, 1)).y - 120,
		}),
	)
	wait(session, saved)
	assert(
		(arrowPoints(session, 0)[1]?.y ?? 0) < (attached?.y ?? 0) - 60,
		"undoing the deletion re-attaches the arrow",
	)

	browser(session, "press", "d")
	evaluate(
		session,
		`(() => { let board = document.querySelector("#whiteboard"), rect = board.getBoundingClientRect(); let send = (type, index) => board.dispatchEvent(new PointerEvent(type, { pointerId: 41, pointerType: "pen", pressure: Math.min(1, 0.1 + index * 0.08), clientX: rect.left + 200 + index * 18, clientY: rect.top + rect.height * 0.85, bubbles: true, cancelable: true, button: 0, buttons: 1 })); send("pointerdown", 0); for (let index = 1; index <= 10; index++) send("pointermove", index); send("pointerup", 10) })()`,
	)
	wait(session, `${shapeCount} === 5 && ${saved}`)
	assert(
		evaluate(
			session,
			'(() => { let path = [...document.querySelectorAll("#whiteboard [data-shape] > path")].at(-1); return path.getAttribute("stroke") === "none" && path.getAttribute("fill") !== "none" && path.getAttribute("d").endsWith("Z") })()',
		),
		"a pen with pressure draws a filled stroke that swells with pressure",
	)
	drag(session, canvas(session, 0.7, 0.85), canvas(session, 0.85, 0.9))
	wait(session, `${shapeCount} === 6 && ${saved}`)
	assert(
		evaluate(
			session,
			'(() => { let path = [...document.querySelectorAll("#whiteboard [data-shape] > path")].at(-1); return path.getAttribute("fill") === "none" && path.getAttribute("stroke") !== "none" })()',
		),
		"a mouse keeps drawing an even stroke",
	)

	let appearance = evaluate(
		session,
		'document.documentElement.getAttribute("data-appearance") ?? ""',
	)
	evaluate(session, 'document.documentElement.dataset.appearance = "dark"')
	wait(
		session,
		'document.querySelector("[data-whiteboard]").dataset.ink === "dark"',
	)
	assert(
		evaluate(
			session,
			`(() => { let stroke = ${rectangles}[0].querySelector("rect").getAttribute("stroke"); let canvas = getComputedStyle(document.querySelector(".whiteboard-stage")).backgroundColor; let swatch = document.querySelector('[data-color="#1d1d1d"]').style.getPropertyValue("--swatch"); return stroke === "#f2f2f2" && canvas === "rgb(16, 16, 17)" && swatch === "#f2f2f2" })()`,
		),
		"a dark page shows a dark canvas with light ink and matching swatches",
	)
	browser(session, "screenshot", "/tmp/alkalye-whiteboard-dark.png")
	evaluate(
		session,
		appearance
			? `document.documentElement.dataset.appearance = ${JSON.stringify(appearance)}`
			: 'document.documentElement.removeAttribute("data-appearance")',
	)
	wait(
		session,
		'document.querySelector("[data-whiteboard]").dataset.ink === "light"',
	)
	assert(
		evaluate(
			session,
			`${rectangles}[0].querySelector("rect").getAttribute("stroke") === "#1d1d1d"`,
		),
		"returning to a light page restores the stored ink colours",
	)
	browser(session, "screenshot", "/tmp/alkalye-whiteboard-parity.png")
	assert(
		evaluate(session, "JSON.stringify(boardErrors)") === "[]",
		"the board raised no errors",
	)
}

function canvas(session: string, x: number, y: number): Point {
	return parse(
		evaluate(
			session,
			`(() => { let rect = document.querySelector("#whiteboard").getBoundingClientRect(); return JSON.stringify({ x: Math.round(rect.left + rect.width * ${x}), y: Math.round(rect.top + rect.height * ${y}) }) })()`,
		),
	)
}
// World coordinates to page pixels through the canvas's current viewBox.
function screen(session: string, world: Point): Point {
	return parse(
		evaluate(
			session,
			`(() => { let board = document.querySelector("#whiteboard"), rect = board.getBoundingClientRect(), [x, y, width] = board.getAttribute("viewBox").split(" ").map(Number), zoom = rect.width / width; return JSON.stringify({ x: Math.round(rect.left + (${world.x} - x) * zoom), y: Math.round(rect.top + (${world.y} - y) * zoom) }) })()`,
		),
	)
}
function point(session: string, element: string): Point {
	return parse(
		evaluate(
			session,
			`(() => { let rect = (${element}).getBoundingClientRect(); return JSON.stringify({ x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) }) })()`,
		),
	)
}
function rectangle(session: string, index: number): Box {
	let value = JSON.parse(
		String(
			evaluate(
				session,
				`(() => { let rect = ${rectangles}[${index}].querySelector("rect"); return JSON.stringify(["x", "y", "width", "height"].map(name => Number(rect.getAttribute(name)))) })()`,
			),
		),
	)
	let [x = 0, y = 0, width = 0, height = 0] = Array.isArray(value)
		? value.map(Number)
		: []
	return { x, y, width, height }
}
function arrowPoints(session: string, index: number): Point[] {
	let value = String(
		evaluate(
			session,
			`${arrows}[${index}].querySelector("polyline").getAttribute("points")`,
		),
	)
	return value.split(" ").map(pair => {
		let [x = 0, y = 0] = pair.split(",").map(Number)
		return { x, y }
	})
}
function centre(box: Box): Point {
	return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}
function midpoint(points: Point[]): Point {
	let [first = { x: 0, y: 0 }, last = first] = [points[0], points.at(-1)]
	return { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 }
}
function distance(first: Point | undefined, second: Point | undefined) {
	if (!first || !second) return Infinity
	return Math.hypot(first.x - second.x, first.y - second.y)
}
function parse(value: unknown): Point {
	let parsed: unknown = JSON.parse(String(value))
	if (
		!parsed ||
		typeof parsed !== "object" ||
		!("x" in parsed) ||
		!("y" in parsed) ||
		typeof parsed.x !== "number" ||
		typeof parsed.y !== "number"
	)
		throw new Error("Expected a point")
	return { x: parsed.x, y: parsed.y }
}
function drag(session: string, from: Point, to: Point) {
	browser(session, "mouse", "move", String(from.x), String(from.y))
	browser(session, "mouse", "down")
	for (let step of [0.25, 0.5, 0.75, 1])
		browser(
			session,
			"mouse",
			"move",
			String(Math.round(from.x + (to.x - from.x) * step)),
			String(Math.round(from.y + (to.y - from.y) * step)),
		)
	browser(session, "mouse", "up")
}
function clickAt(session: string, at: Point) {
	browser(session, "mouse", "move", String(at.x), String(at.y))
	browser(session, "mouse", "down")
	browser(session, "mouse", "up")
}
// agent-browser cannot hold modifier keys during pointer input, so these
// gestures dispatch the browser's own pointer events with the modifier set.
// Moves go to the canvas, as pointer capture would send them.
function shiftClick(session: string, at: Point) {
	evaluate(
		session,
		`(() => { let target = document.elementFromPoint(${at.x}, ${at.y}); for (let type of ["pointerdown", "pointerup"]) target.dispatchEvent(new PointerEvent(type, { pointerId: 51, pointerType: "mouse", clientX: ${at.x}, clientY: ${at.y}, button: 0, buttons: type === "pointerdown" ? 1 : 0, shiftKey: true, bubbles: true, cancelable: true })) })()`,
	)
}
function rotateWithShift(session: string) {
	evaluate(
		session,
		`(() => { let handle = document.querySelector("[data-handle=rotate] .rotate-handle"), box = handle.getBoundingClientRect(), x = box.left + box.width / 2, y = box.top + box.height / 2; let board = document.querySelector("#whiteboard"); let send = (type, dx, dy) => (type === "pointerdown" ? handle : board).dispatchEvent(new PointerEvent(type, { pointerId: 52, pointerType: "mouse", clientX: x + dx, clientY: y + dy, button: 0, buttons: type === "pointerup" ? 0 : 1, shiftKey: true, bubbles: true, cancelable: true })); send("pointerdown", 0, 0); send("pointermove", 37, 11); send("pointermove", 73, 29); send("pointerup", 73, 29) })()`,
	)
	wait(session, saved)
	let match = /rotate\(([-\d.e]+)/.exec(
		String(
			evaluate(session, `${rectangles}[0].getAttribute("transform") ?? ""`),
		),
	)
	return match ? Number(match[1]) : NaN
}
// Copies through the browser's own command, which raises a trusted clipboard
// event, and records what the board wrote while the event was dispatched.
function copy(session: string, command: "copy" | "cut") {
	let value = JSON.parse(
		String(
			evaluate(
				session,
				`(() => { let captured = {}; let record = event => { for (let type of event.clipboardData.types) captured[type] = event.clipboardData.getData(type) }; window.addEventListener("${command}", record, { once: true }); let active = document.activeElement; document.execCommand("${command}"); window.removeEventListener("${command}", record); return JSON.stringify({ data: captured, active: active?.id ?? active?.tagName }) })()`,
			),
		),
	)
	let data: Record<string, string> =
		value && typeof value === "object" && value.data ? value.data : {}
	return {
		data,
		types: Object.keys(data),
		html: data["text/html"] ?? "",
		text: data["text/plain"] ?? "",
	}
}
function paste(session: string, data: Record<string, string>) {
	evaluate(
		session,
		`(() => { let transfer = new DataTransfer(); for (let [type, value] of Object.entries(${JSON.stringify(data)})) transfer.setData(type, value); (document.activeElement ?? document.body).dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true })) })()`,
	)
}
