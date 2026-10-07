import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import {
	DocumentSnapshotSchema,
	restoreSnapshot,
} from "../src/shared/document-actions"
import {
	assert,
	browser,
	browserBatch,
	evaluate,
	serverAddress,
	browserCondition,
} from "./browser-driver"

let server = Bun.spawn(["bun", "tests/browser-document-app.ts", "--serve"], {
	stdout: "pipe",
	stderr: "inherit",
})
let session = "fast-app-" + Date.now()
let source = 'document.querySelector("alkalye-editor").source.value'
let saved =
	'document.querySelector("#save-status").dataset.version !== window.previousSaveVersion && document.querySelector("#save-status").getAttribute("aria-busy") === "false"'
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
		condition('document.querySelectorAll(".search-match").length === 2'),
		["click", "#find-next"],
		condition(
			'document.querySelectorAll(".search-match[data-active]").length === 1',
		),
		["click", '[data-find-action="toggle-replace"]'],
		["fill", "#replace-text", "gamma"],
		versionMarker(),
		["click", "#replace-all"],
		condition(
			`${source}.endsWith("gamma gamma beta") && ${saved} && document.querySelectorAll(".search-match").length === 0`,
		),
		["click", "#close-find"],
		condition('document.querySelectorAll(".search-match").length === 0'),
		versionMarker(),
		["press", "Control+z"],
		condition(`${source} === ${JSON.stringify(draft)}`),
		versionMarker(),
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
		versionMarker(),
		["click", '[data-find-action="replace"]'],
		condition(`${source} === "left atc right" && ${saved}`),
		["click", "#close-find"],
	])
	journey("equals wraps the selection without replacing it", [
		...edit("marker"),
		[
			"eval",
			'(() => { let editor = document.querySelector("alkalye-editor").source; editor.focus(); editor.setSelectionRange(0, 6); })()',
		],
		versionMarker(),
		["keyboard", "type", "="],
		condition(
			`${source} === "=marker=" && ${saved} && document.querySelector("alkalye-editor").source.selectionStart === 1 && document.querySelector("alkalye-editor").source.selectionEnd === 7`,
		),
		versionMarker(),
		["keyboard", "type", "="],
		condition(
			`${source} === "==marker==" && ${saved} && document.querySelector("#highlight .syntax-highlight")?.textContent === "==marker=="`,
		),
		[
			"eval",
			'(() => { let editor = document.querySelector("alkalye-editor").source; editor.setSelectionRange(editor.value.length, editor.value.length); })()',
		],
		versionMarker(),
		["keyboard", "type", "="],
		condition(`${source} === "==marker===" && ${saved}`),
		...edit("left atc right"),
	])

	journey("multicursor wraps and appends at every selected occurrence", [
		...edit("it it it it"),
		[
			"eval",
			'(() => { let editor = document.querySelector("alkalye-editor").source; editor.focus(); editor.setSelectionRange(4, 4); })()',
		],
		["press", "Control+d"],
		["press", "Control+d"],
		["press", "Control+d"],
		["press", "Control+d"],
		["press", "Control+d"],
		["press", "ArrowRight"],
		versionMarker(),
		["keyboard", "type", "!"],
		condition(`${source} === "it! it! it! it!" && ${saved}`),
		["press", "Escape"],
		...edit("left atc right"),
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
	])
	let snapshot = Schema.decodeUnknownSync(DocumentSnapshotSchema)(
		evaluate(
			session,
			'fetch(location.pathname.replace("/app/doc/", "/api/documents/") + "/snapshot").then(response => response.json())',
		),
	)
	let published = await Effect.runPromise(
		restoreSnapshot(snapshot, "e2e-reader"),
	)
	assert(
		published.text(snapshot.document) ===
			"# Offline\n\nWritten without a network.",
		"Reconnected edits are durable in the server snapshot",
	)

	journey("preview routing and safe Markdown rendering", [
		...edit(
			'---\ntitle: ==Literal title==\n---\n# Preview\n\n==Marker== and ==**bold**== and ==[linked](https://example.com)== and ==https://example.org==.\n\n`==inline code==` and \\==escaped==. a === b === c.\n\n```md\n==fenced code==\n```\n\n    ==indented code==\n\n<script>alert("unsafe")</script>\n\n[Unsafe](javascript:alert(1))',
		),
		condition(
			'(() => { let marks = [...document.querySelectorAll("#highlight .syntax-highlight")]; return marks.length === 4 && marks[0].textContent === "==Marker==" && marks[1].textContent === "==**bold**==" && marks[2].querySelector(".syntax-link-label")?.textContent === "linked"; })()',
		),
		condition(
			'getComputedStyle(document.querySelector("#highlight .syntax-highlight")).backgroundColor === "rgb(255, 224, 102)"',
		),
		condition(
			'getComputedStyle(document.querySelector("#highlight .syntax-highlight .syntax-link-label")).color === "rgb(36, 32, 14)"',
		),
		["click", '[data-action="preview"]'],
		condition('location.pathname.endsWith("/preview")'),
		condition(
			'document.querySelector("#preview")?.shadowRoot?.querySelector("h1")?.textContent === "Preview"',
		),
		condition(
			'[...document.querySelector("#preview").shadowRoot.querySelectorAll("mark")].map(mark => mark.textContent).join("|") === "Marker|bold|linked|https://example.org"',
		),
		condition(
			'(() => { let mark = document.querySelector("#preview").shadowRoot.querySelector("mark strong"); return mark && getComputedStyle(mark).color === "rgb(36, 32, 14)"; })()',
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
			"---\nmode: present\n---\n# ==First==\n\nSpeaker notes.\n\n```md\n---\n```\n\n---\n# Second\n\nMore notes.\n\n```md\n---",
		),
		["click", '[data-action="toggle-tools"]'],
		condition(
			'getComputedStyle(document.querySelector("[data-inspector]")).transform === "none"',
		),
		["click", '#inspector-body [data-action="slideshow"]'],
		condition('document.querySelector("alkalye-presentation") !== null'),
		condition(
			'document.querySelector("#slide")?.shadowRoot?.querySelector("mark")?.textContent === "First"',
		),
		condition(
			'(() => { let mark = document.querySelector("#slide").shadowRoot.querySelector("mark"); return getComputedStyle(mark).backgroundColor === "rgb(255, 224, 102)" && getComputedStyle(mark).color === "rgb(36, 32, 14)"; })()',
		),
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
			'document.querySelector("#speaker-notes") !== null && document.querySelector("#slide-count")?.textContent.trim().endsWith(" / 2")',
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
	return browserCondition(source)
}

function edit(content: string) {
	return [
		versionMarker(),
		["fill", "#editor", content],
		condition(
			`${source} === ${JSON.stringify(content)} && document.querySelector("#save-status").dataset.version !== window.previousSaveVersion && document.querySelector("#save-status").getAttribute("aria-busy") === "false"`,
		),
	]
}

function versionMarker() {
	return [
		"eval",
		'window.previousSaveVersion = document.querySelector("#save-status").dataset.version',
	]
}
