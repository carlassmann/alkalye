import {
	assert,
	browser,
	currentDocument,
	evaluate,
	visit,
	wait,
	workspaceLabel,
	workspaceValue,
} from "./browser-driver"

export function verifyNativeWorkspaces(
	owner: string,
	reader: string,
	subject: string,
	url: string,
) {
	// The workspace menu is a styled popover with creation inside it.
	browser(owner, "click", '[data-action="new-workspace"]')
	assert(
		evaluate(
			owner,
			'document.querySelector("#dialog h2").textContent === "Create workspace" && document.querySelector("#workspace").getAttribute("aria-haspopup") === "menu" && !document.querySelector("[data-library] select")',
		),
		"native workspace creation starts from the styled workspace menu",
	)
	browser(owner, "fill", '#dialog input[name="name"]', "Native team")
	// Enter, like Go on a phone keyboard, submits rather than cancels.
	browser(owner, "press", "Enter")
	wait(
		owner,
		`!document.querySelector("#dialog").open && ${workspaceLabel} === "Native team" && document.querySelector("#toast")?.textContent === "Workspace created"`,
	)
	let workspace = String(evaluate(owner, workspaceValue))
	browser(owner, "click", '[data-action="new"]')
	wait(
		owner,
		'document.querySelector("#editor")?.value === "" && document.querySelector("#save-status").textContent === "Saved"',
	)
	browser(owner, "fill", "#editor", "# Native team document\n\nWorkspace UI.")
	wait(owner, 'document.querySelector("#save-status").textContent === "Saved"')
	let document = String(evaluate(owner, currentDocument))
	assert(
		evaluate(
			owner,
			`fetch("/api/library").then(response => response.json()).then(library => library.documents.some(entry => entry.document === ${JSON.stringify(document)} && entry.workspace === ${JSON.stringify(workspace)}))`,
		),
		"native workspace creation places new documents in the selected workspace",
	)
	wait(
		owner,
		`location.pathname === ${JSON.stringify(`/app/spaces/${workspace}/doc/${document}`)}`,
	)
	browser(owner, "reload")
	wait(
		owner,
		`${workspaceLabel} === "Native team" && document.querySelector("#editor")?.value.startsWith("# Native team document")`,
	)
	assert(true, "a workspace document's path reopens it in that workspace")

	browser(owner, "click", '[data-action="manage-workspace"]')
	wait(
		owner,
		`location.pathname === ${JSON.stringify(`/app/spaces/${workspace}/settings`)} && document.querySelector('[data-workspace="invite"]') !== null`,
	)
	browser(owner, "click", '[data-workspace="invite"]')
	wait(
		owner,
		'document.querySelector("#dialog [data-add-member]") !== null && document.querySelector("#dialog [data-invitations]") !== null',
	)
	browser(owner, "fill", '[data-add-member] input[name="member"]', subject)
	browser(
		owner,
		"click",
		'[data-add-member] [role=option][data-value="reader"]',
	)
	browser(owner, "click", "[data-add-member] button.primary")
	wait(
		owner,
		`document.querySelector('[data-member-row="${subject}"] .member-role')?.textContent.trim() === "Reader"`,
	)
	browser(reader, "open", url + "/doc/" + document)
	wait(
		reader,
		'document.querySelector("#editor")?.value.startsWith("# Native team document")',
	)
	assert(
		evaluate(reader, 'document.querySelector("#editor").readOnly'),
		"native workspace settings grant reader access to its documents",
	)
	visit(reader, `/app/spaces/${workspace}/settings`)
	wait(
		reader,
		'document.querySelector("[data-workspace-settings] [data-workspace=leave]") !== null',
	)
	assert(
		evaluate(
			reader,
			'!document.querySelector("[data-workspace-settings] [data-add-member], [data-workspace-settings] [data-rename], [data-workspace-settings] [data-invitations]") && document.querySelector("[data-workspace-settings]").textContent.includes("Reader")',
		),
		"workspace settings show members only their role and leaving",
	)
	browser(reader, "back")
	wait(
		reader,
		`!document.querySelector("[data-workspace-settings]") && ${currentDocument} === ${JSON.stringify(document)}`,
	)
	assert(true, "Back leaves workspace settings for the open document")

	browser(
		owner,
		"click",
		`[data-member-row="${subject}"] [data-workspace="edit-member"]`,
	)
	wait(owner, 'document.querySelector("#dialog alkalye-picker") !== null')
	browser(owner, "focus", "#dialog alkalye-picker .menu-trigger")
	browser(owner, "press", "Enter")
	wait(
		owner,
		'document.querySelector("#dialog .menu-popover:popover-open") !== null && document.activeElement?.dataset.value === "reader"',
	)
	browser(owner, "press", "ArrowUp")
	browser(owner, "press", "Enter")
	browser(owner, "click", "#submit-dialog")
	wait(
		owner,
		`!document.querySelector("#dialog").open && document.querySelector('[data-member-row="${subject}"] .member-role')?.textContent.trim() === "Writer"`,
	)
	wait(reader, 'document.querySelector("#editor")?.readOnly === false')
	assert(
		true,
		"the member dialog changes roles through its keyboard-operated picker",
	)
	browser(owner, "click", '[data-member-row] [data-workspace="edit-member"]')
	browser(owner, "click", "#dialog [data-remove-member]")
	wait(owner, "!document.querySelector('[data-member-row]')")
	wait(reader, 'document.querySelector("#editor")?.readOnly !== false')
	assert(true, "removing a workspace member ends their access")

	browser(owner, "fill", '[data-rename] input[name="name"]', "Renamed team")
	browser(owner, "press", "Enter")
	wait(
		owner,
		`${workspaceLabel} === "Renamed team" && document.querySelector("#toast")?.textContent.includes("Workspace renamed")`,
	)
	browser(owner, "click", ".settings-back")
	wait(
		owner,
		`!document.querySelector("[data-workspace-settings]") && ${currentDocument} === ${JSON.stringify(document)}`,
	)
	browser(owner, "click", '[data-action="share"]')
	wait(owner, 'document.querySelector("#dialog input[name=member]") !== null')
	browser(owner, "fill", '#dialog input[name="member"]', subject)
	browser(owner, "click", '#dialog [role=option][data-value="writer"]')
	browser(owner, "click", "#submit-dialog")
	wait(owner, '!document.querySelector("#dialog").open')
	wait(reader, 'document.querySelector("#editor")?.readOnly === false')
	assert(
		true,
		"native document permissions grant a writer outside workspace membership",
	)
	wait(
		reader,
		`[...document.querySelectorAll("alkalye-workspace-menu [role=menuitemradio]")].every(item => !["Native team", "Renamed team"].includes(item.textContent.trim()))`,
	)
	assert(true, "removing a member removes the workspace from their library")
}
