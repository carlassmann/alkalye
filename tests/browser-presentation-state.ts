import { assert, browser, evaluate, wait } from "./browser-driver"

let server = Bun.spawn(["bun", "tests/browser-document-app.ts", "--serve"], {
	stdout: "pipe",
	stderr: "inherit",
})
let session = "presentation-state-" + Date.now()
try {
	let output = await server.stdout.getReader().read()
	if (!output.value) throw new Error("Missing app URL")
	let url = new URL("/app", new TextDecoder().decode(output.value).trim()).href
	browser(session, "open", url)
	wait(session, 'document.querySelector("[data-document-app]") !== null')
	browser(session, "click", '[data-action="new"]')
	wait(session, '!document.querySelector("#editor").readOnly')
	browser(
		session,
		"fill",
		"#editor",
		"---\nmode: present\n---\n# First\n\nHello\n\n---\n\n# Second\n\nWorld\n\n---\n\n# Third",
	)
	browser(session, "click", '[data-action="slideshow"]')
	wait(session, 'document.querySelector("alkalye-presentation") !== null')
	browser(session, "press", "ArrowRight")
	wait(
		session,
		'document.querySelector("alkalye-presentation").dataset.slide === "2"',
	)
	wait(
		session,
		'document.querySelector("#save-status").textContent === "Saved"',
	)
	evaluate(session, "window.presentationReloadMarker = true")
	browser(session, "reload")
	wait(
		session,
		'!window.presentationReloadMarker && document.querySelector("alkalye-presentation")?.dataset.slide === "2"',
	)
	assert(true, "Presentation position survives a new application instance")
	browser(session, "press", "Escape")
	wait(session, 'document.querySelector("#editor") !== null')
	assert(
		evaluate(
			session,
			'document.querySelector("alkalye-editor").source.value === "---\\nmode: present\\n---\\n# First\\n\\nHello\\n\\n---\\n\\n# Second\\n\\nWorld\\n\\n---\\n\\n# Third"',
		),
		"Presentation events preserve document source",
	)
	browser(session, "click", '[data-action="teleprompter"]')
	wait(
		session,
		'document.querySelector("#speaker-notes [aria-current=step]") !== null',
	)
	assert(
		evaluate(
			session,
			'document.querySelector("alkalye-presentation").dataset.slide === "2"',
		),
		"Teleprompter resumes the persisted document position",
	)
	browser(session, "press", "Escape")
	wait(session, 'document.querySelector("#editor") !== null')
	browser(session, "press", "Meta+z")
	wait(session, 'document.querySelector("alkalye-editor").source.value === ""')
	assert(true, "Editing undo skips presentation navigation events")
	browser(session, "press", "Meta+Shift+z")
	wait(
		session,
		'document.querySelector("alkalye-editor").source.value.includes("# Third")',
	)
	assert(true, "Presentation navigation preserves editing redo")
} finally {
	browser(session, "close")
	server.kill()
	await server.exited
}
