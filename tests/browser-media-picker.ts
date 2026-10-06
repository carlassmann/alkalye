import {
	assert,
	browser,
	evaluate,
	serverAddress,
	wait,
} from "./browser-driver"
import { boardMounted, drawRectangle } from "./browser-native-drawings"

let server = Bun.spawn(["bun", "tests/browser-document-app.ts", "--serve"], {
	stdout: "pipe",
	stderr: "inherit",
})
let session = "media-picker-" + Date.now()
let source = 'document.querySelector("alkalye-editor").source'
try {
	let url = new URL("/app", await serverAddress(server.stdout)).href
	console.log(url)
	browser(session, "open", url)
	wait(session, 'Boolean(document.querySelector("#editor"))')
	browser(session, "click", '[data-action="new"]')
	browser(session, "fill", "#editor", "# Outline")
	browser(session, "press", "Control+Shift+o")
	wait(session, 'document.querySelector("#dialog").open')
	browser(session, "press", "Escape")
	browser(session, "fill", "#editor", "![alt](asset:missing)")
	evaluate(session, `${source}.setSelectionRange(4,4); ${source}.focus()`)
	browser(session, "press", "Control+Space")
	wait(
		session,
		'document.querySelector("#dialog").open && Boolean(document.querySelector("#media-search"))',
	)
	browser(session, "press", "Escape")
	wait(
		session,
		'!document.querySelector("#dialog").open && document.activeElement.id === "editor"',
	)
	assert(
		true,
		"reusing the outline dialog for an image picker preserves native Escape and editor focus",
	)

	browser(
		session,
		"fill",
		"#editor",
		"Before ![old](https://example.com/old.png) After",
	)
	evaluate(session, `${source}.setSelectionRange(12,12); ${source}.focus()`)
	browser(session, "press", "Control+Space")
	wait(
		session,
		'document.querySelector("#dialog").open && document.querySelector("#media-search") !== null',
	)
	assert(
		evaluate(session, 'document.querySelector("#dialog h2").textContent') ===
			"Select media",
		"Ctrl Space inside an image opens the original dedicated media picker",
	)
	wait(
		session,
		'getComputedStyle(document.querySelector("#media-choices")).maxHeight === "240px"',
	)
	assert(
		evaluate(
			session,
			'(() => { let picker=document.querySelector("[data-media-picker]"); let list=getComputedStyle(picker.querySelector("[role=listbox]")); let footer=getComputedStyle(picker.querySelector("footer")); return getComputedStyle(picker).display === "block" && list.overflowY === "auto" && list.borderTopWidth === "1px" && footer.padding === "0px" })()',
		),
		"the loaded media picker stylesheet renders a bounded scroll panel and compact footer",
	)
	browser(session, "click", "[data-media-picker] summary")
	browser(session, "fill", "#media-url", "javascript:alert(1)")
	browser(session, "click", '[data-media-action="url"]')
	assert(
		evaluate(session, 'document.querySelector("#dialog").open'),
		"unsafe media URLs cannot close the picker or change the document",
	)
	browser(session, "fill", "#media-url", "https://example.com/image(one).png")
	browser(session, "press", "Enter")
	wait(
		session,
		`!document.querySelector("#dialog").open && ${source}.value === "Before ![Media](https://example.com/image%28one%29.png) After"`,
	)
	assert(
		true,
		"URL media replacement preserves surrounding source and escapes Markdown delimiters",
	)

	browser(session, "fill", "#editor", "Before selected After")
	evaluate(
		session,
		`${source}.setSelectionRange(7,15); ${source}.focus(); document.querySelector('[data-action="image"]').click()`,
	)
	wait(
		session,
		'Boolean(document.querySelector("#media-search")) && document.querySelector("#dialog").open',
	)
	browser(session, "click", '[data-media-action="drawing"]')
	wait(session, boardMounted)
	drawRectangle(session)
	browser(session, "click", "#embed-board")
	wait(
		session,
		`!document.querySelector("#dialog").open && ${source}.value.includes("![Whiteboard](asset:")`,
	)
	assert(
		evaluate(
			session,
			`${source}.value.startsWith("Before ![Whiteboard](asset:") && ${source}.value.endsWith(") After")`,
		),
		"creating and embedding a whiteboard replaces the saved selection rather than appending at the end",
	)

	browser(session, "fill", "#editor", "Insert here")
	evaluate(
		session,
		`${source}.setSelectionRange(7,11); ${source}.focus(); document.querySelector('[data-action="image"]').click()`,
	)
	wait(
		session,
		'document.querySelector("#dialog").open && Boolean(document.querySelector("#media-search"))',
	)
	browser(session, "click", '[data-media-action="switch"]')
	browser(session, "fill", "#media-search", "white")
	browser(session, "press", "End")
	assert(
		evaluate(
			session,
			'document.querySelector("#media-search").getAttribute("aria-activedescendant") === document.querySelector("[data-media-id]").id',
		),
		"the whiteboard search exposes its keyboard selection through the native combobox contract",
	)
	browser(session, "press", "Enter")
	wait(
		session,
		`!document.querySelector("#dialog").open && ${source}.value.startsWith("Insert ![Whiteboard](asset:")`,
	)
	assert(
		evaluate(session, `${source}.value.split("asset:").length === 2`),
		"selecting an existing whiteboard inserts one reference at the remembered selection",
	)

	evaluate(
		session,
		`${source}.setSelectionRange(0,0); ${source}.focus(); document.querySelector('[data-action="image"]').click()`,
	)
	wait(session, 'document.querySelector("#dialog").open')
	let before = evaluate(session, `${source}.value`)
	browser(session, "press", "Escape")
	assert(
		evaluate(session, `${source}.value`) === before &&
			evaluate(session, "document.activeElement.id") === "editor",
		"canceling leaves source untouched and returns keyboard focus to the editor",
	)

	evaluate(
		session,
		`${source}.setSelectionRange(0,0); ${source}.focus(); document.querySelector('[data-action="image"]').click(); document.querySelector("#asset-files").click = () => {}`,
	)
	wait(session, 'document.querySelector("#dialog").open')
	browser(session, "click", '[data-media-action="upload"]')
	evaluate(
		session,
		'(async () => { let canvas=document.createElement("canvas");canvas.width=16;canvas.height=16;let blob=await new Promise(resolve=>canvas.toBlob(resolve));let transfer=new DataTransfer();transfer.items.add(new File([blob],"Picker-photo.png",{type:"image/png"}));let input=document.querySelector("#asset-files");input.files=transfer.files;input.dispatchEvent(new Event("change")) })()',
	)
	wait(session, `${source}.value.startsWith("![Picker-photo.png](asset:")`)
	assert(
		true,
		"upload from the media picker inserts at the selection saved before the file chooser opens",
	)
	evaluate(
		session,
		`${source}.setSelectionRange(${source}.value.length,${source}.value.length); ${source}.focus(); document.querySelector('[data-action="image"]').click()`,
	)
	wait(
		session,
		'document.querySelector("#dialog").open && document.querySelector("[data-media-id]") !== null',
	)
	browser(session, "fill", "#media-search", "picker")
	browser(session, "press", "Home")
	browser(session, "press", "Enter")
	wait(
		session,
		`!document.querySelector("#dialog").open && ${source}.value.split("Picker-photo.png").length === 3`,
	)
	assert(
		true,
		"existing images can be searched and reused without duplicating the uploaded asset",
	)
} finally {
	browser(session, "close")
	server.kill()
	await server.exited
}
