import { assert, browser, evaluate, wait } from "./browser-driver"

let server = Bun.spawn(["bun", "tests/browser-document-app.ts", "--serve"], {
	stdout: "pipe",
	stderr: "inherit",
})
let session = "ui-parity-" + Date.now()
try {
	let output = await server.stdout.getReader().read()
	if (!output.value) throw new Error("Missing app URL")
	let url = new URL("/app", new TextDecoder().decode(output.value).trim()).href
	let shell = await fetch(url).then(response => response.text())
	assert(
		shell.includes("data-boot") && !shell.includes("<!-- APP_BOOT -->"),
		"Initial HTML includes the startup frame before JavaScript",
	)
	browser(session, "set", "viewport", "1280", "800")
	browser(session, "open", url)
	wait(session, 'document.querySelector("[data-document-app]") !== null')
	browser(session, "click", '[data-action="new"]')
	wait(session, '!document.querySelector("#editor").readOnly')
	browser(
		session,
		"fill",
		"#editor",
		"---\ntitle: Test statistics\n---\nHello world. One more sentence\n- [ ] First\n- [x] Second",
	)
	wait(
		session,
		'document.querySelector("#stats").textContent.includes("words")',
	)
	browser(session, "click", "#stats")
	wait(
		session,
		'document.querySelector("#stats-menu").matches(":popover-open")',
	)
	browser(session, "press", "s")
	browser(session, "press", "e")
	assert(
		evaluate(
			session,
			'document.activeElement.dataset.statsUnit === "sentences"',
		),
		"Menu supports buffered typeahead",
	)
	browser(session, "press", "Enter")
	wait(
		session,
		'document.querySelector("#stats").textContent.includes("sentences")',
	)
	assert(
		evaluate(
			session,
			'document.activeElement.id === "stats" && !document.querySelector("#stats-menu").matches(":popover-open")',
		),
		"Choosing a metric closes the menu and restores focus",
	)
	browser(session, "press", "ArrowDown")
	wait(
		session,
		'document.querySelector("#stats-menu").matches(":popover-open")',
	)
	browser(session, "press", "ArrowDown")
	browser(session, "press", "Space")
	wait(
		session,
		'document.querySelector("#stats").textContent === "1 / 2 tasks"',
	)
	browser(session, "click", "#stats")
	browser(session, "press", "End")
	browser(session, "press", "Home")
	assert(
		evaluate(session, 'document.activeElement.dataset.statsUnit === "words"'),
		"Home and End navigate menu boundaries",
	)
	browser(session, "press", "Escape")
	assert(
		evaluate(session, 'document.activeElement.id === "stats"'),
		"Escape returns focus to the trigger",
	)
	browser(session, "reload")
	wait(
		session,
		'document.querySelector("#stats")?.textContent === "1 / 2 tasks"',
	)
	assert(true, "Selected statistic survives a refresh")
	wait(
		session,
		'document.querySelector("#save-status").hasAttribute("data-quiet")',
	)
	browser(session, "wait", "1500")
	browser(session, "click", "#editor")
	browser(session, "keyboard", "type", " quickly typed words")
	assert(
		evaluate(
			session,
			'Number(getComputedStyle(document.querySelector("#save-status")).opacity) === 0',
		),
		"Fast typing keeps the save indicator invisible",
	)
	browser(session, "click", '[data-action="preview"]')
	wait(
		session,
		'location.pathname.endsWith("/preview") && document.querySelector("#preview")?.shadowRoot !== null',
	)
	assert(
		evaluate(
			session,
			'document.querySelector(".preview-header").checkVisibility() && !document.querySelector("[data-statusbar]").checkVisibility() && !document.querySelector("[data-toolbar]").checkVisibility()',
		),
		"Preview has a separate route and reading frame",
	)
	browser(session, "click", ".preview-back")
	wait(
		session,
		'!location.pathname.endsWith("/preview") && document.querySelector("#editor") !== null',
	)
	assert(true, "Preview links back to the document editor")
} finally {
	browser(session, "close")
	server.kill()
	await server.exited
}
