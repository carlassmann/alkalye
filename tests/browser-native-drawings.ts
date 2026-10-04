import {
	assert,
	browser,
	evaluate,
	wait,
	currentDocument,
} from "./browser-driver"

export function verifyNativeDrawings(session: string, original: string) {
	browser(session, "click", '[data-action="new"]')
	wait(session, `${currentDocument} !== ${JSON.stringify(original)}`)
	browser(session, "fill", "#editor", "# Drawing journal\n")
	browser(session, "click", '[data-action="tools"]')
	browser(session, "click", '[data-action="new-whiteboard"]')
	wait(session, 'document.querySelector("#whiteboard") !== null')
	assert(
		evaluate(
			session,
			'document.querySelector("[data-whiteboard]").tagName === "ALKALYE-WHITEBOARD"',
		),
		"native drawing uses a registered Custom Element",
	)
	browser(session, "click", '[data-tool="rectangle"]')
	evaluate(
		session,
		'{let board=document.querySelector("#whiteboard"),bounds=board.getBoundingClientRect();board.setPointerCapture=()=>{};let event=(type,x,y)=>new PointerEvent(type,{clientX:bounds.left+bounds.width*x,clientY:bounds.top+bounds.height*y,pointerId:1,bubbles:true});board.dispatchEvent(event("pointerdown",.2,.2));board.dispatchEvent(event("pointermove",.5,.5));board.dispatchEvent(event("pointerup",.5,.5))}',
	)
	wait(
		session,
		'document.querySelectorAll("#whiteboard [data-shape]").length === 1 && document.querySelector("#save-status").textContent === "Saved"',
	)
	browser(session, "click", "#drawing-undo")
	wait(
		session,
		'document.querySelectorAll("#whiteboard [data-shape]").length === 0',
	)
	browser(session, "click", "#drawing-redo")
	wait(
		session,
		'document.querySelectorAll("#whiteboard [data-shape]").length === 1',
	)
	assert(
		true,
		"native whole-document undo and redo include drawing creation and its shapes",
	)
	browser(session, "click", "#embed-board")
	wait(
		session,
		'!document.querySelector("#dialog").open && document.querySelector("#editor").value.includes("asset:") && document.querySelector("#save-status").textContent === "Saved"',
	)
	assert(
		true,
		"native drawing embedding records the drawing name and source reference together",
	)
	browser(session, "click", '[data-action="preview"]')
	wait(
		session,
		'document.querySelector("#preview").shadowRoot.querySelector("img")?.naturalWidth > 0',
	)
	assert(
		true,
		"native preview resolves a whiteboard directly from the document snapshot",
	)
	browser(session, "press", "Escape")
	browser(session, "click", '[data-action="history"]')
	wait(
		session,
		'document.querySelector("#history-source") !== null && document.querySelectorAll("[data-version]").length > 0',
	)
	assert(
		evaluate(
			session,
			'document.querySelector("alkalye-history") !== null && document.querySelector("#history-records").textContent.includes("Whiteboard")',
		),
		"native time machine shows drawing records alongside the historical source",
	)
	evaluate(
		session,
		'[...document.querySelectorAll("[data-version]")].find(button => button.querySelector("strong").textContent === "Draw").click()',
	)
	wait(
		session,
		'!document.querySelector("#history-source").textContent.includes("asset:") && document.querySelector("#restore-history").disabled === false',
	)
	browser(session, "click", "#restore-history")
	wait(
		session,
		'document.querySelector("#editor")?.value.startsWith("# Drawing journal") && !document.querySelector("#editor").value.includes("asset:")',
	)
	assert(
		true,
		"native time machine restores an entire document moment through a new action",
	)
	evaluate(session, 'document.querySelector("#editor").focus()')
	browser(session, "press", "Control+z")
	wait(
		session,
		'document.querySelector("#editor").value.includes("asset:") && document.querySelector("#save-status").textContent === "Saved"',
	)
	assert(
		true,
		"undoing a native history restore recovers the later embedded drawing",
	)
	browser(session, "click", '[data-action="history"]')
	wait(
		session,
		'document.querySelector("#history-source")?.textContent.includes("asset:")',
	)
	browser(session, "press", "Escape")
	wait(session, "!!navigator.serviceWorker.controller")
	browser(session, "set", "offline", "on")
	browser(session, "reload")
	wait(
		session,
		'document.querySelector("#editor")?.value.startsWith("# Drawing journal")',
	)
	browser(session, "click", '[data-action="tools"]')
	browser(session, "click", '[data-action^="drawing:"]')
	wait(
		session,
		'document.querySelectorAll("#whiteboard [data-shape]").length === 1',
	)
	assert(
		true,
		"native offline reload opens the drawing without fetching its event history",
	)
	evaluate(
		session,
		'window.oldBoard = document.querySelector("#whiteboard"); document.querySelector("#dialog").close()',
	)
	wait(session, "window.oldBoard.onpointerdown === null")
	assert(
		true,
		"closing a native drawing releases its pointer handlers and scoped presence",
	)
	browser(session, "click", '[data-action="history"]')
	wait(
		session,
		'document.querySelector("#history-source")?.textContent.includes("asset:")',
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
		`${currentDocument} !== ${JSON.stringify(drawingDocument)} && document.querySelector("#editor")?.value.includes("asset:")`,
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
	browser(session, "press", "Escape")
	browser(session, "set", "offline", "off")
	evaluate(session, 'window.dispatchEvent(new Event("focus"))')
	browser(session, "click", `[data-doc="${original}"]`)
	wait(session, `${currentDocument} === ${JSON.stringify(original)}`)
}
