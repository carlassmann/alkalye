import { unzip } from "../src/shared/zip"
import { string } from "../src/shared/model"
import {
	assert,
	browser,
	evaluate,
	wait,
	currentDocument,
	visit,
} from "./browser-driver"
import {
	boardMounted,
	boardShapes,
	drawRectangle,
} from "./browser-native-drawings"

let server = Bun.spawn(["bun", "tests/browser-document-app.ts", "--serve"], {
	stdout: "pipe",
	stderr: "inherit",
})
let session = "native-portability-" + Date.now()
try {
	let output = await server.stdout.getReader().read()
	if (!output.value) throw new Error("Missing native app URL")
	let url = new URL("/app", new TextDecoder().decode(output.value).trim()).href
	console.log(url)
	browser(session, "open", url)
	wait(session, 'document.querySelector("[data-document-app]") !== null')
	captureDownloads()
	browser(session, "click", '[data-action="new"]')
	wait(
		session,
		'document.querySelector("#editor") && !document.querySelector("#editor").readOnly',
	)
	let original = string(evaluate(session, currentDocument))
	browser(
		session,
		"fill",
		"#editor",
		"---\ntitle: Portable source\npath: Travel/Notes\ntags: [alpha]\n---\n# Portable source\n\nA quoted sentence for discussion.\n",
	)
	wait(
		session,
		'document.querySelector("#save-status").textContent === "Saved"',
	)
	browser(session, "click", '[data-action="tools"]')
	evaluate(
		session,
		'let editor=document.querySelector("#editor"); editor.setSelectionRange(editor.value.length,editor.value.length); window.originalPickerClick = document.querySelector("#asset-files").click; document.querySelector("#asset-files").click = () => {}',
	)
	browser(session, "click", '[data-action="asset"]')
	evaluate(
		session,
		'(async()=>{let canvas=document.createElement("canvas");canvas.width=40;canvas.height=20;let context=canvas.getContext("2d");context.fillStyle="#123456";context.fillRect(0,0,40,20);let blob=await new Promise(resolve=>canvas.toBlob(resolve));let transfer=new DataTransfer();transfer.items.add(new File([blob],"Harbour.png",{type:"image/png"}));let input=document.querySelector("#asset-files");input.files=transfer.files;input.dispatchEvent(new Event("change"))})()',
	)
	wait(
		session,
		'document.querySelectorAll("[data-attachments] .asset-row").length === 1 && document.querySelector("#save-status").textContent === "Saved"',
	)
	evaluate(
		session,
		'document.querySelector("#asset-files").click = window.originalPickerClick',
	)
	browser(session, "click", '[data-action="new-whiteboard"]')
	wait(session, boardMounted)
	drawRectangle(session)
	wait(
		session,
		`${boardShapes} === 1 && document.querySelector("#save-status").textContent === "Saved"`,
	)
	browser(session, "click", "#embed-board")
	wait(
		session,
		'!document.querySelector("#dialog").open && document.querySelector("alkalye-editor").source.value.match(/asset:/g)?.length === 2 && document.querySelector("#save-status").textContent === "Saved"',
	)
	browser(session, "click", '[data-action="theme"]')
	wait(session, 'document.querySelector("#new-theme") !== null')
	browser(session, "click", "#new-theme")
	wait(
		session,
		'document.querySelector("alkalye-theme-workbench alkalye-editor") !== null',
	)
	browser(
		session,
		"fill",
		"alkalye-theme-workbench #editor",
		"# Harbour theme\n\n```css theme\n.content { color: rgb(18, 52, 86); }\n```",
	)
	wait(
		session,
		'document.querySelector(".workbench-status").textContent === "Saved locally"',
	)
	browser(session, "click", ".workbench-back")
	wait(
		session,
		'document.querySelector("alkalye-theme-workbench") === null && document.querySelector("#save-status").textContent === "Saved"',
	)
	browser(session, "click", '[data-action="comments"]')
	evaluate(
		session,
		'{let editor=document.querySelector("#editor");let start=editor.value.indexOf("quoted sentence");editor.focus();editor.setSelectionRange(start,start+"quoted sentence".length)}',
	)
	browser(session, "press", "Alt+Meta+m")
	wait(session, 'document.querySelector("#dialog").open')
	browser(
		session,
		"fill",
		'#dialog textarea[name="body"]',
		"Keep this portable",
	)
	browser(session, "click", "#submit-dialog")
	wait(
		session,
		'!document.querySelector("#dialog").open && document.querySelector("[data-comments]")?.textContent.includes("Keep this portable") && document.querySelector("#save-status").textContent === "Saved"',
	)
	browser(session, "click", '[data-action="tools"]')
	browser(session, "click", '[data-action="download"]')
	let exported = await download("Portable source.zip")
	let entries = await unzip(exported)
	let names = entries.map(entry => entry.name)
	let markdown = new TextDecoder().decode(
		entries.find(entry => entry.name.endsWith("Portable source.md"))?.data,
	)
	assert(
		names.includes("Travel/Notes/Portable source/Portable source.md") &&
			names.some(name => /assets\/Harbour[^/]*\.(webp|png)$/.test(name)) &&
			names.some(name => name.endsWith(".svg.tldr")) &&
			!names.some(name => name.endsWith(".alkalye-drawing.json")) &&
			names.includes(
				"Travel/Notes/Portable source/Portable source.comments.json",
			) &&
			names.some(name => name.startsWith("themes/")) &&
			names.includes("alkalye.json") &&
			!markdown.includes("asset:") &&
			markdown.includes('theme: "Custom theme"'),
		"a document exports its Markdown, attachment bytes, editable drawing, theme and comments as one ZIP",
	)
	upload("Portable source.zip", exported, "application/zip")
	wait(
		session,
		`${currentDocument} !== ${JSON.stringify(original)} && document.querySelector("#editor")?.value.includes("A quoted sentence") && document.querySelector("#toast")?.textContent.includes("Imported 1 document")`,
	)
	let imported = string(evaluate(session, currentDocument))
	browser(session, "click", '[data-action="tools"]')
	wait(
		session,
		'document.querySelectorAll("[data-attachments] .asset-row").length === 2 && document.querySelectorAll(\'[data-action^="drawing:"]\').length === 1 && document.querySelector("alkalye-editor").source.value.match(/asset:/g)?.length === 2 && document.querySelector("#editor").value.includes("theme-id:") && document.querySelector("#editor").value.includes("path: Travel/Notes")',
	)
	browser(session, "click", '[data-action="comments"]')
	wait(
		session,
		'document.querySelector("[data-comments]")?.textContent.includes("Keep this portable")',
	)
	let commentId = string(
		evaluate(
			session,
			'document.querySelector("[data-comment]").dataset.comment',
		),
	)
	browser(session, "click", `[data-action="jump-comment:${commentId}"]`)
	assert(
		evaluate(
			session,
			'(() => {let editor=document.querySelector("#editor"); return editor.value.slice(editor.selectionStart, editor.selectionEnd) === "quoted sentence"})()',
		),
		"an imported comment stays anchored to its quoted text",
	)
	browser(session, "click", '[data-action="tools"]')
	browser(session, "click", '[data-action="preview"]')
	wait(
		session,
		'getComputedStyle(document.querySelector("#preview").shadowRoot.querySelector(".content")).color === "rgb(18, 52, 86)" && document.querySelector("#preview").shadowRoot.querySelectorAll("img").length === 2 && [...document.querySelector("#preview").shadowRoot.querySelectorAll("img")].every(image => image.complete && image.naturalWidth > 0)',
	)
	assert(
		true,
		"the restored document renders its theme, stored image and whiteboard preview",
	)
	browser(session, "click", ".preview-back")
	browser(
		session,
		"click",
		'[data-action="drawing:' +
			string(
				evaluate(
					session,
					"document.querySelector('[data-action^=\"drawing:\"]').dataset.action.slice(8)",
				),
			) +
			'"]',
	)
	wait(session, `${boardMounted} && ${boardShapes} === 1`)
	assert(true, "the restored whiteboard opens its .tldr shapes in tldraw")
	browser(session, "click", "#dialog .dialog-close")
	wait(session, '!document.querySelector("#dialog").open')

	browser(session, "click", '[data-action="export-all"]')
	let backup = await unzip(await download(".zip"))
	let backupNames = backup.map(entry => entry.name)
	assert(
		backupNames.filter(name => /Portable source(-2)?\.md$/.test(name))
			.length === 2 &&
			backupNames.filter(name => name.endsWith(".comments.json")).length === 2,
		"a library backup packages every document's current snapshot and attachments",
	)

	browser(session, "set", "offline", "on")
	let encoder = new TextEncoder()
	upload(
		"Offline note.md",
		encoder.encode(
			"# Offline note\n\nSee [[Offline sketch]] and the anchor phrase.",
		),
		"text/markdown",
		[
			{
				name: "Offline note.comments.json",
				type: "application/json",
				data: encoder.encode(
					JSON.stringify({
						version: 1,
						comments: [
							{
								quote: "anchor phrase",
								from: 47,
								to: 60,
								resolved: false,
								replies: [{ body: "Imported offline", authorName: "Ada" }],
							},
						],
					}),
				),
			},
			{
				name: "Offline sketch.alkalye-drawing.json",
				type: "application/json",
				data: encoder.encode(
					JSON.stringify({
						format: "alkalye-drawing-v1",
						shapes: [
							{
								kind: "ellipse",
								color: "#aa3300",
								width: 3,
								points: [
									{ x: 0, y: 0 },
									{ x: 40, y: 30 },
								],
								text: "",
							},
						],
					}),
				),
			},
		],
	)
	wait(
		session,
		'document.querySelector("#toast")?.textContent.includes("Imported 2 documents") && document.querySelector("#editor")?.value.includes("Offline note")',
	)
	let offlineNote = string(evaluate(session, currentDocument))
	assert(
		evaluate(
			session,
			'/\\[\\[[0-9a-f-]{36}\\]\\]/.test(document.querySelector("alkalye-editor").source.value)',
		),
		"files imported together resolve wiki links to each other's new identities",
	)
	wait(session, "!!navigator.serviceWorker.controller")
	browser(session, "reload")
	wait(
		session,
		`${currentDocument} === ${JSON.stringify(offlineNote)} && document.querySelector("#editor")?.value.includes("Offline note")`,
	)
	browser(session, "click", '[data-action="comments"]')
	wait(
		session,
		'document.querySelector("[data-comments]")?.textContent.includes("Imported offline")',
	)
	assert(
		true,
		"offline imports persist their documents and comments across a reload",
	)
	let sketch = string(
		evaluate(
			session,
			'[...document.querySelectorAll("[data-doc]")].find(item => item.textContent.includes("Offline sketch"))?.dataset.doc ?? ""',
		),
	)
	browser(session, "click", `[data-doc="${sketch}"]`)
	wait(session, `${currentDocument} === ${JSON.stringify(sketch)}`)
	browser(session, "click", '[data-action="tools"]')
	browser(session, "click", '[data-action^="drawing:"]')
	wait(
		session,
		`${boardMounted} && ${boardShapes} === 1 && document.querySelector("alkalye-whiteboard").editor.getCurrentPageShapes()[0].props.geo === "ellipse"`,
	)
	assert(true, "an imported pre-tldraw drawing opens offline as tldraw shapes")
	browser(session, "click", "#dialog .dialog-close")
	browser(session, "click", `[data-doc="${offlineNote}"]`)
	wait(session, `${currentDocument} === ${JSON.stringify(offlineNote)}`)
	browser(session, "set", "offline", "off")
	wait(
		session,
		'document.querySelector("#save-status").textContent === "Saved"',
	)
	wait(
		session,
		`(() => { if (!window.libraryCheck) window.libraryCheck = setInterval(() => fetch("/api/library").then(response => response.json()).then(library => { window.serverDocuments = library.documents.map(entry => entry.document) }), 500); return [${JSON.stringify(imported)}, ${JSON.stringify(offlineNote)}].every(id => window.serverDocuments?.includes(id)) })()`,
	)
	evaluate(session, "clearInterval(window.libraryCheck)")
	assert(
		true,
		"documents imported offline publish to the server once the browser reconnects",
	)
	let noteRoute = string(evaluate(session, "location.pathname"))
	visit(session, noteRoute + "/timemachine")
	wait(
		session,
		'document.querySelector("#history-source").getAttribute("aria-busy") === "false" && document.querySelector("alkalye-history alkalye-editor").source.value.includes("Offline note")',
	)
	let latestPosition = string(
		evaluate(session, 'document.querySelector("#history-position").value'),
	)
	browser(session, "set", "offline", "on")
	browser(session, "reload")
	wait(
		session,
		'document.querySelector("#history-source")?.getAttribute("aria-busy") === "false" && document.querySelector("alkalye-history alkalye-editor")?.source.value.includes("Offline note")',
	)
	assert(
		evaluate(
			session,
			`document.querySelector("#history-position").value === ${JSON.stringify(latestPosition)} && document.querySelector("alkalye-history #editor").readOnly`,
		),
		"Downloaded time-machine history remains readable after a cold offline reload",
	)
	browser(session, "press", "Escape")
	wait(
		session,
		'document.querySelector("#editor") && !document.querySelector("alkalye-history")',
	)
	browser(session, "set", "offline", "off")
	console.log("Native portability browser verification passed")
} finally {
	try {
		browser(session, "close")
	} catch {}
	server.kill()
	await server.exited
}

