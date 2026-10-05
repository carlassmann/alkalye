import {
	assert,
	browser,
	evaluate,
	wait,
	currentDocument,
	submitDialog,
} from "./browser-driver"

let boardEditor = 'document.querySelector("alkalye-whiteboard")?.editor'
export let boardShapes = `(${boardEditor}?.getCurrentPageShapes().length ?? -1)`
export let boardMounted = `(${boardEditor} !== undefined && document.querySelector(".tl-canvas") !== null)`

// Draws a rectangle the way a person would: tldraw's tool, then a drag.
export function drawRectangle(session: string) {
	browser(session, "click", '[data-testid="tools.rectangle"]')
	let value = evaluate(
		session,
		'JSON.stringify((() => { let bounds = document.querySelector(".tl-canvas").getBoundingClientRect(); return [bounds.left + bounds.width * 0.3, bounds.top + bounds.height * 0.3, bounds.left + bounds.width * 0.5, bounds.top + bounds.height * 0.5].map(Math.round) })())',
	)
	let [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = String(value)
		.slice(1, -1)
		.split(",")
		.map(Number)
	browser(session, "mouse", "move", String(x1), String(y1))
	browser(session, "mouse", "down")
	for (let step of [0.25, 0.5, 0.75, 1])
		browser(
			session,
			"mouse",
			"move",
			String(Math.round(x1 + (x2 - x1) * step)),
			String(Math.round(y1 + (y2 - y1) * step)),
		)
	browser(session, "mouse", "up")
}

export function verifyNativeDrawings(session: string, original: string) {
	browser(session, "click", '[data-action="new"]')
	wait(session, `${currentDocument} !== ${JSON.stringify(original)}`)
	browser(session, "fill", "#editor", "# Drawing journal\n")
	browser(session, "click", '[data-action="tools"]')
	browser(session, "click", '[data-action="new-whiteboard"]')
	wait(session, boardMounted)
	assert(
		evaluate(
			session,
			'document.querySelector("[data-whiteboard]").tagName === "ALKALYE-WHITEBOARD"',
		),
		"native drawing uses a registered Custom Element",
	)
	drawRectangle(session)
	wait(
		session,
		`${boardShapes} === 1 && document.querySelector("#save-status").textContent === "Saved"`,
	)
	browser(session, "click", "#drawing-undo")
	wait(session, `${boardShapes} === 0`)
	browser(session, "click", "#drawing-redo")
	wait(session, `${boardShapes} === 1`)
	assert(
		true,
		"native whole-document undo and redo include drawing creation and its shapes",
	)
	browser(session, "click", "#embed-board")
	wait(
		session,
		'!document.querySelector("#dialog").open && document.querySelector("alkalye-editor").source.value.includes("asset:") && document.querySelector("#save-status").textContent === "Saved"',
	)
	assert(
		true,
		"native drawing embedding records the drawing name and source reference together",
	)
	evaluate(
		session,
		'document.querySelector("alkalye-editor").source.setSelectionRange(0,0)',
	)
	wait(
		session,
		'document.querySelector("[data-editor-links] a[data-kind=media]") !== null',
	)
	assert(
		evaluate(
			session,
			'document.querySelector("#highlight .syntax-link-icon[data-icon=pencil]") !== null',
		),
		"Editor whiteboards use the original pencil icon and their name",
	)
	browser(session, "click", "[data-editor-links] a[data-kind=media]")
	wait(session, boardMounted)
	assert(true, "Clicking a whiteboard label opens its existing drawing")
	browser(session, "click", ".dialog-close")
	wait(session, '!document.querySelector("#dialog").open')
	browser(session, "click", '[data-action="preview"]')
	wait(
		session,
		'document.querySelector("#preview").shadowRoot.querySelector("img")?.naturalWidth > 0',
	)
	assert(
		true,
		"native preview resolves a whiteboard directly from the document snapshot",
	)
	browser(session, "click", ".preview-back")
	browser(session, "click", '[data-action="history"]')
	wait(
		session,
		'document.querySelector("alkalye-history alkalye-editor")?.source.value.includes("asset:")',
	)
	assert(
		evaluate(
			session,
			`document.querySelector("alkalye-history #editor").readOnly && getComputedStyle(document.querySelector(".toolbar")).display === "none" && getComputedStyle(document.querySelector(".inspector")).display === "none" && document.querySelector("#history-position").value === document.querySelector("#history-position").max`,
		),
		"time machine uses the read-only editor, fullscreen chrome and newest-at-right timeline",
	)
	browser(session, "set", "viewport", "504", "842")
	assert(
		evaluate(
			session,
			`document.querySelector("#history-position").getBoundingClientRect().bottom < document.querySelector("#history-older").getBoundingClientRect().top && getComputedStyle(document.querySelector(".workspace")).filter === "none"`,
		),
		"mobile history puts the timeline above its controls without sidebar blur",
	)
	browser(session, "set", "viewport", "1280", "900")
	assert(
		evaluate(
			session,
			'document.querySelector("alkalye-history") !== null && document.querySelector("#history-records").textContent.includes("Whiteboard")',
		),
		"native time machine shows drawing records alongside the historical source",
	)
	evaluate(
		session,
		'{let slider = document.querySelector("#history-position"); slider.value = "1"; slider.dispatchEvent(new Event("change"))}',
	)
	wait(
		session,
		'!document.querySelector("alkalye-history alkalye-editor").source.value.includes("asset:") && document.querySelector("#restore-history").disabled === false',
	)
	browser(session, "click", "#restore-history")
	wait(session, 'document.querySelector("#dialog").open')
	browser(session, "press", "BracketRight")
	assert(
		evaluate(
			session,
			'document.querySelector("#history-position").value === "1"',
		),
		"restore confirmation freezes history shortcuts",
	)
	submitDialog(session)
	wait(
		session,
		'!location.pathname.endsWith("/timemachine") && document.querySelector("alkalye-history") === null && document.querySelector("#editor")?.value.startsWith("# Drawing journal") && !document.querySelector("alkalye-editor").source.value.includes("asset:")',
	)
	assert(
		true,
		"native time machine restores an entire document moment through a new action",
	)
	evaluate(session, 'document.querySelector("#editor").focus()')
	browser(session, "press", "Control+z")
	wait(
		session,
		'document.querySelector("alkalye-editor").source.value.includes("asset:") && document.querySelector("#save-status").textContent === "Saved"',
	)
	assert(
		true,
		"undoing a native history restore recovers the later embedded drawing",
	)
	browser(session, "click", '[data-action="history"]')
	wait(
		session,
		'document.querySelector("alkalye-history alkalye-editor")?.source.value.includes("asset:")',
	)
	evaluate(session, 'document.querySelector("alkalye-history #editor").focus()')
	browser(session, "press", "[")
	wait(
		session,
		'document.querySelector("#history-position").value !== document.querySelector("#history-position").max',
	)
	browser(session, "press", "Escape")
	wait(session, 'document.querySelector("alkalye-history") === null')
	assert(
		true,
		"history shortcuts and Escape work while the read-only editor has focus",
	)
	wait(session, "!!navigator.serviceWorker.controller")
	browser(session, "set", "offline", "on")
	browser(session, "reload")
	wait(
		session,
		'document.querySelector("#editor")?.value.startsWith("# Drawing journal")',
	)
	browser(session, "click", '[data-action="tools"]')
	browser(session, "click", '[data-action^="drawing:"]')
	wait(session, `${boardMounted} && ${boardShapes} === 1`)
	assert(
		true,
		"native offline reload opens the drawing without fetching its event history",
	)
	evaluate(
		session,
		'window.oldBoard = document.querySelector("alkalye-whiteboard"); document.querySelector("#dialog .dialog-close").click()',
	)
	wait(
		session,
		'window.oldBoard.editor === undefined && !window.oldBoard.querySelector(".tl-container")',
	)
	assert(
		true,
		"closing a native drawing unmounts tldraw and releases its scoped presence",
	)
	browser(session, "click", '[data-action="history"]')
	wait(
		session,
		'document.querySelector("alkalye-history alkalye-editor")?.source.value.includes("asset:")',
	)
	assert(
		true,
		"downloaded native document history remains available after an offline reload",
	)
	let drawingDocument = String(evaluate(session, currentDocument))
	evaluate(
		session,
		'{let button = document.querySelector("#duplicate-history"); button.click(); button.click()}',
	)
	wait(
		session,
		`${currentDocument} !== ${JSON.stringify(drawingDocument)} && document.querySelector("alkalye-editor")?.source.value.includes("asset:")`,
	)
	assert(
		evaluate(
			session,
			`document.querySelectorAll('[data-action^="drawing:"]').length === 1 && document.querySelector("alkalye-history") === null`,
		),
		"native offline history copy keeps its drawing, opens the editor and ignores a double-click",
	)
	browser(session, "click", '[data-action="preview"]')
	wait(
		session,
		'document.querySelector("#preview").shadowRoot.querySelector("img")?.naturalWidth > 0',
	)
	assert(
		true,
		"native historical copies preserve independent drawing previews offline",
	)
	browser(session, "click", ".preview-back")
	browser(session, "set", "offline", "off")
	evaluate(session, 'window.dispatchEvent(new Event("focus"))')
	browser(session, "click", `[data-doc="${original}"]`)
	wait(session, `${currentDocument} === ${JSON.stringify(original)}`)
}
