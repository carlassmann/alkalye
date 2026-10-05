import {
	assert,
	browser,
	currentDocument,
	evaluate,
	wait,
} from "./browser-driver"
import { string } from "../src/shared/model"

let server = Bun.spawn(["bun", "tests/browser-document-app.ts", "--serve"], {
	stdout: "pipe",
	stderr: "inherit",
})
let session = "document-sharing-" + Date.now()
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
	let sharedDocument = string(evaluate(session, currentDocument))
	browser(session, "fill", "#editor", "# Shared from the library")
	wait(
		session,
		'document.querySelector("#save-status").textContent === "Saved"',
	)
	browser(session, "click", '[data-action="new"]')
	wait(session, `${currentDocument} !== ${JSON.stringify(sharedDocument)}`)
	if (
		!evaluate(
			session,
			'document.querySelector("#app").classList.contains("library-open")',
		)
	)
		browser(session, "click", '[data-action="library"]')
	evaluate(
		session,
		`document.querySelector('[data-doc="${sharedDocument}"]').dispatchEvent(new MouseEvent("contextmenu", {bubbles:true,cancelable:true,clientX:120,clientY:240}))`,
	)
	assert(
		evaluate(
			session,
			'document.querySelector("[data-context-menu]").textContent.includes("Invite collaborators")',
		),
		"Document context menu offers invitations",
	)
	browser(session, "press", "ArrowDown")
	browser(session, "press", "Enter")
	wait(
		session,
		'document.querySelector("#dialog alkalye-invitations") !== null',
	)
	assert(
		evaluate(session, currentDocument) === sharedDocument,
		"Sharing opens the chosen document instead of the previously selected one",
	)
	browser(session, "click", '[data-invite-role="writer"]')
	wait(
		session,
		`document.querySelector(".invitation-link input")?.value.includes(${JSON.stringify("/doc/" + sharedDocument + "/invite/")})`,
	)
	assert(
		evaluate(
			session,
			`document.querySelector(".invitation-link input").value.includes(${JSON.stringify(sharedDocument)})`,
		),
		"Context menu sharing creates an invitation for the chosen document",
	)
} finally {
	try {
		browser(session, "close")
	} catch {}
	server.kill()
	await server.exited
}
