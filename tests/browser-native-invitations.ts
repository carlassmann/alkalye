import { verifyReaderPresence } from "./browser-native-presence"
import { object, string } from "../src/shared/model"
import {
	assert,
	browser,
	currentDocument,
	evaluate,
	wait,
	workspaceLabel,
	workspaceValue,
} from "./browser-driver"

let server = Bun.spawn(["bun", "tests/browser-document-app.ts", "--serve"], {
	stdout: "pipe",
	stderr: "inherit",
})
let owner = "invite-owner-" + Date.now()
let guest = "invite-guest-" + Date.now()
let reader = "invite-reader-" + Date.now()
try {
	let output = await server.stdout.getReader().read()
	if (!output.value) throw new Error("Missing native app URL")
	let origin = new URL(new TextDecoder().decode(output.value).trim()).origin
	let url = new URL("/app", origin).href
	console.log(url)
	for (let session of [owner, guest, reader]) {
		browser(session, "open", url)
		wait(session, 'document.querySelector("[data-document-app]") !== null')
		wait(
			session,
			'fetch("/api/accounts/session").then(response => response.ok)',
		)
	}
	for (let [session, name] of [
		[owner, "Harbour owner"],
		[guest, "Invited writer"],
		[reader, "Invited reader"],
	]) {
		if (!session || !name) continue
		assert(
			evaluate(
				session,
				`fetch("/api/accounts/preferences", {method:"PUT", headers:{"content-type":"application/json"}, body:JSON.stringify({request:"invite-profile-name",patch:{name:${JSON.stringify(name)}}})}).then(response => response.ok)`,
			),
			"saved account display name",
		)
	}
	browser(owner, "click", '[data-action="new"]')
	wait(
		owner,
		'document.querySelector("#editor") && !document.querySelector("#editor").readOnly',
	)
	let document = string(evaluate(owner, currentDocument))
	browser(owner, "fill", "#editor", "# Harbour plan\n\nShared by link.")
	wait(owner, 'document.querySelector("#save-status").textContent === "Saved"')
	browser(owner, "click", '[data-action="tools"]')
	assert(
		evaluate(
			owner,
			'document.querySelector("[data-action=share]").textContent.includes("Invite collaborators")',
		),
		"document invitations have a visible, explicit sidebar entry",
	)
	browser(owner, "click", '[data-action="share"]')
	wait(owner, 'document.querySelector("#dialog alkalye-invitations") !== null')
	browser(owner, "click", '[data-invite-role="writer"]')
	wait(
		owner,
		'document.querySelector(".invitation-link input")?.value.includes("/invite#/doc/")',
	)
	let writerLink = string(
		evaluate(owner, 'document.querySelector(".invitation-link input").value'),
	)
	assert(
		writerLink.startsWith(origin + "/invite#/doc/" + document + "/invite/"),
		"the owner creates a writer link from the document's share dialog",
	)
	wait(
		owner,
		'document.querySelector(".invitation-list")?.textContent.includes("Pending")',
	)

	browser(guest, "open", writerLink)
	wait(
		guest,
		'document.querySelector("[data-invitation-screen]")?.textContent.includes("Harbour plan")',
	)
	assert(
		evaluate(
			guest,
			'document.querySelector("[data-invitation-screen]").textContent.includes("invites you to edit")',
		),
		"the invitation screen names the document and role before joining",
	)
	browser(guest, "click", "[data-invitation-accept]")
	wait(
		guest,
		`!location.pathname.startsWith("/invite") && ${currentDocument} === ${JSON.stringify(document)} && document.querySelector("#editor")?.value.includes("Shared by link.") && document.querySelector("#editor").readOnly === false`,
	)
	assert(
		evaluate(
			guest,
			`[...document.querySelectorAll("[data-doc]")].some(row => row.dataset.doc === ${JSON.stringify(document)})`,
		),
		"accepting a writer link opens the document and lists it in the library",
	)
	let edited = "# Harbour plan\n\nShared by link.\n\nGuest addition."
	browser(guest, "fill", "#editor", edited)
	wait(guest, 'document.querySelector("#save-status").textContent === "Saved"')
	wait(
		owner,
		'document.querySelector("#editor")?.value === ' + JSON.stringify(edited),
	)
	assert(true, "the invited writer's edit reaches the owner live")

	evaluate(owner, 'document.querySelector("#dialog").close()')
	browser(owner, "click", '[data-action="share"]')
	wait(
		owner,
		'document.querySelector(".invitation-list")?.textContent.includes("1 person joined")',
	)
	browser(owner, "click", '[data-invite-role="reader"]')
	wait(
		owner,
		'document.querySelector(".invitation-link input")?.value.includes("/invite#/doc/")',
	)
	let readerLink = string(
		evaluate(owner, 'document.querySelector(".invitation-link input").value'),
	)
	browser(reader, "open", readerLink)
	wait(
		reader,
		'document.querySelector("[data-invitation-screen]")?.textContent.includes("invites you to read")',
	)
	browser(reader, "click", "[data-invitation-accept]")
	wait(
		reader,
		'document.querySelector("#editor")?.value.includes("Guest addition.")',
	)
	assert(
		evaluate(reader, 'document.querySelector("#editor").readOnly'),
		"a reader link opens the document read-only",
	)

	verifyReaderPresence(owner, reader, document)
	let writerInvitation = string(
		evaluate(
			owner,
			'[...document.querySelectorAll(".invitation-list [data-invitation]")].find(row => row.textContent.includes("Writer link")).dataset.invitation',
		),
	)
	browser(owner, "click", `[data-revoke="${writerInvitation}"]`)
	wait(
		owner,
		`!document.querySelector('[data-invitation="${writerInvitation}"]')`,
	)
	evaluate(guest, 'window.dispatchEvent(new Event("focus"))')
	wait(guest, 'document.querySelector("#editor")?.readOnly === true')
	assert(
		evaluate(
			guest,
			`fetch("/api/documents/${document}/snapshot").then(response => response.status)`,
		) === 404,
		"revoking the link removes the access of everyone who joined through it",
	)
	assert(
		evaluate(reader, 'document.querySelector("#editor").readOnly') === true &&
			evaluate(
				reader,
				`fetch("/api/documents/${document}/snapshot").then(response => response.status)`,
			) === 200,
		"other links keep their access when one link is revoked",
	)
	browser(guest, "open", writerLink)
	wait(
		guest,
		'document.querySelector("[data-invitation-screen]")?.textContent.includes("was revoked")',
	)
	assert(true, "a revoked link explains that it was revoked")

	evaluate(owner, 'document.querySelector("#dialog").close()')
	browser(owner, "click", '[data-action="new-workspace"]')
	wait(owner, 'document.querySelector("#dialog input[name=name]") !== null')
	browser(owner, "fill", "#dialog input[name=name]", "Harbour crew")
	browser(owner, "click", "#submit-dialog")
	wait(owner, `${workspaceLabel} === "Harbour crew"`)
	let workspace = string(evaluate(owner, workspaceValue))
	browser(owner, "click", '[data-action="manage-workspace"]')
	browser(owner, "click", '[data-workspace="invite"]')
	wait(owner, 'document.querySelector("#dialog alkalye-invitations") !== null')
	browser(owner, "click", '[data-invite-role="writer"]')
	wait(
		owner,
		'document.querySelector(".invitation-link input")?.value.includes("/invite#/space/")',
	)
	let workspaceLink = string(
		evaluate(owner, 'document.querySelector(".invitation-link input").value'),
	)
	browser(guest, "open", workspaceLink)
	wait(
		guest,
		'document.querySelector("[data-invitation-screen]")?.textContent.includes("Harbour crew")',
	)
	browser(guest, "click", "[data-invitation-accept]")
	wait(
		guest,
		`${workspaceValue} === ${JSON.stringify(workspace)} && location.pathname === ${JSON.stringify("/app/spaces/" + workspace)}`,
	)
	evaluate(owner, 'document.querySelector("#dialog").close()')
	wait(
		owner,
		'document.querySelector(".space-members").textContent.includes("Invited writer")',
	)
	assert(
		evaluate(
			owner,
			'document.querySelector(".space-members").textContent.includes("Harbour owner") && document.querySelector(".space-members").textContent.includes("via invitation")',
		),
		"space settings show invite members and saved names without requiring a reload",
	)
	browser(guest, "click", '[data-action="new"]')
	wait(
		guest,
		'document.querySelector("#editor") && !document.querySelector("#editor").readOnly',
	)
	browser(guest, "fill", "#editor", "# Crew note")
	wait(guest, 'document.querySelector("#save-status").textContent === "Saved"')
	let library = object(
		evaluate(owner, 'fetch("/api/library").then(response => response.json())'),
	)
	assert(
		Array.isArray(library.documents) &&
			library.documents.some(
				entry =>
					object(entry).workspace === workspace &&
					object(object(entry).metadata).title === "Crew note",
			),
		"a workspace writer link lets the guest create documents in that workspace",
	)
	console.log("Native invitation browser verification passed")
} finally {
	for (let session of [owner, guest, reader])
		try {
			browser(session, "close")
		} catch {}
	server.kill()
	await server.exited
}
