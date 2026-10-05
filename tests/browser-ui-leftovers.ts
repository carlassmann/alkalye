import { assert, browser, evaluate, wait } from "./browser-driver"

let server = Bun.spawn(["bun", "tests/browser-document-app.ts", "--serve"], {
	stdout: "pipe",
	stderr: "inherit",
})
let session = "ui-leftovers-" + Date.now()
try {
	let output = await server.stdout.getReader().read()
	if (!output.value) throw new Error("Missing app URL")
	browser(session, "set", "viewport", "1440", "900")
	browser(
		session,
		"open",
		new URL("/app", new TextDecoder().decode(output.value).trim()).href,
	)
	wait(
		session,
		'Boolean(document.querySelector("#editor")) && !document.querySelector("#app").hasAttribute("aria-busy")',
	)
	let path = evaluate(session, "location.pathname")
	browser(session, "click", '[data-action="profile-menu"]')
	assert(
		evaluate(
			session,
			'document.querySelector("#profile-menu").matches(":popover-open")',
		) && evaluate(session, "location.pathname") === path,
		"Account button opens a dropdown without navigating",
	)
	assert(
		evaluate(
			session,
			'[...document.querySelectorAll("#profile-menu > button, #profile-menu > alkalye-menu > button")].every(button=>button.querySelector("svg"))',
		),
		"Account dropdown entries have icons",
	)
	browser(session, "screenshot", "/tmp/alkalye-account-menu.png")
	browser(session, "press", "Escape")
	browser(session, "click", '[data-action="appearance-dark"]')
	wait(session, 'document.documentElement.dataset.appearance === "dark"')
	assert(
		evaluate(
			session,
			'document.querySelector(\'[data-action="appearance-dark"]\').getAttribute("aria-checked") === "true"',
		),
		"Account theme choices save and reflect their state",
	)
	browser(session, "click", '[data-action="new"]')
	browser(session, "fill", "#editor", "First line\nSecond line\nThird line\n")
	evaluate(
		session,
		'(() => {let editor=document.querySelector("#editor");editor.focus();editor.setSelectionRange(0,0);return true})()',
	)
	let firstTop = Number(
		evaluate(
			session,
			'parseFloat(document.querySelector(".active-line").style.top)',
		),
	)
	browser(session, "press", "ArrowDown")
	wait(
		session,
		`parseFloat(document.querySelector(".active-line").style.top) > ${firstTop}`,
	)
	assert(
		true,
		"Cursor-line highlighting follows keyboard movement through plain text",
	)
	evaluate(
		session,
		'(() => {let editor=document.querySelector("#editor");editor.setSelectionRange(editor.value.length,editor.value.length);return true})()',
	)
	assert(
		evaluate(
			session,
			'parseFloat(document.querySelector(".active-line").style.top)>0',
		),
		"An empty final line has a valid cursor highlight",
	)
	assert(
		evaluate(
			session,
			'(() => {let probe=document.createElement("span");probe.style.color=getComputedStyle(document.querySelector("#editor")).getPropertyValue("--editor-caret");document.body.append(probe);let expected=getComputedStyle(probe).color;probe.remove();return getComputedStyle(document.querySelector("#editor")).caretColor===expected})()',
		),
		"The editor caret uses the brand color",
	)
	browser(session, "click", '[data-action="comments"]')
	wait(
		session,
		'Math.abs(document.querySelector("[data-inspector]").getBoundingClientRect().width - 352) < 1',
	)
	browser(session, "click", '[data-action="tools"]')
	wait(
		session,
		'Math.abs(document.querySelector("[data-inspector]").getBoundingClientRect().width - 224) < 1',
	)
	assert(
		true,
		"Comments use a wider sidebar and Tools restores the normal width",
	)
	browser(session, "fill", "#editor", "alpha alpha beta")
	browser(session, "press", "Control+f")
	browser(session, "fill", "#find-text", "alpha")
	wait(
		session,
		'document.querySelector(".find-count").textContent.includes("2")',
	)
	assert(
		evaluate(
			session,
			'getComputedStyle(document.querySelector("#find-bar")).position === "fixed" && document.querySelector(".find-replace-row").hidden',
		),
		"Find floats above the editor with replacement collapsed",
	)
	browser(session, "click", "#find-next")
	browser(session, "click", '[data-find-action="toggle-replace"]')
	browser(session, "fill", "#replace-text", "gamma")
	browser(session, "click", "#replace-all")
	wait(
		session,
		'document.querySelector("alkalye-editor").source.value === "gamma gamma beta"',
	)
	browser(session, "screenshot", "/tmp/alkalye-find-parity.png")
	browser(session, "click", "#close-find")
	assert(
		evaluate(session, 'document.activeElement.id === "editor"'),
		"Closing Find restores editor focus",
	)
	evaluate(
		session,
		'(() => { let host=document.querySelector("alkalye-editor"), source=host.source; source.focus(); source.setSelectionRange(0,5); document.querySelector("#editor").dispatchEvent(new MouseEvent("contextmenu", {bubbles:true,cancelable:true,clientX:500,clientY:150})); return true })()',
	)
	assert(
		evaluate(
			session,
			'[...document.querySelectorAll("body > [data-context-menu] > button")].every(button=>button.querySelector("svg"))',
		),
		"Editor context menus include icons",
	)
	browser(session, "press", "Escape")
	browser(session, "set", "viewport", "504", "842")
	browser(session, "press", "Control+f")
	wait(session, 'Boolean(document.querySelector("#find-text"))')
	assert(
		evaluate(
			session,
			'document.querySelector("#find-bar").parentElement.id === "app" && getComputedStyle(document.querySelector("#find-bar")).filter === "none"',
		),
		"Mobile Find renders outside the blurred editor",
	)
	browser(session, "click", "#close-find")
	browser(session, "screenshot", "/tmp/alkalye-ui-leftovers.png")
	console.log("UI leftovers browser checks passed")
} finally {
	try {
		browser(session, "close")
	} catch {}
	server.kill()
	await server.exited
}
