import { number, object, string } from "../src/shared/model"
import {
	assert,
	browser,
	currentDocument,
	evaluate,
	wait,
} from "./browser-driver"

let server = Bun.spawn(["bun", "tests/browser-document-app.ts", "--serve"], {
	stdout: "pipe",
	stderr: "inherit",
})
let owner = "live-socket-" + Date.now()
let guest = "live-polling-" + Date.now()
try {
	let output = await server.stdout.getReader().read()
	if (!output.value) throw new Error("Missing native app URL")
	let origin = new URL(new TextDecoder().decode(output.value).trim()).origin
	let url = new URL("/app", origin).href
	browser(guest, "open", new URL("/privacy", origin).href)
	evaluate(guest, 'localStorage.setItem("live-websocket-blocked", "true")')
	for (let profile of [
		{ session: owner, name: "Socket owner" },
		{ session: guest, name: "Polling guest" },
	]) {
		let { session, name } = profile
		browser(session, "open", url)
		wait(session, 'document.querySelector("[data-document-app]") !== null')
		wait(
			session,
			'fetch("/api/accounts/session").then(response => response.ok)',
		)
		evaluate(
			session,
			`fetch("/api/accounts/preferences", {method:"PUT", headers:{"content-type":"application/json"}, body:JSON.stringify({request:"live-profile-name",patch:{name:${JSON.stringify(name)}}})}).then(response => response.ok)`,
		)
	}
	browser(owner, "click", '[data-action="new"]')
	wait(
		owner,
		'document.querySelector("#editor") && !document.querySelector("#editor").readOnly',
	)
	let document = string(evaluate(owner, currentDocument))
	browser(owner, "fill", "#editor", "# Fallback plan\n\nStarted on a socket.")
	wait(owner, 'document.querySelector("#save-status").textContent === "Saved"')
	browser(owner, "click", '[data-action="tools"]')
	browser(owner, "click", '[data-action="share"]')
	wait(owner, 'document.querySelector("#dialog alkalye-invitations") !== null')
	browser(owner, "click", '[data-invite-role="writer"]')
	wait(
		owner,
		'document.querySelector(".invitation-link input")?.value.includes("/invite#/doc/")',
	)
	let link = string(
		evaluate(owner, 'document.querySelector(".invitation-link input").value'),
	)
	evaluate(owner, 'document.querySelector("#dialog").close()')
	browser(guest, "open", link)
	wait(guest, 'document.querySelector("[data-invitation-accept]") !== null')
	browser(guest, "click", "[data-invitation-accept]")
	wait(
		guest,
		`${currentDocument} === ${JSON.stringify(document)} && document.querySelector("#editor")?.value.includes("Started on a socket.") && !document.querySelector("#editor").readOnly`,
	)
	let counts = object(
		evaluate(guest, 'fetch("/__tests/live").then(response => response.json())'),
	)
	assert(
		number(counts.blockedSockets) >= 3 && number(counts.polls) > 0,
		"a browser whose WebSocket is refused switches to long polling",
	)

	let polled =
		"# Fallback plan\n\nStarted on a socket.\n\nWritten while polling."
	browser(guest, "fill", "#editor", polled)
	wait(guest, 'document.querySelector("#save-status").textContent === "Saved"')
	wait(
		owner,
		'document.querySelector("#editor")?.value === ' + JSON.stringify(polled),
	)
	assert(true, "edits from the polling browser reach the WebSocket browser")
	let socketed = polled + "\n\nAnswered over the socket."
	browser(owner, "fill", "#editor", socketed)
	wait(owner, 'document.querySelector("#save-status").textContent === "Saved"')
	wait(
		guest,
		'document.querySelector("#editor")?.value === ' + JSON.stringify(socketed),
	)
	assert(true, "the polling browser is notified of WebSocket edits")

	wait(
		owner,
		'document.querySelector("#presence")?.textContent.includes("Polling guest")',
	)
	wait(
		guest,
		'document.querySelector("#presence")?.textContent.includes("Socket owner")',
	)
	assert(true, "presence crosses between the WebSocket and polling browsers")
	evaluate(
		guest,
		'fetch("/api/accounts/preferences", {method:"PUT", headers:{"content-type":"application/json"}, body:JSON.stringify({request:"live-profile-rename",patch:{name:"Renamed guest"}})}).then(response => response.ok)',
	)
	wait(
		owner,
		'document.querySelector("#presence")?.textContent.includes("Renamed guest")',
	)
	assert(true, "a polling browser's renamed profile updates its cursor label")
	let connections = number(evaluate(guest, "window.liveSocketConnections"))
	evaluate(guest, 'localStorage.removeItem("live-websocket-blocked")')
	let deadline = Date.now() + 150_000
	while (
		number(evaluate(guest, "window.liveSocketConnections")) < connections + 2 &&
		Date.now() < deadline
	) {
		await Bun.sleep(5000)
	}
	assert(
		number(evaluate(guest, "window.liveSocketConnections")) >= connections + 2,
		"a polling browser probes and returns to WebSockets when the network permits them",
	)
	browser(
		guest,
		"fill",
		"#editor",
		"# Recovered WebSocket\n\nStill collaborating.",
	)
	wait(
		owner,
		'document.querySelector("#editor")?.value.includes("Still collaborating.")',
	)
	wait(
		guest,
		'document.querySelector("#presence")?.textContent.includes("Socket owner")',
	)
	let recoveredPolls = number(
		object(
			evaluate(
				guest,
				'fetch("/__tests/live").then(response => response.json())',
			),
		).polls,
	)
	await Bun.sleep(6000)
	assert(
		number(
			object(
				evaluate(
					guest,
					'fetch("/__tests/live").then(response => response.json())',
				),
			).polls,
		) === recoveredPolls,
		"WebSocket recovery stops polling while edits and presence keep working",
	)
} finally {
	for (let session of [owner, guest]) {
		try {
			browser(session, "close")
		} catch {}
	}
	server.kill("SIGTERM")
	await server.exited
}
