import {
	assert,
	browser,
	currentDocument,
	evaluate,
	wait,
	serverAddress,
} from "./browser-driver"
import { string } from "../src/shared/model"

let server = Bun.spawn(["bun", "tests/browser-document-app.ts", "--serve"], {
	stdout: "pipe",
	stderr: "inherit",
})
let session = "document-sharing-" + Date.now()
let collaborator = session + "-collaborator"
try {
	let url = new URL("/app", await serverAddress(server.stdout)).href
	browser(session, "set", "viewport", "1440", "900")
	browser(session, "open", url)
	wait(
		session,
		'Boolean(document.querySelector("#editor")) && !document.querySelector("#app").hasAttribute("aria-busy")',
	)
	browser(session, "click", '[data-action="new"]')
	let sharedDocument = string(evaluate(session, currentDocument))
	let version = evaluate(
		session,
		'document.querySelector("#save-status").dataset.version',
	)
	browser(session, "fill", "#editor", "# Shared from the library")
	wait(
		session,
		`document.querySelector("#save-status").getAttribute("aria-busy") === "false" && document.querySelector("#save-status").dataset.pending === "0" && document.querySelector("#save-status").dataset.version !== ${JSON.stringify(version)}`,
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
	browser(session, "press", "i")
	wait(
		session,
		'document.activeElement?.textContent === "Invite collaborators"',
	)
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
	let link = string(
		evaluate(session, 'document.querySelector(".invitation-link input").value'),
	)
	browser(collaborator, "open", url)
	wait(
		collaborator,
		'document.querySelector("#editor") && !document.querySelector("#app").hasAttribute("aria-busy")',
	)
	assert(
		evaluate(
			collaborator,
			'fetch("/api/accounts/preferences", {method:"PUT", headers:{"content-type":"application/json"}, body:JSON.stringify({request:"sharing-name",patch:{name:"Invitation writer"}})}).then(response => response.ok)',
		),
		"Collaborator saves their display name",
	)
	browser(collaborator, "open", link)
	wait(
		collaborator,
		'document.querySelector("[data-invitation-accept]") !== null',
	)
	browser(collaborator, "click", "[data-invitation-accept]")
	wait(
		collaborator,
		`${currentDocument} === ${JSON.stringify(sharedDocument)} && document.querySelector("#editor")?.readOnly === false`,
	)
	wait(
		session,
		'document.querySelector(".invitation-list")?.textContent.includes("Invitation writer")',
	)
	assert(
		true,
		"Accepting a document link updates its open sharing dialog with the joined person's name",
	)
	assert(
		evaluate(
			collaborator,
			'fetch("/api/accounts/preferences", {method:"PUT", headers:{"content-type":"application/json"}, body:JSON.stringify({request:"sharing-rename",patch:{name:"Renamed writer"}})}).then(response => response.ok)',
		),
		"Collaborator changes their display name",
	)
	wait(
		session,
		'document.querySelector(".invitation-list")?.textContent.includes("Renamed writer") && !document.querySelector(".invitation-list")?.textContent.includes("Invitation writer")',
	)
	assert(
		true,
		"A collaborator's name change updates the open sharing dialog without reconnecting",
	)
	browser(
		collaborator,
		"fill",
		"#editor",
		"# Shared from the library\n\nWritten by the invited collaborator.",
	)
	wait(
		collaborator,
		'document.querySelector("#save-status").getAttribute("aria-busy") === "false" && document.querySelector("#save-status").dataset.pending === "0"',
	)
	wait(
		session,
		'document.querySelector("alkalye-editor").source.value.includes("Written by the invited collaborator.")',
	)
	assert(
		true,
		"A writer invited from another account edits the owner's live document",
	)
	evaluate(
		collaborator,
		'Object.defineProperty(navigator, "onLine", {value:false, configurable:true}); dispatchEvent(new Event("offline")); true',
	)
	let recoveredSource =
		"# Shared from the library\n\nOffline work that must survive revoked access."
	browser(collaborator, "fill", "#editor", recoveredSource)
	wait(
		collaborator,
		'document.querySelector("#save-status").getAttribute("aria-busy") === "false" && Number(document.querySelector("#save-status").dataset.pending) > 0',
	)
	browser(session, "click", "[data-revoke]")
	wait(
		session,
		'document.querySelector(".invitation-list")?.textContent.includes("No active links")',
	)
	wait(collaborator, 'document.querySelector("#editor")?.readOnly !== false')
	evaluate(
		collaborator,
		'delete navigator.onLine; dispatchEvent(new Event("online")); true',
	)
	wait(
		collaborator,
		'document.querySelector("alkalye-sync-recovery")?.hidden === false',
	)
	assert(
		evaluate(
			collaborator,
			'document.querySelector("alkalye-editor").source.value',
		) === recoveredSource,
		"Revoked permission preserves the exact offline source",
	)
	let pendingBeforeRecovery = evaluate(
		collaborator,
		'document.querySelector("#save-status").dataset.pending',
	)
	browser(collaborator, "click", '[data-action="retry-sync"]')
	wait(
		collaborator,
		`document.querySelector("alkalye-sync-recovery")?.hidden === false && !document.querySelector('[data-action="retry-sync"]').disabled`,
	)
	assert(
		evaluate(
			collaborator,
			'document.querySelector("#save-status").dataset.pending',
		) === pendingBeforeRecovery,
		"Retry without restored access cannot discard pending changes",
	)
	evaluate(
		collaborator,
		`(() => {
		let click = HTMLAnchorElement.prototype.click
		HTMLAnchorElement.prototype.click = function() {
			if (this.download) { window.recoveredDownload = fetch(this.href).then(response => response.text()); return }
			return click.call(this)
		}
		return true
	})()`,
	)
	browser(
		collaborator,
		"click",
		'alkalye-sync-recovery [data-action="recover-export"]',
	)
	wait(collaborator, "Boolean(window.recoveredDownload)")
	assert(
		evaluate(collaborator, "window.recoveredDownload") === recoveredSource,
		"Recovery export works after server access is revoked",
	)
	browser(collaborator, "click", '[data-action="recover-copy"]')
	wait(
		collaborator,
		`${currentDocument} !== ${JSON.stringify(sharedDocument)} && !document.querySelector("#app").hasAttribute("aria-busy")`,
	)
	assert(
		evaluate(
			collaborator,
			'document.querySelector("alkalye-editor").source.value.includes("Offline work that must survive revoked access.") && document.querySelector("alkalye-sync-recovery").hidden',
		),
		"A recovery copy opens with the pending text in the account's personal workspace",
	)
	wait(
		collaborator,
		'document.querySelector("#save-status").dataset.pending === "0"',
	)
	browser(collaborator, "open", new URL("/app/doc/" + sharedDocument, url).href)
	wait(
		collaborator,
		'document.querySelector("alkalye-sync-recovery")?.hidden === false && !document.querySelector("#app").hasAttribute("aria-busy")',
	)
	assert(
		evaluate(
			collaborator,
			'document.querySelector("alkalye-editor").source.value',
		) === recoveredSource &&
			evaluate(
				collaborator,
				'document.querySelector("#save-status").dataset.pending',
			) === pendingBeforeRecovery,
		"Saving a personal copy and reloading preserves the original pending journal",
	)

	assert(
		evaluate(
			collaborator,
			`fetch("/api/documents/${sharedDocument}/snapshot").then(response => response.status === 404)`,
		),
		"Revoking the document link immediately blocks the joined account's snapshot access",
	)
	browser(session, "click", '[data-invite-role="writer"]')
	wait(
		session,
		`document.querySelector(".invitation-link input")?.value.includes(${JSON.stringify("/doc/" + sharedDocument + "/invite/")})`,
	)
	let restoredLink = string(
		evaluate(session, 'document.querySelector(".invitation-link input").value'),
	)
	browser(collaborator, "open", restoredLink)
	wait(
		collaborator,
		'document.querySelector("[data-invitation-accept]") !== null',
	)
	browser(collaborator, "click", "[data-invitation-accept]")
	wait(
		collaborator,
		`${currentDocument} === ${JSON.stringify(sharedDocument)} && document.querySelector("#editor")?.readOnly === false && document.querySelector("#save-status").dataset.pending === "0" && document.querySelector("alkalye-sync-recovery").hidden`,
	)
	wait(
		session,
		'document.querySelector("alkalye-editor").source.value.includes("Offline work that must survive revoked access.")',
	)
	assert(
		true,
		"Restored writer access syncs the retained original actions and clears recovery",
	)
	evaluate(
		collaborator,
		'Object.defineProperty(navigator, "onLine", {value:false, configurable:true}); dispatchEvent(new Event("offline")); true',
	)
	let downgradedSource =
		recoveredSource + "\n\nPending work before a reader downgrade."
	browser(collaborator, "fill", "#editor", downgradedSource)
	wait(
		collaborator,
		'document.querySelector("#save-status").getAttribute("aria-busy") === "false" && Number(document.querySelector("#save-status").dataset.pending) > 0',
	)
	browser(session, "click", "[data-revoke]")
	wait(
		session,
		'document.querySelector(".invitation-list")?.textContent.includes("No active links")',
	)
	browser(session, "click", '[data-invite-role="reader"]')
	wait(
		session,
		`document.querySelector(".invitation-link input")?.value.includes(${JSON.stringify("/doc/" + sharedDocument + "/invite/")})`,
	)
	let readerLink = string(
		evaluate(session, 'document.querySelector(".invitation-link input").value'),
	)
	browser(collaborator, "open", readerLink)
	wait(
		collaborator,
		'document.querySelector("[data-invitation-accept]") !== null',
	)
	browser(collaborator, "click", "[data-invitation-accept]")
	wait(
		collaborator,
		`${currentDocument} === ${JSON.stringify(sharedDocument)} && document.querySelector("alkalye-sync-recovery")?.hidden === false && document.querySelector("#editor")?.readOnly === true`,
	)
	assert(
		evaluate(
			collaborator,
			'document.querySelector("alkalye-editor").source.value',
		) === downgradedSource,
		"A writer downgraded to reader keeps pending work and sees recovery",
	)
	assert(
		evaluate(
			collaborator,
			`fetch("/api/documents/${sharedDocument}/snapshot").then(response => response.status === 200)`,
		),
		"Recovery also covers write denial while snapshot read access remains",
	)
	browser(collaborator, "set", "viewport", "390", "844")
	assert(
		evaluate(
			collaborator,
			`document.documentElement.scrollWidth <= innerWidth && document.querySelector('[data-action="recover-export"]').checkVisibility()`,
		),
		"Mobile recovery controls remain visible without horizontal overflow",
	)
} finally {
	try {
		browser(session, "close")
		browser(collaborator, "close")
	} catch {}
	server.kill()
	await server.exited
}
