import { assert, browser, evaluate, wait } from "./browser-driver"

let server = Bun.spawn(["bun", "tests/browser-document-app.ts", "--serve"], {
	stdout: "pipe",
	stderr: "inherit",
})
let session = "whiteboard-" + Date.now()
let shapes = 'document.querySelectorAll("#whiteboard [data-shape]").length'
let saved = 'document.querySelector("#save-status").textContent === "Saved"'
let pressed = (selector: string) =>
	`document.querySelector(${JSON.stringify(selector)}).getAttribute("aria-pressed") === "true"`

try {
	let output = await server.stdout.getReader().read()
	if (!output.value) throw new Error("Missing app URL")
	let url = new URL("/app", new TextDecoder().decode(output.value).trim()).href
	console.log(url)
	browser(session, "set", "viewport", "1280", "800")
	browser(session, "open", url)
	wait(session, 'document.querySelector("[data-document-app]") !== null')
	browser(session, "click", '[data-action="new"]')
	wait(session, '!document.querySelector("#editor").readOnly')
	browser(session, "fill", "#editor", "# Board journal\n")
	browser(session, "click", '[data-action="tools"]')
	browser(session, "click", '[data-action="new-whiteboard"]')
	wait(session, 'document.querySelector("#whiteboard") !== null')

	assert(
		evaluate(
			session,
			`(() => { let dialog = document.querySelector("#dialog").getBoundingClientRect(); return dialog.width >= innerWidth - 1 && dialog.height >= innerHeight - 1 })()`,
		),
		"the whiteboard fills the viewport",
	)
	assert(
		evaluate(session, pressed('[data-tool="select"]')) &&
			evaluate(session, 'document.querySelector("#drawing-style").hidden') &&
			evaluate(
				session,
				'[...document.querySelectorAll(".tool-palette [data-tool]")].every(button => button.querySelector("svg.icon") && button.getAttribute("aria-label"))',
			),
		"selection is the default tool and the palette shows labelled icons",
	)

	browser(session, "click", '[data-tool="rectangle"]')
	assert(
		!evaluate(session, 'document.querySelector("#drawing-style").hidden'),
		"choosing a drawing tool shows the style inspector",
	)
	drag(session, [0.3, 0.3], [0.45, 0.5])
	wait(session, `${shapes} === 1 && ${saved}`)
	assert(
		evaluate(session, pressed('[data-tool="select"]')) &&
			evaluate(session, 'document.querySelectorAll("[data-handle]").length') ===
				8,
		"a drawn rectangle is selected with resize handles and the tool returns to select",
	)

	browser(session, "click", '[data-color="#e03131"]')
	browser(session, "click", '[data-fill="solid"]')
	browser(session, "click", '[data-dash="dashed"]')
	wait(
		session,
		`(() => { let rect = document.querySelector("#whiteboard [data-shape] rect"); return rect?.getAttribute("stroke") === "#e03131" && rect.getAttribute("fill") === "#e03131" && rect.hasAttribute("stroke-dasharray") })() && ${saved}`,
	)
	assert(true, "the inspector restyles the selection's colour, fill and dash")

	let before = shapeWidth(session)
	let handle = point(
		session,
		'document.querySelector("[data-handle=se] .resize-handle")',
	)
	mouseDrag(session, handle, { x: handle.x + 120, y: handle.y + 60 })
	wait(session, `${saved}`)
	wait(
		session,
		`document.querySelector("#whiteboard [data-shape] rect").getBoundingClientRect().width > ${before + 100}`,
	)
	assert(true, "dragging a corner handle resizes the shape")

	browser(session, "press", "o")
	assert(evaluate(session, pressed('[data-tool="ellipse"]')), "O picks ellipse")
	drag(session, [0.6, 0.3], [0.75, 0.5])
	wait(session, `${shapes} === 2 && ${saved}`)
	browser(session, "press", "Escape")
	assert(
		evaluate(session, 'document.querySelector("#dialog").open') &&
			evaluate(session, 'document.querySelectorAll("[data-handle]").length') ===
				0,
		"Escape clears the selection without closing the whiteboard",
	)
	drag(session, [0.15, 0.15], [0.9, 0.85])
	assert(
		evaluate(
			session,
			'document.querySelectorAll("[data-selection] .outline").length',
		) === 2,
		"a marquee selects several shapes",
	)
	browser(session, "press", "Delete")
	wait(session, `${shapes} === 0 && ${saved}`)
	browser(session, "press", "Control+z")
	wait(session, `${shapes} === 2`)
	assert(true, "delete removes the selection and undo restores it")

	browser(session, "press", "t")
	click(session, [0.3, 0.75])
	wait(
		session,
		'!document.querySelector("#drawing-text").hidden && document.activeElement === document.querySelector("#drawing-text")',
	)
	browser(session, "keyboard", "type", "Hello r")
	assert(
		evaluate(session, pressed('[data-tool="text"]')) &&
			evaluate(session, 'document.querySelector("#drawing-text").value') ===
				"Hello r",
		"typing in the text editor never triggers tool shortcuts",
	)
	browser(session, "press", "Escape")
	wait(
		session,
		`${shapes} === 3 && document.querySelector("#drawing-text").hidden && [...document.querySelectorAll("#whiteboard [data-shape] text")].some(text => text.textContent === "Hello r") && ${saved}`,
	)
	assert(
		evaluate(session, 'document.querySelector("#dialog").open'),
		"inline text is created on the canvas and Escape commits it",
	)
	evaluate(
		session,
		'[...document.querySelectorAll("#whiteboard [data-shape] text")].find(text => text.textContent === "Hello r").parentElement.querySelector(".hit-area").dataset.label = ""',
	)
	browser(session, "dblclick", "#whiteboard [data-label]")
	wait(
		session,
		'!document.querySelector("#drawing-text").hidden && document.querySelector("#drawing-text").value === "Hello r"',
	)
	browser(session, "press", "End")
	browser(session, "press", "Shift+Enter")
	browser(session, "keyboard", "type", "world")
	browser(session, "press", "Escape")
	wait(
		session,
		`[...document.querySelectorAll("#whiteboard [data-shape] text")].some(text => text.querySelectorAll("tspan").length === 2 && text.textContent === "Hello rworld") && ${saved}`,
	)
	assert(true, "double-clicking text edits it in place across several lines")

	let zoom = 'document.querySelector("#reset-board").textContent.trim()'
	browser(session, "click", "#zoom-board-in")
	assert(evaluate(session, zoom) !== "100%", "zoom in changes the zoom level")
	browser(session, "click", "#reset-board")
	assert(evaluate(session, zoom) === "100%", "the zoom label resets to 100%")
	let center = canvasPoint(session, [0.5, 0.5])
	browser(session, "mouse", "move", String(center.x), String(center.y))
	let viewBox = evaluate(
		session,
		'document.querySelector("#whiteboard").getAttribute("viewBox")',
	)
	// agent-browser wheels at the page origin, so the wheel is dispatched on the canvas.
	let wheel = (options: string) =>
		evaluate(
			session,
			`document.querySelector("#whiteboard").dispatchEvent(new WheelEvent("wheel", { clientX: ${center.x}, clientY: ${center.y}, bubbles: true, cancelable: true, ${options} }))`,
		)
	wheel("deltaY: 120")
	assert(
		evaluate(
			session,
			`document.querySelector("#whiteboard").getAttribute("viewBox") !== ${JSON.stringify(viewBox)} && ${zoom} === "100%"`,
		),
		"scrolling pans the canvas without zooming",
	)
	wheel("deltaY: -50, ctrlKey: true")
	assert(
		evaluate(session, zoom) !== "100%",
		"pinching a trackpad or ctrl-scrolling zooms at the pointer",
	)
	browser(session, "click", "#reset-board")
	evaluate(
		session,
		`(() => { let board = document.querySelector("#whiteboard"), rect = board.getBoundingClientRect(); let touch = (type, id, x, y) => board.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: "touch", clientX: rect.left + x, clientY: rect.top + y, bubbles: true, cancelable: true, isPrimary: id === 11 })); touch("pointerdown", 11, 500, 300); touch("pointerdown", 12, 600, 300); touch("pointermove", 11, 400, 300); touch("pointermove", 12, 700, 300); touch("pointerup", 11, 400, 300); touch("pointerup", 12, 700, 300) })()`,
	)
	assert(
		evaluate(session, zoom) === "300%" && evaluate(session, shapes) === 3,
		"a two-finger pinch zooms without drawing",
	)
	browser(session, "press", "Shift+Digit1")
	assert(evaluate(session, zoom) !== "300%", "Shift+1 zooms to fit the drawing")

	browser(session, "click", "#drawing-menu > summary")
	assert(
		evaluate(
			session,
			'document.querySelector("#drawing-menu").open && ["#export-drawing", "#export-svg", "#import-drawing", "#clear-board"].every(selector => document.querySelector(selector))',
		),
		"the drawing menu offers export, import and clearing",
	)
	browser(session, "press", "End")
	assert(
		evaluate(session, 'document.activeElement.id === "clear-board"'),
		"Drawing menu uses the shared keyboard navigation",
	)
	browser(session, "press", "Home")
	assert(
		evaluate(session, 'document.activeElement.id === "export-drawing"'),
		"Drawing menu Home returns to the first item",
	)
	browser(session, "press", "Escape")
	assert(
		!evaluate(session, 'document.querySelector("#drawing-menu").open') &&
			evaluate(session, 'document.querySelector("#dialog").open'),
		"Escape closes the menu before the whiteboard",
	)
	browser(session, "screenshot", "/tmp/alkalye-whiteboard.png")

	browser(session, "click", "#embed-board")
	wait(
		session,
		`!document.querySelector("#dialog").open && document.querySelector("#editor").value.includes("asset:") && ${saved}`,
	)
	assert(
		true,
		"embedding closes the whiteboard and references it from the text",
	)
	browser(session, "click", '[data-action="tools"]')
	browser(session, "click", '[data-action^="drawing:"]')
	wait(session, `${shapes} === 3`)
	assert(
		evaluate(
			session,
			'document.querySelector("#embed-board span").textContent === "Done"',
		),
		"reopening an embedded drawing keeps its shapes and offers Done",
	)
} finally {
	try {
		browser(session, "close")
	} catch {}
	server.kill("SIGTERM")
	await server.exited
}

