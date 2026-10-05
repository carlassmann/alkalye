import { submitDialog } from "./browser-driver"
import { string } from "../src/shared/model"
import {
	assert,
	browser,
	chooseWorkspace,
	currentDocument,
	evaluate,
	wait,
	workspaceLabel,
} from "./browser-driver"

// The Origin Private File System provides real FileSystemDirectoryHandles, so
// the picker is the only part of the File System Access API that is stubbed.
let server = Bun.spawn(["bun", "tests/browser-document-app.ts", "--serve"], {
	stdout: "pipe",
	stderr: "inherit",
})
let session = "native-folders-" + Date.now()
try {
	let output = await server.stdout.getReader().read()
	if (!output.value) throw new Error("Missing native app URL")
	let url = new URL("/app", new TextDecoder().decode(output.value).trim()).href
	console.log(url)
	browser(session, "open", url)
	wait(session, 'document.querySelector("[data-document-app]") !== null')
	evaluate(
		session,
		`(async () => {
			let root = await navigator.storage.getDirectory()
			await root.removeEntry("Notes", { recursive: true }).catch(() => {})
			let notes = await root.getDirectoryHandle("Notes", { create: true })
			let projects = await notes.getDirectoryHandle("Projects", { create: true })
			await notes.getDirectoryHandle(".git", { create: true })
			async function write(directory, name, content) {
				let file = await directory.getFileHandle(name, { create: true })
				let writable = await file.createWritable()
				await writable.write(content)
				await writable.close()
			}
			await write(notes, "Welcome.md", "# Welcome\\n\\nLocal text.\\n")
			await write(projects, "Plan.md", "# Plan\\n\\nFirst line\\nSecond line\\nThird line\\n")
			await write(notes, "notes.json", "{}")
			window.showDirectoryPicker = async () => notes
			window.readDisk = async path => {
				let directory = notes
				let parts = path.split("/")
				let name = parts.pop()
				for (let part of parts) directory = await directory.getDirectoryHandle(part)
				return (await (await directory.getFileHandle(name)).getFile()).text()
			}
			window.writeDisk = async (path, content) => {
				let directory = notes
				let parts = path.split("/")
				let name = parts.pop()
				for (let part of parts) directory = await directory.getDirectoryHandle(part)
				await write(directory, name, content)
			}
			window.diskEntries = async () => {
				let names = []
				async function visit(directory, prefix) {
					for await (let [name, handle] of directory.entries()) {
						if (handle.kind === "directory") await visit(handle, prefix + name + "/")
						else names.push(prefix + name)
					}
				}
				await visit(notes, "")
				return names.sort()
			}
		})()`,
	)
	browser(session, "click", '[data-action="open-folder"]')
	wait(
		session,
		`${workspaceLabel} === "Notes" && document.querySelectorAll("[data-doc]").length === 2`,
	)
	assert(
		evaluate(
			session,
			'[...document.querySelectorAll("#document-list .folder-label")].some(label => label.textContent.includes("Projects")) && document.querySelector("#document-list").textContent.includes("Welcome") && !document.querySelector("#document-list").textContent.includes("notes")',
		),
		"an opened folder lists its Markdown files in the same sidebar with their folders",
	)
	wait(
		session,
		'document.querySelector("#editor")?.value.startsWith("# Plan") && document.querySelector("#save-status").textContent === "Saved to disk"',
	)
	let plan = string(evaluate(session, currentDocument))
	browser(
		session,
		"fill",
		"#editor",
		"# Plan\n\nFirst line\nSecond line\nThird line\nEdited in Alkalye.\n",
	)
	wait(
		session,
		'document.querySelector("#save-status").textContent === "Saved to disk" && window.readDisk("Projects/Plan.md").then(text => text.includes("Edited in Alkalye."))',
	)
	assert(true, "editing a folder document saves its Markdown back to disk")
	evaluate(
		session,
		'window.writeDisk("Projects/Plan.md", "# Plan\\n\\nFirst line changed elsewhere\\nSecond line\\nThird line\\nEdited in Alkalye.\\n").then(() => window.dispatchEvent(new Event("focus")))',
	)
	wait(
		session,
		'document.querySelector("#editor").value.includes("First line changed elsewhere")',
	)
	assert(true, "a change made by another program appears in the open editor")
	browser(
		session,
		"fill",
		"#editor",
		"# Plan\n\nFirst line changed elsewhere\nSecond line\nThird line\nEdited in Alkalye.\nLocal ending.\n",
	)
	evaluate(
		session,
		'window.writeDisk("Projects/Plan.md", "# Plan by disk\\n\\nFirst line changed elsewhere\\nSecond line\\nThird line\\nEdited in Alkalye.\\n")',
	)
	wait(
		session,
		'window.readDisk("Projects/Plan.md").then(text => text.startsWith("# Plan by disk") && text.includes("Local ending.")) && document.querySelector("#editor").value.startsWith("# Plan by disk")',
	)
	assert(
		true,
		"edits on different lines in the editor and on disk merge in both places",
	)
	evaluate(
		session,
		`(async () => {
			await window.writeDisk("Projects/Plan.md", "# Plan by disk\\n\\nFirst line changed elsewhere\\nSecond line from disk\\nThird line\\nEdited in Alkalye.\\nLocal ending.\\n")
			let editor = document.querySelector("#editor")
			editor.value = editor.value.replace("Second line", "Second line from the editor")
			editor.dispatchEvent(new InputEvent("input", { bubbles: true }))
		})()`,
	)
	wait(
		session,
		'document.querySelector("#save-status").textContent === "Changed on disk — choose a version"',
	)
	browser(session, "click", '[data-action="tools"]')
	assert(
		evaluate(
			session,
			'window.readDisk("Projects/Plan.md").then(text => text.includes("Second line from disk"))',
		),
		"a conflicting edit never overwrites the disk version",
	)
	browser(session, "click", '[data-action="file-use-disk"]')
	wait(
		session,
		'document.querySelector("#editor").value.includes("Second line from disk") && document.querySelector("[data-action=file-restore]") !== null',
	)
	browser(session, "click", '[data-action="file-restore"]')
	wait(
		session,
		'document.querySelector("#editor").value.includes("Second line from the editor") && window.readDisk("Projects/Plan.md").then(text => text.includes("Second line from the editor"))',
	)
	assert(
		true,
		"choosing the disk version keeps the editor's version recoverable and restorable",
	)

	evaluate(
		session,
		'let editor=document.querySelector("#editor"); editor.setSelectionRange(editor.value.length,editor.value.length); window.originalPickerClick = document.querySelector("#asset-files").click; document.querySelector("#asset-files").click = () => {}',
	)
	browser(session, "click", '[data-action="asset"]')
	evaluate(
		session,
		'(async()=>{let canvas=document.createElement("canvas");canvas.width=30;canvas.height=20;canvas.getContext("2d").fillRect(0,0,30,20);let blob=await new Promise(resolve=>canvas.toBlob(resolve));let transfer=new DataTransfer();transfer.items.add(new File([blob],"Map image.png",{type:"image/png"}));let input=document.querySelector("#asset-files");input.files=transfer.files;input.dispatchEvent(new Event("change"))})()',
	)
	wait(
		session,
		'document.querySelector("#editor").value.includes("](assets/Map-image.png)") && window.diskEntries().then(names => names.includes("Projects/assets/Map-image.png")) && window.readDisk("Projects/Plan.md").then(text => text.includes("](assets/Map-image.png)"))',
	)
	evaluate(
		session,
		'document.querySelector("#asset-files").click = window.originalPickerClick',
	)
	browser(session, "click", '[data-action="preview"]')
	wait(
		session,
		'[...document.querySelector("#preview").shadowRoot.querySelectorAll("img")].some(image => image.complete && image.naturalWidth === 30)',
	)
	assert(
		true,
		"attachments are written beside the file in assets/ and render from the folder",
	)
	browser(session, "press", "Escape")

	browser(session, "click", '[data-action="file-move"]')
	submitDialog(session, "Archive/Renamed plan.md")
	wait(
		session,
		'window.diskEntries().then(names => names.includes("Archive/Renamed plan.md") && !names.includes("Projects/Plan.md")) && document.querySelector("#document-list").textContent.includes("Renamed plan")',
	)
	assert(
		string(evaluate(session, currentDocument)) === plan,
		"renaming or moving a file keeps its open editing session",
	)
	browser(
		session,
		"fill",
		"#editor",
		"# Plan after move\n\n![Map image.png](../Projects/assets/Map-image.png)\n",
	)
	wait(
		session,
		'window.readDisk("Archive/Renamed plan.md").then(text => text.startsWith("# Plan after move"))',
	)
	assert(true, "edits after a move save to the file's new path")

	browser(session, "click", '[data-action="new"]')
	wait(
		session,
		`${currentDocument} !== ${JSON.stringify(plan)} && document.querySelector("#editor") && !document.querySelector("#editor").readOnly`,
	)
	browser(
		session,
		"fill",
		"#editor",
		"# Fresh note\n\nWritten into the folder.",
	)
	wait(
		session,
		'window.diskEntries().then(names => names.includes("Untitled.md")) && window.readDisk("Untitled.md").then(text => text.includes("Written into the folder."))',
	)
	assert(true, "a new document in a folder workspace becomes a Markdown file")

	evaluate(
		session,
		'window.writeDisk("Welcome.md", "# Welcome\\n\\nLocal text.\\nAdded while closed.\\n")',
	)
	browser(session, "reload")
	wait(
		session,
		'document.querySelector("[data-document-app]") !== null && document.querySelector("#editor")?.value.includes("Written into the folder.")',
	)
	evaluate(
		session,
		'window.readDisk = async path => { let root = await navigator.storage.getDirectory(); let directory = await root.getDirectoryHandle("Notes"); let parts = path.split("/"); let name = parts.pop(); for (let part of parts) directory = await directory.getDirectoryHandle(part); return (await (await directory.getFileHandle(name)).getFile()).text() }',
	)
	chooseWorkspace(session, "Notes")
	wait(
		session,
		'[...document.querySelectorAll("[data-doc]")].some(row => row.textContent.includes("Welcome"))',
	)
	evaluate(
		session,
		'[...document.querySelectorAll("[data-doc]")].find(row => row.textContent.includes("Welcome")).click()',
	)
	wait(
		session,
		'document.querySelector("#editor")?.value.includes("Added while closed.")',
	)
	assert(
		true,
		"after a reload the folder reopens and shows changes made while Alkalye was closed",
	)

	browser(session, "click", '[data-action="tools"]')
	browser(session, "click", '[data-action="file-delete"]')
	submitDialog(session)
	wait(
		session,
		'!document.querySelector("#document-list").textContent.includes("Welcome") && window.readDisk("Welcome.md").then(() => false, () => true)',
	)
	assert(true, "deleting a file removes it from disk and from the sidebar")

	evaluate(
		session,
		'window.originalQuery = FileSystemHandle.prototype.queryPermission; window.originalRequest = FileSystemHandle.prototype.requestPermission; FileSystemHandle.prototype.queryPermission = async () => "prompt"; FileSystemHandle.prototype.requestPermission = async () => "denied"',
	)
	browser(session, "click", '[data-action="manage-workspace"]')
	wait(
		session,
		'document.querySelector("[data-workspace-settings]")?.textContent.includes("Notes")',
	)
	browser(session, "click", '[data-workspace="refresh"]')
	wait(
		session,
		'!document.querySelector("#folder-status").hidden && document.querySelector("#folder-status").textContent.includes("Allow access")',
	)
	browser(session, "click", ".settings-back")
	wait(session, '!document.querySelector("[data-workspace-settings]")')
	evaluate(
		session,
		"FileSystemHandle.prototype.queryPermission = window.originalQuery; FileSystemHandle.prototype.requestPermission = window.originalRequest",
	)
	browser(session, "click", '#folder-status [data-action="reconnect-folder"]')
	wait(session, 'document.querySelector("#folder-status").hidden')
	assert(
		true,
		"a folder without permission asks for access and recovers once it is granted",
	)
	evaluate(
		session,
		`(async () => {
			let root = await navigator.storage.getDirectory()
			let handle = await root.getFileHandle("Loose note.md", { create: true })
			let writable = await handle.createWritable()
			await writable.write("# Loose note\\n\\nOpened on its own.\\n")
			await writable.close()
			window.showOpenFilePicker = async () => [handle]
			window.readLoose = async () => (await (await root.getFileHandle("Loose note.md")).getFile()).text()
			window.writeLoose = async content => { let writable = await handle.createWritable(); await writable.write(content); await writable.close() }
		})()`,
	)
	browser(session, "click", '[data-action="open-file"]')
	wait(
		session,
		'document.querySelector("#editor")?.value.includes("Opened on its own.") && document.querySelector("#workspace").textContent.trim() === "Opened files"',
	)
	browser(
		session,
		"fill",
		"#editor",
		"# Loose note\n\nOpened on its own.\nEdited in place.\n",
	)
	wait(
		session,
		'window.readLoose().then(text => text.includes("Edited in place."))',
	)
	evaluate(
		session,
		'window.writeLoose("# Loose note, renamed elsewhere\\n\\nOpened on its own.\\nEdited in place.\\n").then(() => window.dispatchEvent(new Event("focus")))',
	)
	wait(
		session,
		'document.querySelector("#editor").value.startsWith("# Loose note, renamed elsewhere")',
	)
	browser(session, "click", '[data-action="open-file"]')
	assert(
		evaluate(session, 'document.querySelectorAll("[data-doc]").length') === 1,
		"a single opened file edits in place, merges outside changes and is not listed twice",
	)
	browser(session, "click", '[data-action="file-close"]')
	wait(
		session,
		'!document.querySelector("[data-doc]") && window.readLoose().then(text => text.includes("Edited in place."))',
	)
	assert(true, "closing an opened file forgets it without deleting it")
	assert(
		evaluate(
			session,
			'fetch("/api/library").then(response => response.json()).then(library => library.documents.every(entry => !entry.document.startsWith("local-")) && library.workspaces.every(space => !space.workspace.startsWith("local:")))',
		),
		"folder documents stay on this device and are never published to the account",
	)
	console.log("Native folder browser verification passed")
} finally {
	try {
		browser(session, "close")
	} catch {}
	server.kill()
	await server.exited
}
