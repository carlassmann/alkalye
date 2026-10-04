import { object, string } from "../src/shared/model"
import {
	assert,
	browser,
	chooseWorkspace,
	currentDocument,
	evaluate,
	wait,
	workspaceLabel,
	workspaceValue,
} from "./browser-driver"

// Document commands from the original application's File menu.
let server = Bun.spawn(["bun", "tests/browser-document-app.ts", "--serve"], {
	stdout: "pipe",
	stderr: "inherit",
})
let session = "native-commands-" + Date.now()
let guest = "native-commands-guest-" + Date.now()
try {
	let output = await server.stdout.getReader().read()
	if (!output.value) throw new Error("Missing native app URL")
	let url = new URL("/app", new TextDecoder().decode(output.value).trim()).href
	console.log(url)
	for (let name of [session, guest]) {
		browser(name, "open", url)
		wait(name, 'document.querySelector("[data-document-app]") !== null')
	}
	browser(session, "click", '[data-action="new"]')
	wait(
		session,
		'document.querySelector("#editor") && !document.querySelector("#editor").readOnly',
	)
	let document = string(evaluate(session, currentDocument))
	browser(
		session,
		"fill",
		"#editor",
		"# Field guide\n\nIntro.\n\n## Birds\n\nCrows.\n\n### Corvids\n\nRavens.",
	)
	wait(
		session,
		'document.querySelector("#save-status").textContent === "Saved"',
	)

	browser(session, "click", '[data-action="outline"]')
	wait(
		session,
		'document.querySelectorAll("#dialog [data-outline]").length === 3',
	)
	browser(session, "click", "#dialog [data-outline]:nth-child(2)")
	assert(
		evaluate(
			session,
			'(() => { let editor = document.querySelector("#editor"); return !document.querySelector("#dialog").open && editor.value.slice(editor.selectionStart, editor.selectionEnd) === "## Birds" })()',
		),
		"the document outline lists headings and jumps to one",
	)

	browser(session, "click", '[data-action="new"]')
	wait(
		session,
		`${currentDocument} !== ${JSON.stringify(document)} && document.querySelector("#editor") && !document.querySelector("#editor").readOnly`,
	)
	browser(
		session,
		"fill",
		"#editor",
		`# Trip log\n\nSee [[${document}|the guide]].`,
	)
	wait(
		session,
		'document.querySelector("#save-status").textContent === "Saved"',
	)
	browser(session, "click", `[data-doc="${document}"]`)
	wait(
		session,
		`${currentDocument} === ${JSON.stringify(document)} && document.querySelector("[data-backlinks]")?.textContent.includes("Trip log")`,
	)
	assert(true, "the tools panel lists documents that link to the open document")
	browser(session, "click", '[data-action="present"]')
	wait(
		session,
		'/^---\\nmode: "?present"?\\n---/.test(document.querySelector("#editor").value) && document.querySelector("#save-status").textContent === "Saved"',
	)
	wait(
		session,
		`fetch("/api/library").then(response => response.json()).then(library => library.documents.find(entry => entry.document === ${JSON.stringify(document)})?.kind === "slides")`,
	)
	browser(session, "click", '[data-action="present"]')
	wait(
		session,
		'document.querySelector("#editor").value.startsWith("# Field guide")',
	)
	assert(
		true,
		"turning a document into a presentation and back edits its frontmatter",
	)

	evaluate(
		session,
		`window.showSaveFilePicker = async options => { let root = await navigator.storage.getDirectory(); window.savedName = options.suggestedName; return root.getFileHandle("saved-copy.md", { create: true }) }`,
	)
	browser(session, "click", '[data-action="save-as"]')
	wait(
		session,
		'navigator.storage.getDirectory().then(root => root.getFileHandle("saved-copy.md")).then(handle => handle.getFile()).then(file => file.text()).then(text => text.startsWith("# Field guide") && window.savedName === "Field guide.md")',
	)
	assert(true, "save as writes the Markdown to a chosen file")

	browser(session, "click", '[data-action="new-workspace"]')
	wait(session, 'document.querySelector("#dialog input[name=name]") !== null')
	browser(session, "fill", "#dialog input[name=name]", "Field notes")
	browser(session, "click", "#submit-dialog")
	wait(session, `${workspaceLabel} === "Field notes"`)
	let workspace = string(evaluate(session, workspaceValue))
	chooseWorkspace(session, "All documents")
	browser(session, "click", '[data-action="move"]')
	wait(
		session,
		'document.querySelector("#dialog alkalye-picker[name=workspace]") !== null',
	)
	browser(
		session,
		"click",
		`#dialog alkalye-picker[name=workspace] [role=option][data-value="${workspace}"]`,
	)
	browser(session, "click", "#submit-dialog")
	wait(
		session,
		`fetch("/api/library").then(response => response.json()).then(library => library.documents.find(entry => entry.document === ${JSON.stringify(document)})?.workspace === ${JSON.stringify(workspace)})`,
	)
	assert(
		evaluate(session, `${currentDocument} === ${JSON.stringify(document)}`),
		"moving a document to another workspace keeps it open under the same identity",
	)

	browser(session, "click", '[data-action="share"]')
	wait(
		session,
		'document.querySelector("#dialog alkalye-invitations") !== null',
	)
	browser(session, "click", '[data-invite-role="writer"]')
	wait(
		session,
		'document.querySelector(".invitation-link input")?.value.includes("/invite#/doc/")',
	)
	let link = string(
		evaluate(session, 'document.querySelector(".invitation-link input").value'),
	)
	evaluate(session, 'document.querySelector("#dialog").close()')
	browser(guest, "open", link)
	wait(guest, 'document.querySelector("[data-invitation-accept]") !== null')
	browser(guest, "click", "[data-invitation-accept]")
	wait(
		guest,
		'document.querySelector("#editor")?.value.includes("Field guide")',
	)
	assert(
		evaluate(guest, 'document.querySelector("[data-action=delete]") === null'),
		"collaborators are offered Leave instead of Delete",
	)
	evaluate(guest, "window.confirm = () => true")
	browser(guest, "click", '[data-action="leave"]')
	wait(
		guest,
		`fetch("/api/library").then(response => response.json()).then(library => !library.documents.some(entry => entry.document === ${JSON.stringify(document)})) && !location.pathname.includes("/doc/")`,
	)
	assert(true, "leaving a shared document removes it for the collaborator")

	browser(session, "click", '[data-action="share"]')
	wait(
		session,
		'document.querySelector("#dialog [data-public-toggle]") !== null',
	)
	browser(session, "click", "#dialog [data-public-toggle]")
	wait(
		session,
		'document.querySelector("#dialog [aria-label=\'Public link\']")?.value.includes("/app/doc/")',
	)
	let publicLink = string(
		evaluate(
			session,
			"document.querySelector(\"#dialog [aria-label='Public link']\").value",
		),
	)
	evaluate(session, 'document.querySelector("#dialog").close()')
	browser(guest, "open", publicLink)
	wait(
		guest,
		'document.querySelector("#editor")?.value.includes("Field guide") && document.querySelector("#editor").readOnly',
	)
	assert(
		evaluate(
			guest,
			`fetch("/api/library").then(response => response.json()).then(library => !library.documents.some(entry => entry.document === ${JSON.stringify(document)}))`,
		),
		"a public link opens the document read-only without adding it to the reader's library",
	)
	browser(session, "click", '[data-action="share"]')
	wait(
		session,
		'document.querySelector("#dialog [data-public-toggle]")?.textContent.includes("Make private")',
	)
	browser(session, "click", "#dialog [data-public-toggle]")
	wait(
		guest,
		`fetch("/api/documents/${document}/snapshot").then(response => response.status === 404)`,
	)
	evaluate(session, 'document.querySelector("#dialog").close()')
	assert(true, "making the document private again revokes link readers")
	evaluate(session, "window.confirm = () => true")
	browser(session, "click", '[data-action="delete"]')
	wait(
		session,
		`!location.pathname.includes("/doc/") && ![...document.querySelectorAll("[data-doc]")].some(row => row.dataset.doc === ${JSON.stringify(document)})`,
	)
	browser(session, "click", '[data-action="trash-toggle"]')
	wait(
		session,
		`[...document.querySelectorAll("[data-doc]")].some(row => row.dataset.doc === ${JSON.stringify(document)}) && document.querySelector("#document-list").textContent.includes("Trash")`,
	)
	browser(session, "click", `[data-doc="${document}"]`)
	wait(
		session,
		'document.querySelector("#editor")?.readOnly === true && document.querySelector("[data-action=restore-document]") !== null',
	)
	assert(true, "deleted documents wait in the trash and open read-only")
	browser(session, "click", '[data-action="restore-document"]')
	wait(
		session,
		`document.querySelector("#editor")?.readOnly === false && fetch("/api/library").then(response => response.json()).then(library => library.documents.find(entry => entry.document === ${JSON.stringify(document)})?.deleted === false)`,
	)
	let library = object(
		evaluate(
			session,
			'fetch("/api/library").then(response => response.json())',
		),
	)
	assert(
		Array.isArray(library.documents),
		"restoring from the trash makes the document editable again",
	)
	console.log("Native document command browser verification passed")
} finally {
	for (let name of [session, guest])
		try {
			browser(name, "close")
		} catch {}
	server.kill()
	await server.exited
}
