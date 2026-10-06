import {
	browser,
	browserBatch,
	evaluate,
	serverAddress,
} from "./browser-driver"

let server = Bun.spawn(["bun", "tests/browser-document-app.ts", "--serve"], {
	stdout: "pipe",
	stderr: "inherit",
})
let session = "fast-app-" + Date.now()
let source = 'document.querySelector("alkalye-editor").source.value'
let saved =
	'document.querySelector("#save-status")?.textContent === "Saved" && document.querySelector("#save-status").getAttribute("aria-busy") === "false"'
let draft = "---\ntitle: Integration journey\n---\n# Notes\n\nalpha alpha beta"
let started = performance.now()
try {
	let url = new URL("/app", await serverAddress(server.stdout)).href
	journey("editing, find, undo and durable reopening", [
		["set", "viewport", "1280", "800"],
		["open", url],
		condition('document.querySelector("[data-document-app]") !== null'),
		["click", '[data-action="new"]'],
		condition(
			'document.querySelector("#editor") && !document.querySelector("#editor").readOnly',
		),
		...edit(draft),
		["press", "Control+f"],
		["fill", "#find-text", "alpha"],
		["click", '[data-find-action="toggle-replace"]'],
		["fill", "#replace-text", "gamma"],
		["click", "#replace-all"],
		condition(`${source}.endsWith("gamma gamma beta") && ${saved}`),
		["click", "#close-find"],
		["press", "Control+z"],
		condition(`${source} === ${JSON.stringify(draft)}`),
		["press", "Control+Shift+z"],
		condition(`${source}.endsWith("gamma gamma beta") && ${saved}`),
		["reload"],
		condition(`${source}.endsWith("gamma gamma beta")`),
	])
	journey("regex replacement retains its surrounding context", [
		...edit("left cat right"),
		["press", "Control+f"],
		["fill", "#find-text", "(?<=left )(c)(at)(?= right)"],
		["check", "#find-regex"],
		["click", "#find-next"],
		["click", '[data-find-action="toggle-replace"]'],
		["fill", "#replace-text", "$2$1"],
		["click", '[data-find-action="replace"]'],
		condition(`${source} === "left atc right" && ${saved}`),
		["click", "#close-find"],
	])
	journey("offline edits survive reload and reconnect", [
		condition("navigator.serviceWorker.controller !== null"),
		[
			"eval",
			'localStorage.setItem("live-websocket-blocked", "true"); localStorage.setItem("native-preferences-offline", "true")',
		],
		["reload"],
		condition(`${source}.includes("left atc right")`),
		["set", "offline", "on"],
		condition("navigator.onLine === false"),
		...edit("# Offline\n\nWritten without a network."),
		condition(
			`${source}.includes("Written without a network.") && document.querySelector("#save-status").getAttribute("aria-busy") === "false" && Number(document.querySelector("#save-status").dataset.pending) > 0 && !document.querySelector("#retry-save")?.checkVisibility()`,
		),
		["reload"],
		condition(`${source}.includes("Written without a network.")`),
		["set", "offline", "off"],
		[
			"eval",
			'localStorage.removeItem("native-preferences-offline"); delete navigator.onLine; dispatchEvent(new Event("online"))',
		],
		condition('document.querySelector("#save-status").dataset.pending === "0"'),
		condition(
			'fetch(location.pathname.replace("/app/doc/", "/api/documents/") + "/snapshot").then(response => response.json()).then(snapshot => snapshot.state.includes("Written without a network."))',
		),
	])
	journey("preview routing and safe Markdown rendering", [
		...edit(
			'# Preview\n\n<script>alert("unsafe")</script>\n\n[Unsafe](javascript:alert(1))',
		),
		["click", '[data-action="preview"]'],
		condition('location.pathname.endsWith("/preview")'),
		condition(
			'document.querySelector("#preview")?.shadowRoot?.querySelector("h1")?.textContent === "Preview"',
		),
		[
			"eval",
			'(() => { let root = document.querySelector("#preview").shadowRoot; if (root.querySelector("script, [href^=javascript]")) throw new Error("Unsafe Markdown rendered"); })()',
		],
		["click", ".preview-back"],
		condition(
			'!location.pathname.endsWith("/preview") && !document.querySelector("#editor").readOnly',
		),
	])
	journey("mobile menus and presentation navigation", [
		["set", "viewport", "390", "844"],
		...edit(
			"---\nmode: present\n---\n# First\n\nSpeaker notes.\n\n```md\n---\n```\n\n---\n# Second\n\nMore notes.\n\n```md\n---",
		),
		["click", '[data-action="toggle-tools"]'],
		condition(
			'getComputedStyle(document.querySelector("[data-inspector]")).transform === "none"',
		),
		["click", '#inspector-body [data-action="slideshow"]'],
		condition('document.querySelector("alkalye-presentation") !== null'),
		["press", "ArrowRight"],
		condition(
			'document.querySelector("alkalye-presentation").dataset.slide === "2"',
		),
		["press", "Escape"],
		condition(
			'document.querySelector("#editor") && !document.querySelector("#editor").readOnly',
		),
		["click", '[data-action="toggle-tools"]'],
		condition(
			'getComputedStyle(document.querySelector("[data-inspector]")).transform === "none"',
		),
		["click", '#inspector-body [data-action="teleprompter"]'],
		condition(
			'document.querySelector("#speaker-notes") !== null && document.querySelector("#slide-count")?.textContent.includes("2")',
		),
		[
			"eval",
			'(() => { let host = document.querySelector("alkalye-presentation"); if (getComputedStyle(host).filter !== "none") throw new Error("Mobile sidebar blur remained"); })()',
		],
		["press", "Escape"],
	])
	console.log(
		`Fast app journeys: ${((performance.now() - started) / 1000).toFixed(1)}s`,
	)
} finally {
	try {
		browser(session, "close")
	} finally {
		server.kill("SIGTERM")
		await server.exited
	}
}

function journey(name: string, commands: string[][]) {
	let start = performance.now()
	try {
		browserBatch(session, commands)
	} catch (error) {
		try {
			console.error(
				name,
				evaluate(
					session,
					'({ path: location.pathname, source: document.querySelector("alkalye-editor")?.source?.value, app: document.querySelector("#app")?.className, toast: document.querySelector("#toast")?.textContent })',
				),
			)
		} catch {}
		throw error
	}
	console.log(
		`PASS ${name} (${((performance.now() - start) / 1000).toFixed(1)}s)`,
	)
}
function condition(source: string) {
	return ["wait", "--fn", source]
}

function edit(content: string) {
	return [
		[
			"eval",
			'window.previousSaveVersion = document.querySelector("#save-status").dataset.version',
		],
		["fill", "#editor", content],
		condition(
			`${source} === ${JSON.stringify(content)} && document.querySelector("#save-status").dataset.version !== window.previousSaveVersion && document.querySelector("#save-status").getAttribute("aria-busy") === "false"`,
		),
	]
}
