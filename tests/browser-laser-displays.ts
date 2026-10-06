import { assert, browser, evaluate, wait } from "./browser-driver"

// The original's laser display picker: slideshow windows of the same account
// offer themselves to the teleprompter, whose preview takes the chosen
// display's shape, and the laser reaches only that display.

let source = `---
title: Laser displays
mode: present
---
# Opening

Welcome everyone.

---

# Closing

Thank you!`

let trail =
	'(document.querySelector(".slideshow-stage .laser-trail path")?.getAttribute("d") || "")'
let server = Bun.spawn(["bun", "tests/browser-document-app.ts", "--serve"], {
	stdout: "pipe",
	stderr: "inherit",
})
let session = "laser-displays-" + Date.now()
try {
	let output = await server.stdout.getReader().read()
	if (!output.value) throw new Error("Missing app URL")
	let url = new URL("/app", new TextDecoder().decode(output.value).trim()).href
	browser(session, "set", "viewport", "1280", "800")
	browser(session, "open", url)
	wait(session, 'document.querySelector("[data-document-app]") !== null')
	browser(session, "click", '[data-action="new"]')
	wait(
		session,
		'location.pathname.startsWith("/app/doc/") && !document.querySelector("#editor").readOnly',
	)
	browser(session, "fill", "#editor", source)
	wait(
		session,
		'document.querySelector("#save-status")?.textContent === "Saved"',
	)
	let document = text("location.pathname")
	browser(session, "click", '[data-action="teleprompter"]')
	wait(session, 'document.querySelector("#speaker-notes [data-item]") !== null')
	let presenter = activeTab()
	assert(
		evaluate(
			session,
			`(() => {
				let status = document.querySelector("#laser-status");
				let canvas = document.querySelector(".prompter-preview .presentation-canvas").getBoundingClientRect();
				return document.querySelector("#laser-target").hidden &&
					status.checkVisibility() &&
					status.textContent === "Open this slideshow on another screen or device signed into the same account." &&
					Math.abs(canvas.width / canvas.height - 16 / 9) < 0.02
			})()`,
		),
		"Without an audience display the preview keeps 16:9 and explains how to connect one",
	)

	let first = openDisplay("800", "600")
	browser(session, "tab", presenter)
	waitAspect(800 / 600)
	assert(
		evaluate(
			session,
			'document.querySelector("#laser-target").hidden && !document.querySelector("#laser-status").checkVisibility() && document.querySelector("#slide").style.width === "800px" && document.querySelector("#laser-hint").checkVisibility()',
		),
		"A single audience display is chosen automatically and shapes the preview",
	)
	point(0.25, 0.5)
	browser(session, "tab", first)
	wait(session, trail + '.startsWith("M")')
	assert(true, "The laser reaches the chosen display")

	let second = openDisplay("1000", "500")
	browser(session, "tab", presenter)
	wait(
		session,
		'document.querySelectorAll("#laser-target option").length === 3',
	)
	assert(
		evaluate(
			session,
			`(() => {
				let picker = document.querySelector("#laser-target");
				let labels = [...picker.options].map(option => option.text);
				return !picker.hidden &&
					picker.getAttribute("aria-label") === "Target display" &&
					labels.join("|") === "Choose display|Display 1 · 800 × 600|Display 2 · 1000 × 500" &&
					picker.selectedIndex === 1
			})()`,
		),
		"A second display adds the original's picker and keeps the chosen one",
	)
	let target = text('document.querySelector("#laser-target").options[2].value')
	browser(session, "select", "#laser-target", target)
	waitAspect(1000 / 500)
	browser(session, "wait", "2500")
	point(0.75, 0.5)
	browser(session, "tab", second)
	wait(session, trail + '.startsWith("M")')
	browser(session, "tab", first)
	assert(
		text(trail) === "",
		"Choosing another display aims the laser at it alone",
	)

	browser(session, "tab", "close", second)
	browser(session, "tab", presenter)
	waitAspect(800 / 600)
	assert(
		evaluate(session, 'document.querySelector("#laser-target").hidden'),
		"When the chosen display closes, the remaining one is chosen again",
	)
	browser(session, "tab", "close", first)
	browser(session, "tab", presenter)
	wait(
		session,
		'document.querySelector("#laser-status").checkVisibility() && document.querySelector("#slide").style.width === ""',
	)
	assert(true, "Without displays the preview returns to its own shape")

	function openDisplay(width: string, height: string) {
		browser(session, "tab", "new")
		let tab = activeTab()
		browser(session, "set", "viewport", width, height)
		browser(session, "open", new URL(document + "/slideshow", url).href)
		wait(session, 'document.querySelector(".slideshow-options") !== null')
		return tab
	}
} finally {
	try {
		browser(session, "close")
	} catch {}
	server.kill("SIGTERM")
	await server.exited
}

function text(source: string) {
	let value = evaluate(session, source)
	if (typeof value !== "string") throw new Error("Expected text from " + source)
	return value
}

function waitAspect(ratio: number) {
	wait(
		session,
		`(() => {
			let canvas = document.querySelector(".prompter-preview .presentation-canvas").getBoundingClientRect();
			return Math.abs(canvas.width / canvas.height - ${ratio}) < 0.02
		})()`,
	)
}

function point(x: number, y: number) {
	evaluate(
		session,
		`(() => {
			let surface = document.querySelector(".prompter-preview .presentation-canvas");
			let bounds = document.querySelector("#slide").getBoundingClientRect();
			let at = (type, fx, fy) => surface.dispatchEvent(new PointerEvent(type, {bubbles: true, isPrimary: true, pointerId: 5, pointerType: "mouse", button: 0, buttons: type === "pointerup" ? 0 : 1, clientX: bounds.left + bounds.width * fx, clientY: bounds.top + bounds.height * fy}));
			at("pointerdown", ${x}, ${y});
			at("pointermove", ${x + 0.05}, ${y + 0.05});
			at("pointermove", ${x + 0.1}, ${y});
		})()`,
	)
}

function activeTab() {
	let tabs = browser(session, "tab").tabs
	let active = Array.isArray(tabs)
		? tabs.find(
				tab => tab && typeof tab === "object" && "active" in tab && tab.active,
			)
		: undefined
	if (!active || !("tabId" in active) || typeof active.tabId !== "string")
		throw new Error("Missing active tab")
	return active.tabId
}
