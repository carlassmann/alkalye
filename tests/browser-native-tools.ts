import { assert, browser, evaluate, wait } from "./browser-driver"
import { verifyNativeLibrary } from "./browser-native-library"
import { verifyNativePreferences } from "./browser-native-preferences"
import { verifyNativeAgents } from "./browser-native-agents"

let server = Bun.spawn(["bun", "tests/browser-document-app.ts", "--serve"], {
	stdout: "pipe",
	stderr: "inherit",
})
let session = "native-tools-" + Date.now()
try {
	let output = await server.stdout.getReader().read()
	if (!output.value) throw new Error("Missing native app URL")
	let url = new URL("/app", new TextDecoder().decode(output.value).trim()).href
	console.log(url)
	browser(session, "open", url)
	wait(session, 'document.querySelector("[data-document-app]") !== null')
	browser(session, "click", '[data-action="new"]')
	wait(
		session,
		'document.querySelector("#editor") && !document.querySelector("#editor").readOnly',
	)
	browser(session, "fill", "#editor", "# Native tools\n\nalpha alpha beta")
	wait(
		session,
		'document.querySelector("#save-status").textContent === "Saved"',
	)
	browser(session, "press", "Control+f")
	wait(session, 'document.querySelector("alkalye-find") !== null')
	assert(
		evaluate(
			session,
			'document.querySelector("alkalye-find").constructor === customElements.get("alkalye-find")',
		),
		"find uses a registered Web Component",
	)
	browser(session, "fill", "#find-text", "alpha")
	browser(session, "click", "#find-next")
	assert(
		evaluate(
			session,
			'(() => {let editor = document.querySelector("#editor"); return editor.value.slice(editor.selectionStart, editor.selectionEnd) === "alpha"})()',
		),
		"native find selects an exact source occurrence",
	)
	browser(session, "click", '[data-find-action="toggle-replace"]')
	browser(session, "fill", "#replace-text", "gamma")
	browser(session, "click", "#replace-all")
	wait(
		session,
		'document.querySelector("#editor").value.endsWith("gamma gamma beta") && document.querySelector("#save-status").textContent === "Saved"',
	)
	browser(session, "click", "#close-find")
	browser(session, "press", "Control+z")
	wait(
		session,
		'document.querySelector("#editor").value.endsWith("alpha alpha beta")',
	)
	assert(
		true,
		"replace all is one whole-document action and undo restores both matches",
	)
	browser(session, "press", "Control+f")
	browser(session, "fill", "#find-text", "alpha")
	browser(session, "click", '[data-find-action="toggle-replace"]')
	browser(session, "fill", "#replace-text", "forbidden")
	assert(
		evaluate(
			session,
			'(() => {let editor = document.querySelector("#editor"), source = editor.value; editor.readOnly = true; document.querySelector("alkalye-find").perform("replace-all"); editor.readOnly = false; return editor.value === source})()',
		),
		"find refuses mutation when editor authority changes",
	)
	assert(
		evaluate(
			session,
			'(() => {let find = document.querySelector("alkalye-find"), editor = document.querySelector("#editor"), source = editor.value; find.remove(); find.perform("replace-all"); return editor.value === source})()',
		),
		"disconnected find cannot mutate its old editor",
	)
	browser(session, "press", "Control+f")
	browser(session, "click", "#close-find")
	verifyNativePreferences(session, url)
	verifyNativeLibrary(session)
	verifyNativeAgents(session, url)
	browser(session, "click", '.profile [data-action="settings"]')
	wait(
		session,
		'document.querySelector("[data-settings-page] #settings-general input[readonly]") !== null',
	)
	assert(
		evaluate(
			session,
			'document.querySelector("#settings-general input[readonly]").value.length === 43',
		),
		"settings exposes the account identity for sharing",
	)
	browser(session, "click", '[data-preference-action="show-key"]')
	assert(
		evaluate(
			session,
			'(() => { let output = document.querySelector("[data-recovery-key]"); window.nativeRecoveryKey = output.textContent; return !output.hidden && output.textContent.length === 43 })()',
		),
		"recovery key is revealed only by its explicit control",
	)
	browser(session, "click", '[data-preference-action="show-key"]')
	assert(
		evaluate(
			session,
			'document.querySelector("[data-recovery-key]").hidden && !document.querySelector("[data-recovery-key]").textContent',
		),
		"hiding recovery removes the key from the DOM",
	)
	evaluate(
		session,
		`document.querySelector('[name="recovery-key"]').value = window.nativeRecoveryKey`,
	)
	browser(session, "click", '[data-preference-action="restore-account"]')
	wait(
		session,
		'document.querySelector("[data-document-app]") !== null && !document.querySelector("[data-settings-page]") && location.pathname.startsWith("/app")',
	)
	wait(session, 'document.querySelector("#editor") !== null')
	assert(
		true,
		"account recovery authenticates and reopens the local document dataset",
	)
	let imported = "/tmp/alkalye-cutover-import-" + Date.now() + ".md"
	await Bun.write(imported, "---\ntitle: Imported source\n---\nPlatform import")
	try {
		browser(session, "upload", "#import-files", imported)
		wait(
			session,
			'document.querySelector("#editor")?.value.includes("Platform import") === true',
		)
		assert(
			evaluate(
				session,
				'document.querySelector("#editor").value.includes("title: Imported source")',
			),
			"Markdown import preserves frontmatter as the metadata source",
		)
	} finally {
		await Bun.file(imported).delete()
	}
	browser(session, "click", '.profile [data-action="settings"]')
	wait(
		session,
		'document.querySelector("#settings-general input[readonly]") !== null',
	)
	let previousSubject = String(
		evaluate(
			session,
			'document.querySelector("#settings-general input[readonly]").value',
		),
	)
	browser(session, "click", '[data-preference-action="show-key"]')
	let previousKey = String(
		evaluate(
			session,
			'document.querySelector("[data-recovery-key]").textContent',
		),
	)
	browser(
		session,
		"fill",
		'[name="recovery-key"]',
		"YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE",
	)
	browser(session, "click", '[data-preference-action="restore-account"]')
	wait(
		session,
		'document.querySelector("[data-document-app]") !== null && !document.querySelector("[data-settings-page]") && location.pathname.startsWith("/app")',
	)
	let preserved = evaluate(
		session,
		`new Promise((resolve, reject) => { let request = indexedDB.open("alkalye-native-v1", 5); request.onerror = () => reject(request.error); request.onsuccess = () => { let db = request.result; let read = db.transaction("settings").objectStore("settings").get(${JSON.stringify("recovery-previous:" + previousSubject)}); read.onsuccess = () => { resolve(read.result); db.close() }; read.onerror = () => { reject(read.error); db.close() } } })`,
	)
	assert(
		preserved === previousKey,
		"switching accounts atomically preserves the previous device recovery key",
	)
	browser(session, "click", '.profile [data-action="settings"]')
	wait(
		session,
		'document.querySelector("#settings-general input[readonly]") !== null',
	)
	assert(
		evaluate(
			session,
			`document.querySelector("#settings-general input[readonly]").value !== ${JSON.stringify(previousSubject)}`,
		),
		"restoring another account adopts its signed identity",
	)
	browser(session, "fill", '[name="recovery-key"]', previousKey)
	browser(session, "click", '[data-preference-action="restore-account"]')
	wait(
		session,
		'document.querySelector("#editor")?.value.includes("Platform import") === true',
	)
	assert(
		true,
		"restoring the preserved account reopens its original document dataset",
	)
} finally {
	try {
		browser(session, "close")
	} finally {
		server.kill()
		await server.exited
	}
}
