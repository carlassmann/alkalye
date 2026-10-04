import {
	assert,
	browser,
	evaluate,
	wait,
	currentDocument,
} from "./browser-driver"

export function verifyNativeLibrary(session: string) {
	let original = String(evaluate(session, currentDocument))
	browser(session, "click", '[data-action="tools"]')
	browser(session, "click", '[data-action="properties"]')
	browser(session, "fill", '#dialog [name="title"]', "Properties document")
	browser(session, "fill", '#dialog [name="path"]', "Notes/Work")
	browser(session, "fill", '#dialog [name="tags"]', "writing, platform")
	browser(session, "click", "#submit-dialog")
	wait(
		session,
		'!document.querySelector("#dialog").open && document.querySelector("#document-title").textContent === "Properties document" && document.querySelector("#save-status").textContent === "Saved"',
	)
	assert(
		evaluate(
			session,
			'document.querySelector("#editor").value.includes("Notes/Work") && document.querySelector("#editor").value.includes("writing") && document.querySelector("#editor").value.endsWith("alpha alpha beta") && document.querySelector("#document-list").textContent.includes("Work")',
		),
		"properties change frontmatter and the derived folder sidebar together",
	)
	let source = String(
		evaluate(session, 'document.querySelector("#editor").value'),
	)
	evaluate(
		session,
		`document.querySelector('[data-doc="${original}"]').dispatchEvent(new MouseEvent("contextmenu", {bubbles:true, clientX:80, clientY:100}))`,
	)
	assert(
		evaluate(
			session,
			'document.querySelector("[data-context-menu]").matches(":popover-open")',
		),
		"sidebar context menu uses the native Popover API",
	)
	evaluate(
		session,
		'[...document.querySelectorAll("[data-context-menu] button")].find(button => button.textContent === "Duplicate document").click()',
	)
	wait(
		session,
		`${currentDocument} !== ${JSON.stringify(original)} && document.querySelector("#document-title").textContent === "Properties document (copy)" && document.querySelector("#editor").value.endsWith("alpha alpha beta")`,
	)
	assert(
		evaluate(
			session,
			'document.querySelector("#editor").value.includes("Notes/Work") && document.querySelector("#editor").value.includes("platform")',
		),
		"duplicate preserves the source’s metadata and opens its own document",
	)
	browser(session, "click", `[data-doc="${original}"]`)
	wait(
		session,
		`document.querySelector("#editor").value === ${JSON.stringify(source)}`,
	)
	browser(session, "press", "Control+z")
	wait(
		session,
		'!document.querySelector("#editor").value.includes("Notes/Work") && document.querySelector("#editor").value.endsWith("alpha alpha beta")',
	)
	assert(
		true,
		"one undo restores all properties without changing document content",
	)
}
