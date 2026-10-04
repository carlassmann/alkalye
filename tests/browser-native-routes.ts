import {
	assert,
	browser,
	currentDocument,
	evaluate,
	wait,
} from "./browser-driver"

// Addresses are ordinary paths: they survive reload, back and forward, and
// the server answers each one with the app.
export async function verifyNativeRoutes(session: string, url: string) {
	let origin = new URL(url).origin
	let first = String(evaluate(session, currentDocument))
	for (let path of [
		"/app/doc/" + first,
		"/app/doc/" + first + "/slideshow",
		"/app/spaces/somewhere/settings",
		"/app/settings?category=connections",
	]) {
		let response = await fetch(origin + path)
		let body = await response.text()
		if (!response.ok || !body.includes('src="/app.js"'))
			throw new Error("No app shell for " + path)
	}
	assert(true, "the server answers every app path with the app shell")

	browser(session, "open", url + "#" + first)
	wait(
		session,
		`location.pathname === ${JSON.stringify("/app/doc/" + first)} && !location.hash && document.querySelector("#editor") !== null`,
	)
	assert(true, "an earlier /app#<document> link moves to its path once")

	browser(session, "click", '[data-action="new"]')
	wait(
		session,
		`${currentDocument} !== ${JSON.stringify(first)} && document.querySelector("#editor") && !document.querySelector("#editor").readOnly`,
	)
	let second = String(evaluate(session, currentDocument))
	browser(session, "fill", "#editor", "# Route second\n\nSecond.")
	wait(
		session,
		'document.querySelector("#save-status").textContent === "Saved"',
	)
	browser(session, "click", '[data-action="preview"]')
	wait(
		session,
		`location.pathname === ${JSON.stringify("/app/doc/" + second + "/preview")} && document.querySelector("#preview") !== null`,
	)
	browser(session, "reload")
	wait(
		session,
		`location.pathname === ${JSON.stringify("/app/doc/" + second + "/preview")} && document.querySelector("#preview") !== null`,
	)
	assert(true, "a mode is part of the path and survives reload")
	browser(session, "back")
	wait(
		session,
		`location.pathname === ${JSON.stringify("/app/doc/" + second)} && document.querySelector("#editor")?.value.startsWith("# Route second")`,
	)
	browser(session, "back")
	wait(
		session,
		`${currentDocument} === ${JSON.stringify(first)} && document.querySelector("#editor") !== null && !document.querySelector("#editor").value.startsWith("# Route second")`,
	)
	browser(session, "forward")
	wait(
		session,
		`${currentDocument} === ${JSON.stringify(second)} && document.querySelector("#editor")?.value.startsWith("# Route second")`,
	)
	browser(session, "forward")
	wait(
		session,
		`location.pathname.endsWith("/preview") && document.querySelector("#preview") !== null`,
	)
	assert(true, "back and forward move between documents and modes")
	browser(session, "press", "Escape")
	wait(
		session,
		`location.pathname === ${JSON.stringify("/app/doc/" + second)} && document.querySelector("#editor") !== null`,
	)

	browser(session, "open", url + "/settings?category=connections")
	wait(
		session,
		'document.querySelector("#settings-connections h2")?.textContent === "MCP connections" && document.querySelector(".settings-nav [aria-current=page]")?.textContent.trim() === "Connections"',
	)
	browser(session, "click", ".settings-back")
	wait(
		session,
		'location.pathname === "/app" && !document.querySelector("[data-settings-page]")',
	)
	assert(true, "Settings → Connections has its own address")

	browser(
		session,
		"open",
		url + "/share?title=Shared%20route&text=From%20another%20app",
	)
	wait(
		session,
		'location.pathname.startsWith("/app/doc/") && document.querySelector("#editor")?.value.includes("From another app")',
	)
	assert(
		evaluate(
			session,
			'document.querySelector("#document-title").textContent === "Shared route"',
		),
		"the share target turns shared text into a document",
	)
	browser(session, "open", url + "/doc/" + first)
	wait(session, `${currentDocument} === ${JSON.stringify(first)}`)
}