function captureDownloads() {
	evaluate(
		session,
		'window.capturedDownloads = []; HTMLAnchorElement.prototype.click = function() { if (this.download) { let name = this.download; window.capturedDownloads.push({ name, data: fetch(this.href).then(response => response.arrayBuffer()).then(buffer => { let bytes = new Uint8Array(buffer), text = ""; for (let byte of bytes) text += String.fromCharCode(byte); return btoa(text) }) }) } }',
	)
}
async function download(suffix: string) {
	wait(
		session,
		`window.capturedDownloads.length > 0 && window.capturedDownloads.at(-1).name.endsWith(${JSON.stringify(suffix)})`,
	)
	evaluate(
		session,
		"window.capturedDownloads.at(-1).data.then(data => { window.downloadedData = data })",
	)
	wait(session, "typeof window.downloadedData === 'string'")
	let data = string(evaluate(session, "window.downloadedData"))
	evaluate(session, "delete window.downloadedData")
	return Uint8Array.from(atob(data), character => character.charCodeAt(0))
}
function upload(
	name: string,
	data: Uint8Array,
	type: string,
	extra: { name: string; type: string; data: Uint8Array }[] = [],
) {
	let files = [{ name, type, data }, ...extra].map(file => ({
		name: file.name,
		type: file.type,
		data: Buffer.from(file.data).toString("base64"),
	}))
	evaluate(
		session,
		`{let transfer=new DataTransfer();for(let file of ${JSON.stringify(files)})transfer.items.add(new File([Uint8Array.from(atob(file.data),c=>c.charCodeAt(0))],file.name,{type:file.type}));let input=document.querySelector("#import-files");input.files=transfer.files;input.dispatchEvent(new Event("change"))}`,
	)
}
