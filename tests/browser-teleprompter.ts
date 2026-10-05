import { object } from "../src/shared/model"
import { assert, browser, evaluate, wait } from "./browser-driver"

let source = `---
title: Teleprompter talk
mode: present
---
# Opening

Welcome everyone.
Thanks for coming.

---

# Main point
\t- Visible insight
\t- Another insight

Let me explain the first insight.

---

# Closing

Thank you!`

let server = Bun.spawn(["bun", "tests/browser-document-app.ts", "--serve"], {
	stdout: "pipe",
	stderr: "inherit",
})
let session = "teleprompter-" + Date.now()
try {
	let output = await server.stdout.getReader().read()
	if (!output.value) throw new Error("Missing app URL")
	let url = new URL("/app", new TextDecoder().decode(output.value).trim()).href
	console.log(url)
	browser(session, "set", "viewport", "1280", "800")
	browser(session, "open", url)
	wait(session, 'document.querySelector("[data-document-app]") !== null')
	browser(session, "click", '[data-action="new"]')
	wait(session, '!document.querySelector("#editor").readOnly')
	browser(session, "fill", "#editor", source)
	browser(session, "click", '[data-action="teleprompter"]')
	wait(session, 'document.querySelector("#speaker-notes [data-item]") !== null')

	assert(
		evaluate(
			session,
			`(() => {
				let notes = document.querySelector("#speaker-notes");
				let kinds = [...notes.querySelectorAll("[data-item]")].map(item => item.classList.contains("prompter-visual") ? "visual" : "note");
				return notes.tagName === "ALKALYE-TELEPROMPTER" &&
					notes.querySelectorAll(".prompter-slide").length === 3 &&
					kinds.join() === "visual,note,note,visual,note,visual,note" &&
					notes.querySelector(".prompter-visual ul li")?.textContent === "Visible insight";
			})()`,
		),
		"Teleprompter groups visual blocks and spoken lines by slide",
	)
	assert(
		evaluate(
			session,
			`document.querySelector(".prompter-start").checkVisibility() &&
			document.querySelector("#slide-count").textContent.trim().endsWith("0 / 3") &&
			document.querySelector(".prompter-preview").checkVisibility() &&
			document.querySelector("#slide").shadowRoot.querySelector(".theme").dataset.mode === "slideshow"`,
		),
		"Header, start prompt and audience preview open beside the script",
	)

	browser(session, "click", ".prompter-start button")
	wait(
		session,
		'document.querySelector("[aria-current=step]")?.dataset.item === "0"',
	)
	assert(
		evaluate(
			session,
			'/^\\d+:\\d\\d$/.test(document.querySelector("#presentation-timer").textContent) && !document.querySelector(".prompter-start").checkVisibility()',
		),
		"Starting selects the first block with the timer running",
	)

	browser(session, "press", "ArrowDown")
	browser(session, "press", "Space")
	wait(
		session,
		'document.querySelector("[aria-current=step]")?.dataset.item === "2"',
	)
	browser(session, "press", "ArrowDown")
	wait(
		session,
		'document.querySelector("[aria-current=step]")?.dataset.item === "3" && document.querySelector("#slide-count").textContent.trim().endsWith("2 / 3")',
	)
	assert(
		evaluate(
			session,
			`(() => {
				let width = parseFloat(document.querySelector("#prompter-progress").style.inlineSize);
				return Math.abs(width - 50) < 0.1 &&
					document.querySelector("#slide").shadowRoot.textContent.includes("Main point") &&
					document.querySelector('.prompter-slide[data-slide="1"]').hasAttribute("data-current");
			})()`,
		),
		"Keyboard steps through items, moves the slide and fills progress per item",
	)

	browser(session, "press", "ArrowUp")
	wait(
		session,
		'document.querySelector("[aria-current=step]")?.dataset.item === "2"',
	)
	browser(session, "click", '[data-action="next"]')
	wait(
		session,
		'document.querySelector("[aria-current=step]")?.dataset.item === "3"',
	)
	browser(session, "press", "PageDown")
	wait(
		session,
		'document.querySelector("[aria-current=step]")?.dataset.item === "5" && document.querySelector("#slide-count").textContent.trim().endsWith("3 / 3")',
	)
	assert(
		evaluate(
			session,
			'document.querySelector("#next-item").disabled === false && document.querySelector(\'.prompter-navigation [data-action="next"]\').disabled',
		),
		"Slide jumps land on each slide's first visual block",
	)

	browser(session, "click", '#speaker-notes [data-item="1"]')
	wait(
		session,
		'document.querySelector("[aria-current=step]")?.dataset.item === "1" && document.querySelector("#slide-count").textContent.trim().endsWith("1 / 3")',
	)
	assert(true, "Clicking a spoken line selects it and returns the slide")

	browser(session, "click", "#preview-toggle")
	wait(
		session,
		'!document.querySelector(".prompter-preview").checkVisibility()',
	)
	assert(
		evaluate(
			session,
			'document.querySelector("#preview-toggle").getAttribute("aria-pressed") === "false"',
		),
		"Desktop preview collapses from the header",
	)
	browser(session, "click", "#preview-toggle")
	wait(session, 'document.querySelector(".prompter-preview").checkVisibility()')

	browser(session, "set", "viewport", "390", "844")
	wait(
		session,
		'document.querySelector("[data-presentation]").dataset.layout === "narrow" && !document.querySelector(".prompter-preview").checkVisibility()',
	)
	browser(session, "click", "#preview-toggle")
	wait(session, 'document.querySelector(".prompter-preview").checkVisibility()')
	assert(
		evaluate(
			session,
			`(() => {
				let preview = document.querySelector(".prompter-preview-dialog").getBoundingClientRect();
				return preview.width === innerWidth && preview.height === innerHeight &&
					document.querySelector("#preview-toggle").getAttribute("aria-expanded") === "true";
			})()`,
		),
		"Mobile preview opens as a full-screen overlay",
	)
	browser(session, "press", "ArrowDown")
	assert(
		evaluate(
			session,
			'document.querySelector("[aria-current=step]")?.dataset.item === "1"',
		),
		"Script keys pause while the mobile slide overlay is open",
	)
	let point = evaluate(
		session,
		'(() => {let bounds=document.querySelector("#slide").getBoundingClientRect();return JSON.stringify({x:Math.round(bounds.left+bounds.width/2),y:Math.round(bounds.top+bounds.height/2)})})()',
	)
	if (typeof point !== "string") throw new Error("Missing laser position")
	let location = object(JSON.parse(point))
	browser(session, "mouse", "move", String(location.x), String(location.y))
	browser(session, "mouse", "down")
	browser(
		session,
		"mouse",
		"move",
		String(Number(location.x) + 20),
		String(Number(location.y) + 20),
	)
	assert(
		evaluate(
			session,
			'document.querySelector(".laser-trail path").getAttribute("d")?.length > 0',
		),
		"Dragging the overlay slide draws a laser trail",
	)
	browser(session, "mouse", "up")
	browser(session, "click", "#preview-close")
	wait(
		session,
		'!document.querySelector(".prompter-preview").checkVisibility()',
	)
	browser(session, "set", "viewport", "1280", "800")

	browser(session, "click", "#presentation-timer")
	wait(
		session,
		'document.querySelector("#presentation-timer").textContent === "0:00"',
	)
	assert(true, "Clicking the timer resets its elapsed time")

	browser(session, "press", "Escape")
	wait(session, 'document.querySelector("#editor") !== null')
	browser(session, "click", '[data-action="teleprompter"]')
	wait(session, 'document.querySelector("[aria-current=step]") !== null')
	assert(
		evaluate(
			session,
			'document.querySelectorAll("alkalye-presentation").length === 1 && !document.querySelector(".prompter-start").checkVisibility()',
		),
		"Returning to the teleprompter keeps the selected item",
	)
	browser(session, "click", '[data-action="edit"]')
	wait(session, 'document.querySelector("#editor") !== null')
	assert(
		evaluate(
			session,
			'document.querySelector("alkalye-presentation") === null',
		),
		"Back to editor releases the presentation",
	)
} finally {
	browser(session, "close")
	server.kill()
	await server.exited
}
