import { object, string } from "../src/shared/model"
import { assert, browser, evaluate, wait } from "./browser-driver"

let server = Bun.spawn(["bun", "tests/browser-document-app.ts", "--serve"], {
	stdout: "pipe",
	stderr: "inherit",
})
let session = "whiteboard-" + Date.now()
let reader = "whiteboard-reader-" + Date.now()
let editor = 'document.querySelector("alkalye-whiteboard")?.editor'
let shapes = `(${editor}?.getCurrentPageShapes().length ?? -1)`
let saved = 'document.querySelector("#save-status").textContent === "Saved"'
let mounted = `${editor} !== undefined && document.querySelector(".tl-canvas") !== null`

try {
	let output = await server.stdout.getReader().read()
	if (!output.value) throw new Error("Missing app URL")
	let origin = new TextDecoder().decode(output.value).trim()
	let url = new URL("/app", origin).href
	console.log(url)
	browser(session, "set", "viewport", "1280", "800")
	browser(session, "open", url)
	wait(session, 'document.querySelector("[data-document-app]") !== null')
	browser(session, "click", '[data-action="new"]')
	wait(session, '!document.querySelector("#editor").readOnly')
	browser(session, "fill", "#editor", "# Board journal\n")
	wait(session, saved)
	let documentId = String(
		evaluate(session, "location.pathname.match(/[/]doc[/]([^/]+)/)[1]"),
	)
	browser(session, "click", '[data-action="tools"]')
	browser(session, "click", '[data-action="new-whiteboard"]')
	wait(session, mounted)
	let remote = evaluate(
		session,
		'JSON.stringify(performance.getEntriesByType("resource").map(entry => entry.name).filter(name => /^https?:/.test(name) && new URL(name).origin !== location.origin))',
	)
	assert(
		remote === "[]" &&
			evaluate(
				session,
				'[...document.querySelectorAll("link[data-tldraw]")].every(link => link.href.startsWith(location.origin + "/tldraw/"))',
			),
		"the tldraw island loads only local assets" +
			(remote === "[]" ? "" : " " + String(remote)),
	)

	browser(session, "click", '[data-testid="tools.rectangle"]')
	drag(session, [0.35, 0.35], [0.5, 0.55])
	wait(session, `${shapes} === 1 && ${saved}`)
	assert(
		evaluate(session, `${editor}.getCurrentPageShapes()[0].type === "geo"`),
		"drawing with tldraw's rectangle tool saves a geo shape",
	)

	browser(session, "click", "#drawing-undo")
	wait(session, `${shapes} === 0 && ${saved}`)
	browser(session, "click", "#drawing-redo")
	wait(session, `${shapes} === 1 && ${saved}`)
	assert(
		true,
		"the toolbar undoes and redoes the drawing through document history",
	)
	evaluate(session, 'document.querySelector(".tl-container").focus()')
	browser(session, "press", "Meta+z")
	wait(session, `${shapes} === 0 && ${saved}`)
	browser(session, "press", "Meta+Shift+z")
	wait(session, `${shapes} === 1 && ${saved}`)
	assert(
		true,
		"tldraw's undo and redo shortcuts travel through document history",
	)

	evaluate(
		session,
		"window.downloads = []; HTMLAnchorElement.prototype.click = function () { window.downloads.push(fetch(this.href).then(response => response.text()).then(text => ({ name: this.download, text }))) }",
	)
	browser(session, "click", "#export-drawing")
	wait(session, "window.downloads.length === 1")
	let exported = object(
		evaluate(session, "window.downloads[0].then(file => file)"),
	)
	let file = object(JSON.parse(string(exported.text)))
	assert(
		string(exported.name).endsWith(".tldr") &&
			file.tldrawFileFormatVersion === 1 &&
			Array.isArray(file.records) &&
			file.records.some(record => object(record).typeName === "shape"),
		"the board downloads as a tldraw .tldr file",
	)
	evaluate(
		session,
		`(() => { let input = document.querySelector("#import-drawing"), data = new DataTransfer(); data.items.add(new File([${JSON.stringify(string(exported.text))}], "copy.tldr", { type: "application/json" })); input.files = data.files; input.dispatchEvent(new Event("change")) })()`,
	)
	wait(session, `${shapes} === 2 && ${saved}`)
	assert(
		true,
		"importing a .tldr file adds its shapes to the board and saves them",
	)
	evaluate(
		session,
		`(() => { let input = document.querySelector("#import-drawing"), data = new DataTransfer(); let records = ${JSON.stringify(file.records)}; let shape = records.find(record => record.typeName === "shape"); data.items.add(new File([JSON.stringify({ ...${JSON.stringify(file)}, records: [...records, shape] })], "twice.tldr")); input.files = data.files; input.dispatchEvent(new Event("change")) })()`,
	)
	wait(
		session,
		'document.querySelector("#toast")?.textContent.includes("twice")',
	)
	assert(
		evaluate(session, `${shapes} === 2`),
		"a .tldr file holding a record twice is rejected without changing the board",
	)

	browser(session, "click", "#dialog .dialog-close")
	wait(session, '!document.querySelector("#dialog").open')
	browser(session, "click", '[data-action^="drawing:"]')
	wait(session, `${mounted} && ${shapes} === 2`)
	assert(true, "closing and reopening the board shows the saved shapes")
	browser(session, "click", "#dialog .dialog-close")
	browser(session, "reload")
	wait(
		session,
		'document.querySelector("#editor")?.value.startsWith("# Board journal")',
	)
	wait(session, "!!navigator.serviceWorker.controller")
	browser(session, "set", "offline", "on")
	browser(session, "reload")
	wait(
		session,
		'document.querySelector("#editor")?.value.startsWith("# Board journal")',
	)
	browser(session, "click", '[data-action="tools"]')
	browser(session, "click", '[data-action^="drawing:"]')
	wait(session, `${mounted} && ${shapes} === 2`)
	browser(session, "click", '[data-testid="tools.rectangle"]')
	drag(session, [0.6, 0.6], [0.7, 0.7])
	wait(
		session,
		`${shapes} === 3 && document.querySelector("#save-status").textContent === "Saved on this device"`,
	)
	assert(
		true,
		"offline the board opens from local assets and keeps new shapes on the device",
	)
	browser(session, "set", "offline", "off")
	evaluate(session, 'window.dispatchEvent(new Event("focus"))')
	wait(session, saved)

	evaluate(
		session,
		'window.originalAdd = IDBObjectStore.prototype.add; IDBObjectStore.prototype.add = function () { throw new DOMException("The disk is full", "QuotaExceededError") }',
	)
	browser(session, "click", '[data-testid="tools.rectangle"]')
	drag(session, [0.2, 0.6], [0.3, 0.7])
	wait(session, `${shapes} === 4`)
	browser(session, "click", "#dialog .dialog-close")
	wait(
		session,
		'!document.querySelector("#dialog").open && document.querySelector("#toast")?.textContent.includes("return when you open it again")',
	)
	evaluate(
		session,
		"IDBObjectStore.prototype.add = window.originalAdd; delete window.originalAdd",
	)
	browser(session, "click", '[data-action^="drawing:"]')
	wait(session, `${mounted} && ${shapes} === 4 && ${saved}`)
	browser(session, "click", "#dialog .dialog-close")
	browser(session, "reload")
	browser(session, "click", '[data-action="tools"]')
	browser(session, "click", '[data-action^="drawing:"]')
	wait(session, `${mounted} && ${shapes} === 4`)
	assert(
		true,
		"edits a failed close could not save return when the board reopens and are then saved",
	)

	// tldraw reports edits on the next animation frame, which a background tab
	// never reaches; holding frames closes the board before that report.
	let holdFrames =
		"window.heldFrames = []; window.originalFrame = window.requestAnimationFrame; window.requestAnimationFrame = callback => window.heldFrames.push(callback)"
	let releaseFrames =
		"window.requestAnimationFrame = window.originalFrame; window.heldFrames.forEach(frame => frame(performance.now()))"
	evaluate(
		session,
		`(() => { ${holdFrames}; ${editor}.createShape({ type: "geo", x: 900, y: 500, props: { w: 40, h: 40 } }); document.querySelector("#dialog .dialog-close").click() })()`,
	)
	wait(session, '!document.querySelector("#dialog").open')
	evaluate(session, releaseFrames)
	browser(session, "reload")
	browser(session, "click", '[data-action="tools"]')
	browser(session, "click", '[data-action^="drawing:"]')
	wait(session, `${mounted} && ${shapes} === 5`)
	assert(
		true,
		"a shape drawn just before closing is saved before tldraw reports it",
	)

	evaluate(
		session,
		'window.originalAdd = IDBObjectStore.prototype.add; IDBObjectStore.prototype.add = function () { throw new DOMException("The disk is full", "QuotaExceededError") }',
	)
	evaluate(
		session,
		`(() => { ${holdFrames}; let board = ${editor}; board.deleteShapes([board.getCurrentPageShapesSorted().at(-1).id]); document.querySelector("#dialog .dialog-close").click() })()`,
	)
	wait(
		session,
		'!document.querySelector("#dialog").open && document.querySelector("#toast")?.textContent.includes("return when you open it again")',
	)
	evaluate(
		session,
		`${releaseFrames}; IDBObjectStore.prototype.add = window.originalAdd; delete window.originalAdd`,
	)
	browser(session, "click", '[data-action^="drawing:"]')
	wait(session, `${mounted} && ${shapes} === 4 && ${saved}`)
	browser(session, "click", "#dialog .dialog-close")
	browser(session, "reload")
	browser(session, "click", '[data-action="tools"]')
	browser(session, "click", '[data-action^="drawing:"]')
	wait(session, `${mounted} && ${shapes} === 4`)
	assert(
		true,
		"a deletion a failed close could not save returns when the board reopens and is then saved",
	)

	let snapshot = object(
		evaluate(
			session,
			'fetch("/api/library").then(response => response.json())',
		),
	)
	let workspaces = snapshot.workspaces
	if (!Array.isArray(workspaces) || !workspaces[0])
		throw new Error("Missing personal workspace")
	let workspace = string(object(workspaces[0]).workspace)
	browser(reader, "set", "viewport", "1280", "800")
	browser(reader, "open", url)
	wait(reader, 'document.querySelector("[data-document-app]") !== null')
	wait(reader, 'fetch("/api/accounts/session").then(response => response.ok)')
	let account = object(
		evaluate(
			reader,
			'fetch("/api/accounts/session").then(response => response.json())',
		),
	)
	if (typeof account.subject !== "string") {
		browser(reader, "click", '[data-action="sign-in"]')
		wait(reader, 'document.querySelector("#toast")?.textContent === ""')
	}
	let subject = string(
		object(
			evaluate(
				reader,
				'fetch("/api/accounts/session").then(response => response.json())',
			),
		).subject,
	)
	let membership = new URL(
		`/api/workspaces/${workspace}/members/${subject}`,
		origin,
	).href
	let grant = (role: string) =>
		evaluate(
			session,
			`fetch(${JSON.stringify(membership)}, {method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({role:${JSON.stringify(role)},request:${JSON.stringify(role + "-v1")}})}).then(response=>response.ok)`,
		)
	assert(grant("reader"), "the owner grants reader access")
	browser(reader, "open", url + "/doc/" + documentId)
	wait(
		reader,
		'document.querySelector("#editor")?.value.startsWith("# Board journal")',
	)
	browser(reader, "click", '[data-action="tools"]')
	browser(reader, "click", '[data-action^="drawing:"]')
	wait(reader, `${mounted} && ${shapes} === 4`)
	assert(
		evaluate(
			reader,
			`${editor}.getIsReadonly() && !document.querySelector("[data-read-only]").hidden && document.querySelector("#drawing-undo").disabled && document.querySelector("#import-drawing").disabled`,
		),
		"a reader sees the board read-only without writing controls",
	)

	assert(grant("writer"), "the owner promotes the member to writer")
	evaluate(reader, 'window.dispatchEvent(new Event("focus"))')
	wait(
		reader,
		`!${editor}.getIsReadonly() && !document.querySelector("#drawing-undo").disabled`,
	)
	browser(session, "click", '[data-action^="drawing:"]')
	wait(session, `${mounted} && ${shapes} === 4`)
	browser(reader, "click", '[data-testid="tools.rectangle"]')
	drag(reader, [0.4, 0.15], [0.5, 0.25])
	wait(reader, `${shapes} === 5 && ${saved}`)
	wait(session, `${shapes} === 5`)
	assert(true, "a collaborator's shape appears on the open board")
	let target = canvasPoint(reader, [0.55, 0.5])
	browser(reader, "mouse", "move", String(target.x), String(target.y))
	browser(reader, "mouse", "move", String(target.x + 20), String(target.y + 10))
	wait(
		session,
		`${editor}.store.query.records("instance_presence").get().some(peer => peer.cursor) && document.querySelector("[data-drawing-people]").textContent.includes("1 other")`,
	)
	assert(true, "a collaborator's cursor shows as a tldraw collaborator")
	browser(reader, "click", "#dialog .dialog-close")
	wait(
		session,
		`${editor}.store.query.records("instance_presence").get().length === 0`,
	)
	assert(true, "closing the board withdraws the collaborator's presence")

	// The owner's tab pretends to run a newer tldraw, so its next shape names
	// a schema the reader's tab cannot write.
	browser(session, "click", "#dialog .dialog-close")
	wait(session, '!document.querySelector("#dialog").open')
	browser(session, "click", '[data-action^="drawing:"]')
	wait(session, mounted)
	evaluate(
		session,
		`(() => { let schema = Object.getPrototypeOf(${editor}.store.schema), serialize = schema.serialize; schema.serialize = function () { let value = serialize.call(this); return { ...value, sequences: { ...value.sequences, "com.tldraw.shape.future": 1 } } } })()`,
	)
	browser(session, "click", "#dialog .dialog-close")
	wait(session, '!document.querySelector("#dialog").open')
	browser(session, "click", '[data-action^="drawing:"]')
	wait(session, `${mounted} && ${shapes} === 5`)
	browser(session, "click", '[data-testid="tools.rectangle"]')
	drag(session, [0.75, 0.15], [0.85, 0.25])
	wait(session, `${shapes} === 6 && ${saved}`)
	browser(reader, "click", '[data-action^="drawing:"]')
	wait(reader, `${mounted} && ${shapes} === 6`)
	assert(
		evaluate(
			reader,
			`${editor}.getIsReadonly() && !document.querySelector("[data-read-only]").hidden && document.querySelector("#drawing-undo").disabled && document.querySelector("#import-drawing").disabled && document.querySelector("#embed-board").getAttribute("aria-label") !== ""`,
		),
		"a writer sees a board saved by a newer version read-only",
	)
	browser(reader, "click", "#dialog .dialog-close")
	wait(reader, '!document.querySelector("#dialog").open')
	assert(
		!evaluate(
			reader,
			'document.querySelector("#toast")?.textContent.includes("return when you open it again") ?? false',
		),
		"closing a newer board keeps no edits that could never be saved",
	)
} finally {
	for (let name of [session, reader])
		try {
			browser(name, "close")
		} catch {}
	server.kill("SIGTERM")
	await server.exited
}

function canvasPoint(name: string, [x, y]: [number, number]) {
	let value = evaluate(
		name,
		`JSON.stringify((() => { let bounds = document.querySelector(".tl-canvas").getBoundingClientRect(); return { x: Math.round(bounds.left + bounds.width * ${x}), y: Math.round(bounds.top + bounds.height * ${y}) } })())`,
	)
	let point = object(JSON.parse(String(value)))
	if (typeof point.x !== "number" || typeof point.y !== "number")
		throw new Error("Expected a point")
	return { x: point.x, y: point.y }
}

function drag(name: string, from: [number, number], to: [number, number]) {
	let start = canvasPoint(name, from),
		end = canvasPoint(name, to)
	browser(name, "mouse", "move", String(start.x), String(start.y))
	browser(name, "mouse", "down")
	for (let step of [0.25, 0.5, 0.75, 1])
		browser(
			name,
			"mouse",
			"move",
			String(Math.round(start.x + (end.x - start.x) * step)),
			String(Math.round(start.y + (end.y - start.y) * step)),
		)
	browser(name, "mouse", "up")
}
