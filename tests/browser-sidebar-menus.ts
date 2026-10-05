import { assert, browser, evaluate, wait } from "./browser-driver"

let server = Bun.spawn(["bun", "tests/browser-document-app.ts", "--serve"], {
	stdout: "pipe",
	stderr: "inherit",
})
let session = "sidebar-menus-" + Date.now()
try {
	let output = await server.stdout.getReader().read()
	if (!output.value) throw new Error("Missing app URL")
	let url = new URL("/app", new TextDecoder().decode(output.value).trim()).href
	browser(session, "set", "viewport", "1440", "900")
	browser(session, "open", url)
	wait(
		session,
		'Boolean(document.querySelector("#editor")) && !document.querySelector("#app").hasAttribute("aria-busy")',
	)
	browser(session, "click", '[data-action="new"]')
	browser(session, "fill", "#editor", "hello world")
	browser(session, "click", '[data-action="toggle-tools"]')
	assert(
		evaluate(
			session,
			'!document.querySelector("details.tool-group") && document.querySelectorAll("alkalye-menu.tool-group").length === 6',
		),
		"Sidebar command groups use shared dropdowns",
	)
	let before = evaluate(
		session,
		'document.querySelector("[aria-controls=tools-edit]").getBoundingClientRect().top',
	)
	browser(session, "click", '[aria-controls="tools-file"]')
	assert(
		evaluate(
			session,
			'document.querySelector("#tools-file").matches(":popover-open") && document.querySelector("#tools-file").dataset.side === "left"',
		),
		"File opens beside the desktop sidebar",
	)
	assert(
		evaluate(
			session,
			'document.querySelector("[aria-controls=tools-edit]").getBoundingClientRect().top',
		) === before,
		"Opening File does not expand or move sidebar rows",
	)
	browser(session, "press", "Escape")
	assert(
		evaluate(
			session,
			'document.activeElement.getAttribute("aria-controls") === "tools-file"',
		),
		"Escape restores trigger focus",
	)
	evaluate(
		session,
		'(() => {let editor=document.querySelector("#editor");editor.focus();editor.setSelectionRange(0,5);editor.dispatchEvent(new Event("select"));return true})()',
	)
	browser(session, "click", '[aria-controls="tools-format"]')
	browser(session, "press", "ArrowRight")
	wait(
		session,
		'document.querySelector("#tools-headings").matches(":popover-open")',
	)
	browser(session, "press", "End")
	assert(
		evaluate(session, 'document.activeElement.dataset.action === "h6"'),
		"Heading submenu exposes all six levels with keyboard navigation",
	)
	browser(session, "press", "ArrowLeft")
	assert(
		evaluate(
			session,
			'!document.querySelector("#tools-headings").matches(":popover-open") && document.activeElement.getAttribute("aria-controls") === "tools-headings"',
		),
		"Left returns to the parent menu",
	)
	browser(session, "press", "ArrowDown")
	assert(
		evaluate(
			session,
			'document.activeElement.getAttribute("aria-controls") === "tools-lists"',
		),
		"Down moves between submenu triggers",
	)
	browser(session, "press", "b")
	assert(
		evaluate(session, 'document.activeElement.dataset.action === "body"'),
		"Typeahead finds Body text",
	)
	browser(session, "press", "b")
	assert(
		evaluate(session, 'document.activeElement.dataset.action === "bold"'),
		"Repeated typeahead cycles to Bold",
	)
	browser(session, "press", "Enter")
	wait(
		session,
		'document.querySelector("alkalye-editor").source.value === "**hello** world"',
	)
	assert(
		evaluate(session, '!document.querySelector(".menu-popover:popover-open")'),
		"Selecting a command closes its dropdown and preserves the editor selection",
	)
	browser(session, "fill", "#editor", "title")
	browser(session, "click", '#tools-headings [data-action="h6"]')
	wait(
		session,
		'document.querySelector("alkalye-editor").source.value === "###### title"',
	)
	assert(
		evaluate(session, '!document.querySelector(".menu-popover:popover-open")'),
		"Selecting a nested command dismisses the entire menu stack",
	)
	browser(session, "click", '#tools-format [data-action="body"]')
	wait(
		session,
		'document.querySelector("alkalye-editor").source.value === "title"',
	)
	browser(session, "fill", "#editor", "- [x] Done\n  details\n- [ ] Todo")
	browser(session, "click", '#tools-edit [data-action="sort-tasks"]')
	wait(
		session,
		'document.querySelector("alkalye-editor").source.value === "- [ ] Todo\\n- [x] Done\\n  details"',
	)
	browser(session, "click", '#tools-edit [data-action="undo"]')
	wait(
		session,
		'document.querySelector("alkalye-editor").source.value.startsWith("- [x] Done")',
	)
	assert(true, "Task sorting keeps child blocks and participates in undo")

	browser(session, "fill", "#editor", "caption")
	evaluate(
		session,
		'(() => {let text=document.querySelector("alkalye-editor").source;text.focus();text.setSelectionRange(0,7);return true})()',
	)
	browser(session, "click", '#tools-format [data-action="image"]')
	wait(
		session,
		'document.querySelector("alkalye-editor").source.value === "![caption](url)"',
	)
	assert(
		evaluate(
			session,
			'(() => {let text=document.querySelector("alkalye-editor").source;return text.value.slice(text.selectionStart,text.selectionEnd) === "url"})()',
		),
		"Image insertion keeps selected alt text and selects its URL placeholder",
	)
	browser(session, "fill", "#editor", "copy me")
	evaluate(
		session,
		'(() => {let text=document.querySelector("alkalye-editor").source;text.focus();text.setSelectionRange(0,4);Object.defineProperty(navigator.clipboard,"writeText",{configurable:true,value:async value=>{window.copiedSidebarText=value}});return true})()',
	)
	browser(session, "click", '#tools-edit [data-action="copy-text"]')
	wait(session, 'window.copiedSidebarText === "copy"')
	browser(session, "click", '#tools-edit [data-action="cut"]')
	wait(
		session,
		'document.querySelector("alkalye-editor").source.value === " me"',
	)
	evaluate(
		session,
		'Object.defineProperty(navigator.clipboard,"readText",{configurable:true,value:async()=>"paste"});true',
	)
	browser(session, "click", '#tools-edit [data-action="paste"]')
	wait(
		session,
		'document.querySelector("alkalye-editor").source.value === "paste me"',
	)
	assert(
		true,
		"Sidebar clipboard commands preserve and replace the selected range",
	)
	browser(session, "click", '[aria-controls="tools-format"]')
	browser(session, "click", '[aria-controls="tools-headings"]')
	assert(
		evaluate(
			session,
			'document.querySelector("#tools-headings").matches(":popover-open")',
		),
		"Pointer hover followed by clicking keeps a submenu open",
	)
	browser(session, "press", "Tab")
	assert(
		evaluate(session, '!document.querySelector(".menu-popover:popover-open")'),
		"Tab dismisses the whole nested menu stack",
	)

	browser(session, "click", '[aria-controls="tools-file"]')
	evaluate(
		session,
		'document.querySelector("#tools-file [data-action=pin]").focus();true',
	)
	evaluate(
		session,
		'(() => {let text=document.querySelector("alkalye-editor").source;text.replace("---\\npinned: true\\n---\\n" + text.value, 25, 25);document.querySelector("#editor").dispatchEvent(new Event("input"));return true})()',
	)
	wait(
		session,
		'document.querySelector("#tools-file").matches(":popover-open") && document.querySelector("#tools-file [data-action=pin]").textContent.includes("Unpin")',
	)
	assert(
		evaluate(session, 'document.activeElement.dataset.action === "pin"'),
		"Sidebar updates preserve an open menu and its focused command",
	)
	browser(session, "press", "Escape")
	browser(session, "set", "viewport", "504", "842")
	browser(session, "click", '[aria-controls="tools-format"]')
	assert(
		evaluate(
			session,
			'(() => {let panel=document.querySelector("#tools-format"),r=panel.getBoundingClientRect();return r.left>=8 && r.right<=innerWidth-8 && r.top>=8 && r.bottom<=innerHeight-8 && ["top","bottom"].includes(panel.dataset.side)})()',
		),
		"Mobile dropdown stays inside the viewport",
	)
	browser(session, "press", "Escape")
	browser(session, "click", '#inspector-body [data-action="preview"]')
	wait(
		session,
		'location.pathname.endsWith("/preview") && document.querySelector("[aria-controls=tools-edit]").disabled',
	)
	assert(
		evaluate(
			session,
			'document.querySelector("[aria-controls=tools-edit]").disabled && document.querySelector("[aria-controls=tools-format]").disabled',
		),
		"Preview disables editor-only menus",
	)
	console.log("Sidebar dropdown browser checks passed")
} finally {
	try {
		browser(session, "close")
	} catch {}
	server.kill()
	await server.exited
}
