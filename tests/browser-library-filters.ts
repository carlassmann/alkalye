import { assert, browser, evaluate, wait } from "./browser-driver"

let server = Bun.spawn(["bun", "tests/browser-document-app.ts", "--serve"], {
	stdout: "pipe",
	stderr: "inherit",
})
let session = "library-filters-" + Date.now()
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
	if (
		!evaluate(
			session,
			'document.querySelector("#app").classList.contains("library-open")',
		)
	)
		browser(session, "click", '[data-action="library"]')
	browser(session, "set", "viewport", "504", "842")
	browser(session, "click", '[data-action="library-options"]')
	wait(
		session,
		'document.querySelector("#library-options").matches(":popover-open")',
	)
	assert(
		evaluate(
			session,
			'(() => {let r=document.querySelector("#library-options").getBoundingClientRect();return r.left>=8 && r.right<=innerWidth-8 && r.top>=8 && r.bottom<=innerHeight-8 && r.width===192})()',
		),
		"Mobile library dropdown matches the original width and fits the viewport",
	)
	browser(session, "press", "Escape")
	assert(
		evaluate(
			session,
			'document.activeElement.dataset.action === "library-options"',
		),
		"Escape restores the filter trigger focus",
	)
	browser(session, "click", '[data-action="trash-toggle"]')
	wait(
		session,
		'document.querySelectorAll("#document-list [data-doc]").length === 0',
	)
	assert(
		evaluate(
			session,
			'!document.querySelector("#library-options").matches(":popover-open")',
		),
		"Trash opens from a closed dropdown and dismisses it",
	)
	browser(session, "click", '[data-action="trash-toggle"]')
	wait(
		session,
		'document.querySelectorAll("#document-list [data-doc]").length > 0',
	)
} finally {
	try {
		browser(session, "close")
	} catch {}
	server.kill()
	await server.exited
}
