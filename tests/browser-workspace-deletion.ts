import {
	assert,
	browser,
	evaluate,
	wait,
	workspaceValue,
	currentDocument,
} from "./browser-driver"

let server = Bun.spawn(["bun", "tests/browser-document-app.ts", "--serve"], {
	stdout: "pipe",
	stderr: "inherit",
})
let session = "workspace-deletion-" + Date.now()
try {
	let output = await server.stdout.getReader().read()
	if (!output.value) throw new Error("Missing app URL")
	let url = new URL("/app", new TextDecoder().decode(output.value).trim()).href
	browser(session, "open", url)
	wait(session, 'document.querySelector("[data-document-app]") !== null')
	browser(session, "click", '[data-action="new-workspace"]')
	browser(session, "fill", '#dialog input[name="name"]', "Temporary space")
	browser(session, "click", "#submit-dialog")
	wait(
		session,
		'!document.querySelector("#dialog").open && document.querySelector("#workspace").textContent.includes("Temporary space")',
	)
	let workspace = String(evaluate(session, workspaceValue))
	browser(session, "click", '[data-action="new"]')
	wait(session, 'document.querySelector("#editor")?.readOnly === false')
	let document = String(evaluate(session, currentDocument))
	browser(session, "click", '[data-action="manage-workspace"]')
	wait(session, 'document.querySelector("[data-workspace=delete]") !== null')
	browser(session, "click", '[data-workspace="delete"]')
	assert(
		evaluate(session, 'document.querySelector("#submit-dialog").disabled'),
		"Workspace deletion starts disabled",
	)
	browser(session, "fill", '#dialog [name="name"]', "Temporary space")
	assert(
		evaluate(session, 'document.querySelector("#submit-dialog").disabled'),
		"The workspace name alone cannot confirm deletion",
	)
	browser(session, "fill", '#dialog [name="phrase"]', "yes, delete permanently")
	assert(
		evaluate(session, '!document.querySelector("#submit-dialog").disabled'),
		"Both original confirmation fields enable deletion",
	)
	browser(session, "press", "Escape")
	wait(session, '!document.querySelector("#dialog").open')
	assert(
		evaluate(
			session,
			`fetch("/api/library").then(response => response.json()).then(library => library.workspaces.some(space => space.workspace === ${JSON.stringify(workspace)}))`,
		),
		"Cancelling preserves the workspace",
	)
	browser(session, "click", '[data-workspace="delete"]')
	browser(session, "fill", '#dialog [name="name"]', "Temporary space")
	browser(session, "fill", '#dialog [name="phrase"]', "yes, delete permanently")
	browser(session, "click", "#submit-dialog")
	wait(
		session,
		'!document.querySelector("[data-workspace-settings]") && location.pathname === "/app"',
	)
	wait(
		session,
		`fetch("/api/library").then(response => response.json()).then(library => !library.workspaces.some(space => space.workspace === ${JSON.stringify(workspace)}) && !library.documents.some(entry => entry.document === ${JSON.stringify(document)}))`,
	)
	assert(
		true,
		"Confirmed deletion removes the workspace and documents and leaves settings",
	)
	assert(
		evaluate(
			session,
			`fetch("/api/documents/${document}/snapshot").then(response => response.status === 404)`,
		),
		"Deleted workspace documents cannot reopen by their URL",
	)
} finally {
	browser(session, "close")
	server.kill()
	await server.exited
}