function canvasPoint(session: string, [x, y]: [number, number]) {
	let result = evaluate(
		session,
		`(() => { let rect = document.querySelector("#whiteboard").getBoundingClientRect(); return JSON.stringify({ x: Math.round(rect.left + rect.width * ${x}), y: Math.round(rect.top + rect.height * ${y}) }) })()`,
	)
	return parsePoint(result)
}
function point(session: string, element: string) {
	let result = evaluate(
		session,
		`(() => { let rect = (${element}).getBoundingClientRect(); return JSON.stringify({ x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) }) })()`,
	)
	return parsePoint(result)
}
function parsePoint(value: unknown) {
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
function shapeWidth(session: string) {
	return Number(
		evaluate(
			session,
			'document.querySelector("#whiteboard [data-shape] rect").getBoundingClientRect().width',
		),
	)
}
function mouseDrag(
	session: string,
	from: { x: number; y: number },
	to: { x: number; y: number },
) {
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
function drag(session: string, from: [number, number], to: [number, number]) {
	mouseDrag(session, canvasPoint(session, from), canvasPoint(session, to))
}
function click(session: string, at: [number, number]) {
	let target = canvasPoint(session, at)
	browser(session, "mouse", "move", String(target.x), String(target.y))
	browser(session, "mouse", "down")
	browser(session, "mouse", "up")
}
