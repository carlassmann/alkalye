import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import {
	DocumentSnapshotSchema,
	restoreSnapshot,
} from "../src/shared/document-actions"
import { startServer } from "../src/server/index"
import { object, string } from "../src/shared/model"
import {
	assert,
	browser,
	evaluate,
	wait,
	visit,
	currentDocument,
} from "./browser-driver"
import { verifyNativeAssets } from "./browser-native-assets"
import { verifyNativeDrawings } from "./browser-native-drawings"
import { verifyNativeThemes } from "./browser-native-themes"
import { verifyNativeWorkspaces } from "./browser-native-workspaces"
import { verifyNativeAgents } from "./browser-native-agents"
import { verifyReaderPresence } from "./browser-native-presence"
import { verifyNativeRoutes } from "./browser-native-routes"
import {
	verifyNativeComments,
	verifyOfflineNativeComments,
	verifyCommentDialogNavigation,
} from "./browser-native-comments"

if (process.argv.includes("--serve")) {
	let directory = await mkdtemp(join(tmpdir(), "alkalye-native-editor-"))
	let instance: Effect.Success<ReturnType<typeof startServer>>
	let snapshotWaiting = false
	let snapshotAborted = false
	let pauseFonts = false
	let resumeFonts: Array<() => void> = []
	let blockedSockets = 0
	let polls = 0
	let proxy = Bun.serve({
		port: 0,
		// Live long polls wait longer than Bun's default idle timeout.
		idleTimeout: 60,
		async fetch(request) {
			let url = new URL(request.url)
			if (url.pathname === "/__tests/live")
				return Response.json({ blockedSockets, polls })
			// Pages that opt in reach the live socket through this proxy,
			// which refuses upgrades like a restrictive corporate proxy.
			if (url.pathname === "/api/live") {
				blockedSockets++
				return new Response("WebSocket blocked by proxy", { status: 403 })
			}
			if (url.pathname === "/api/live/poll") polls++
			if (url.pathname === "/__tests/fonts") {
				pauseFonts = url.searchParams.get("pause") === "true"
				if (!pauseFonts) for (let resume of resumeFonts.splice(0)) resume()
				return Response.json({ paused: pauseFonts })
			}
			if (pauseFonts && url.pathname.endsWith(".woff2"))
				await new Promise<void>(resolve => resumeFonts.push(resolve))
			if (url.pathname === "/__tests/snapshot-request")
				return Response.json({
					waiting: snapshotWaiting,
					aborted: snapshotAborted,
				})
			if (url.pathname === "/api/documents/never-answer/snapshot") {
				snapshotWaiting = true
				request.signal.addEventListener(
					"abort",
					() => {
						snapshotAborted = true
					},
					{ once: true },
				)
				return new Response(
					new ReadableStream({
						start(controller) {
							controller.enqueue(new TextEncoder().encode("{"))
						},
						cancel() {
							snapshotAborted = true
						},
					}),
					{ headers: { "content-type": "application/json" } },
				)
			}
			// Every app address is served the same shell, so instrument them all.
			let shell =
				request.method === "GET" &&
				(url.pathname === "/app" ||
					url.pathname.startsWith("/app/") ||
					url.pathname === "/invite")
			let headers = new Headers(request.headers)
			headers.set("host", proxy.url.host)
			let response = await fetch(
				new URL(url.pathname + url.search, instance.server.url),
				{
					redirect: "manual",
					decompress: shell,
					method: request.method,
					headers,
					body:
						request.method === "GET" || request.method === "HEAD"
							? undefined
							: await request.arrayBuffer(),
					signal: request.signal,
				},
			)
			if (shell) {
				let markup = await response.text()
				let instrumentation =
					(Bun.env.TEST_SEARCH_HIGHLIGHTS === "fallback"
						? '<script>Object.defineProperty(window, "Highlight", {value:undefined, configurable:true})</script>'
						: "") +
					'<script>if (localStorage.getItem("native-preferences-offline")) Object.defineProperty(navigator, "onLine", {value:false, configurable:true})</script>' +
					`<script>
					window.liveSocketConnections = 0;
					window.WebSocket = class extends WebSocket {
						constructor(url, protocols) {
							let target = new URL(url);
							if (target.pathname === "/api/live" && !localStorage.getItem("live-websocket-blocked")) target.port = "${instance.server.port}";
							super(target.href, protocols);
							if (target.pathname === "/api/live") this.addEventListener("open", () => window.liveSocketConnections++);
						}
					};
					</script>` +
					'<script>let originalFetch = fetch; window.fetch = function(input, init) { let url = new URL(input instanceof Request ? input.url : String(input), location.origin); if (url.pathname === "/api/documents/never-answer/snapshot") { window.snapshotStarted = (window.snapshotStarted ?? 0) + 1; init.signal.addEventListener("abort", () => { window.snapshotAborted = true }, {once:true}) }; return originalFetch(input, init) }</script>'
				return new Response(
					markup.replace("</head>", instrumentation + "</head>"),
					{ headers: { "content-type": "text/html" } },
				)
			}
			return response
		},
	})
	instance = await Effect.runPromise(
		startServer({
			port: 0,
			data: directory,
			assets: process.env.ALKALYE_TEST_ASSETS ?? join(directory, "app-shell"),
			build: !process.env.ALKALYE_TEST_ASSETS,
			publicOrigin: proxy.url.origin,
		}),
	)
	let stopping = false
	for (let signal of ["SIGINT", "SIGTERM"])
		process.once(signal, async () => {
			if (stopping) return
			stopping = true
			await proxy.stop(true)
			await Effect.runPromise(instance.close())
			await rm(directory, { recursive: true, force: true })
			process.exit(0)
		})
	console.log(proxy.url.href)
} else {
	let server = Bun.spawn(["bun", "tests/browser-document-app.ts", "--serve"], {
		stdout: "pipe",
		stderr: "inherit",
	})
	let session = "native-editor-" + Date.now()
	let reader = "native-reader-" + Date.now()
	try {
		let output = await server.stdout.getReader().read()
		if (!output.value) throw new Error("Missing native editor URL")
		let origin = new TextDecoder().decode(output.value).trim()
		let url = new URL("/app", origin).href
		console.log(url)
		browser(session, "open", url)
		wait(session, 'document.querySelector("[data-document-app]") !== null')
		browser(session, "click", '[data-action="new"]')
		wait(
			session,
			'document.querySelector("#editor") && !document.querySelector("#editor").readOnly',
		)
		assert(
			evaluate(
				session,
				'document.querySelector("#app").tagName === "ALKALYE-APP" && document.querySelector("#editor").parentElement.tagName === "ALKALYE-EDITOR"',
			),
			"native app and editor use registered Custom Elements",
		)
		let first = string(evaluate(session, currentDocument))
		let initialSource = string(
			evaluate(session, 'document.querySelector("#editor").value'),
		)
		let source =
			"---\ntitle: Native journal\nmode: present\npath: Projects\ntags: [platform]\n---\n# First slide\n\nHello from a document event stream.\n\n---\n\n# Second slide\n\nSnapshot first, history later."
		browser(session, "fill", "#editor", source)
		wait(
			session,
			'document.querySelector(".document-row.active strong")?.textContent === "Native journal"',
		)
		wait(
			session,
			'document.querySelector("#save-status")?.textContent === "Saved"',
		)
		assert(
			evaluate(
				session,
				`(() => {let component = document.querySelector("alkalye-editor"), parent = component.parentElement, old = component.querySelector("textarea"); component.remove(); let released = old.oninput === null && old.onkeydown === null; parent.append(component); component.querySelector("textarea").focus(); return released && component.querySelector("textarea") !== old && component.querySelector("textarea").value === ${JSON.stringify(source)}})()`,
			),
			"editor disconnect releases handlers and reconnect restores its current source",
		)
		assert(
			evaluate(session, 'document.querySelector("#editor").value') === source,
			"native editor saves exact frontmatter and source through the document journal",
		)
		assert(
			evaluate(
				session,
				'document.querySelector(".document-row.active").textContent.includes("platform")',
			),
			"cached summaries derive sidebar metadata from source",
		)
		browser(session, "press", "Control+z")
		wait(
			session,
			'document.querySelector("#editor")?.value === ' +
				JSON.stringify(initialSource),
		)
		assert(
			evaluate(
				session,
				'document.querySelector(".document-row.active strong")?.textContent !== "Native journal"',
			),
			"native keyboard undo restores source and its derived sidebar metadata",
		)
		browser(session, "press", "Control+Shift+z")
		wait(
			session,
			'document.querySelector("#editor")?.value === ' + JSON.stringify(source),
		)
		wait(
			session,
			'document.querySelector("#save-status")?.textContent === "Saved"',
		)
		assert(true, "native keyboard redo saves a fresh document compensation")
		let comment = verifyNativeComments(session)
		if (!process.argv.includes("--offline-data")) {
			verifyNativeAssets(session, source)
			verifyNativeDrawings(session, first)
			verifyNativeThemes(session, first)
		}
		browser(session, "click", '[data-action="preview"]')
		assert(
			evaluate(
				session,
				'document.querySelector("#preview")?.shadowRoot?.textContent.includes("Hello from a document event stream.")',
			),
			"native snapshot source renders in the existing isolated preview",
		)
		browser(session, "click", ".preview-back")
		wait(session, 'document.querySelector("#editor") !== null')
		browser(session, "click", '[data-action="slideshow"]')
		wait(
			session,
			'document.querySelector("alkalye-presentation")?.dataset.slide === "1"',
		)
		browser(session, "press", "ArrowRight")
		assert(
			evaluate(
				session,
				'document.querySelector("alkalye-presentation")?.dataset.slide === "2"',
			),
			"native slideshow reuses the presentation controls and keyboard navigation",
		)
		browser(session, "press", "Escape")
		browser(session, "click", '[data-action="teleprompter"]')
		assert(
			evaluate(
				session,
				'document.querySelector("#presentation-timer") !== null && document.querySelector("#speaker-notes") !== null',
			),
			"native teleprompter mounts its timer and speaker notes",
		)
		browser(session, "press", "Escape")
		evaluate(
			session,
			'window.originalLibraryPut = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function(...args) { if (this.name === "settings" && typeof args[1] === "string" && args[1].startsWith("document-library:")) throw new DOMException("Library cache quota exceeded", "QuotaExceededError"); return Reflect.apply(window.originalLibraryPut, this, args) }',
		)
		browser(session, "click", '[data-action="new"]')
		wait(
			session,
			currentDocument +
				" !== " +
				JSON.stringify(first) +
				' && document.querySelector("#editor") && !document.querySelector("#editor").readOnly',
		)
		let second = string(evaluate(session, currentDocument))
		wait(
			session,
			'document.querySelector("#sync-status")?.textContent === "Could not cache the library on this device"',
		)
		assert(
			evaluate(session, `!!document.querySelector('[data-doc="${second}"]')`),
			"a failed library-cache write preserves the fetched catalogue and keeps a newly created document writable",
		)
		browser(
			session,
			"fill",
			"#editor",
			"# Another document\n\nAn independent stream.",
		)
		wait(
			session,
			'document.querySelector("#save-status")?.textContent === "Saved"',
		)
		wait(session, "!!navigator.serviceWorker.controller")
		browser(session, "set", "offline", "on")
		browser(session, "reload")
		wait(
			session,
			'document.querySelector("#editor")?.value.startsWith("# Another document")',
		)
		assert(
			evaluate(session, `!!document.querySelector('[data-doc="${second}"]')`) &&
				evaluate(
					session,
					'document.querySelector("#editor").readOnly === false',
				),
			"accepted creation survives offline reload when the remote library cannot be cached",
		)
		browser(session, "set", "offline", "off")
		evaluate(session, 'window.dispatchEvent(new Event("focus"))')
		browser(session, "click", `[data-doc="${first}"]`)
		wait(
			session,
			'document.querySelector("#editor")?.value === ' + JSON.stringify(source),
		)
		assert(
			true,
			"switching scoped sessions restores the original document without a workspace-wide writer",
		)
		verifyCommentDialogNavigation(session, comment, first, second)
		evaluate(
			session,
			'window.originalSettingsPut = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function(...args) { if (this.name === "settings" && typeof args[1] === "string" && args[1].startsWith("native-selected:")) throw new DOMException("Remembered selection failed", "QuotaExceededError"); return Reflect.apply(window.originalSettingsPut, this, args) }',
		)
		browser(session, "click", `[data-doc="${second}"]`)
		wait(
			session,
			'document.querySelector("#editor")?.value.startsWith("# Another document")',
		)
		assert(
			evaluate(session, 'document.querySelector("#editor").readOnly === false'),
			"a failed selection-cache write cannot close the newly opened document or leave the old editor selected",
		)
		evaluate(
			session,
			"IDBObjectStore.prototype.put = window.originalSettingsPut; delete window.originalSettingsPut",
		)
		evaluate(
			session,
			'window.originalHistoryPush = history.pushState; history.pushState = function() { throw new DOMException("Browser navigation rejected", "SecurityError") }',
		)
		browser(session, "click", `[data-doc="${first}"]`)
		wait(
			session,
			'document.querySelector("#editor")?.value === ' + JSON.stringify(source),
		)
		assert(
			evaluate(session, currentDocument) === first &&
				evaluate(
					session,
					'document.querySelector("#editor").readOnly === false',
				),
			"a rejected history update still mounts the adopted live document and repairs its URL",
		)
		evaluate(
			session,
			"history.pushState = window.originalHistoryPush; delete window.originalHistoryPush",
		)
		evaluate(
			session,
			'history.pushState(null, "", "/app/doc/never-answer"); dispatchEvent(new PopStateEvent("popstate"))',
		)
		wait(
			session,
			'fetch("/__tests/snapshot-request").then(response => response.json()).then(state => state.waiting)',
		)
		let navigationStarted = Date.now()
		browser(session, "click", `[data-doc="${second}"]`)
		wait(
			session,
			'document.querySelector("#editor")?.value.startsWith("# Another document")',
		)
		console.log(
			"MEASURE stalled navigation",
			JSON.stringify({
				elapsed: Date.now() - navigationStarted,
				aborted: evaluate(session, "window.snapshotAborted === true"),
				selected: evaluate(session, currentDocument),
			}),
		)
		assert(
			Date.now() - navigationStarted < 3000 &&
				evaluate(session, "window.snapshotAborted === true") &&
				evaluate(session, currentDocument) === second,
			"a stalled remote snapshot is aborted when another local document opens immediately",
		)
		evaluate(
			session,
			'window.snapshotAborted = false; history.pushState(null, "", "/app/doc/never-answer"); dispatchEvent(new PopStateEvent("popstate"))',
		)
		wait(session, "window.snapshotStarted === 2")
		browser(session, "click", `[data-doc="${second}"]`)
		wait(
			session,
			currentDocument +
				" === " +
				JSON.stringify(second) +
				" && window.snapshotAborted === true",
		)
		assert(
			evaluate(
				session,
				'document.querySelector("#editor")?.value.startsWith("# Another document")',
			),
			"selecting the current document cancels remote navigation and restores its URL",
		)
		browser(session, "click", `[data-doc="${first}"]`)
		wait(
			session,
			'document.querySelector("#editor")?.value === ' + JSON.stringify(source),
		)
		wait(session, "!!navigator.serviceWorker.controller")
		browser(session, "set", "offline", "on")
		browser(session, "reload")
		wait(
			session,
			'document.querySelector("#editor")?.value === ' + JSON.stringify(source),
		)
		assert(
			evaluate(
				session,
				'performance.getEntriesByType("resource").every(entry => !entry.name.includes("/api/documents/"))',
			),
			"offline native route opens its cached snapshot and journal without downloading history",
		)
		verifyOfflineNativeComments(session, comment)
		let offline = source + "x"
		browser(session, "click", "#editor")
		evaluate(
			session,
			'let editor = document.querySelector("#editor"); editor.setSelectionRange(editor.value.length, editor.value.length)',
		)
		browser(session, "press", "x")
		wait(
			session,
			'document.querySelector("#save-status")?.textContent === "Saved on this device"',
		)
		browser(session, "reload")
		wait(
			session,
			'document.querySelector("#editor")?.value === ' + JSON.stringify(offline),
		)
		assert(true, "offline native edits survive a complete page reload")
		browser(session, "click", "#editor")
		browser(session, "press", "Control+z")
		wait(
			session,
			'document.querySelector("#editor")?.value === ' + JSON.stringify(source),
		)
		wait(
			session,
			'document.querySelector("#save-status")?.textContent === "Saved on this device"',
		)
		browser(session, "reload")
		wait(
			session,
			'document.querySelector("#editor")?.value === ' + JSON.stringify(source),
		)
		browser(session, "click", "#editor")
		browser(session, "press", "Control+Shift+z")
		wait(
			session,
			'document.querySelector("#editor")?.value === ' + JSON.stringify(offline),
		)
		wait(
			session,
			'document.querySelector("#save-status")?.textContent === "Saved on this device"',
		)
		assert(
			true,
			"offline keyboard undo survives reload and redo restores its exact source",
		)
		browser(session, "click", `[data-doc="${second}"]`)
		wait(
			session,
			'document.querySelector("#editor")?.value.startsWith("# Another document")',
		)
		browser(session, "click", `[data-doc="${first}"]`)
		wait(
			session,
			'document.querySelector("#editor")?.value === ' + JSON.stringify(offline),
		)
		assert(
			true,
			"offline document switching keeps journal-backed source intact",
		)
		browser(session, "click", '[data-action="new"]')
		wait(
			session,
			currentDocument +
				" !== " +
				JSON.stringify(first) +
				' && document.querySelector("#editor")?.readOnly === false',
		)
		let createdOffline = string(evaluate(session, currentDocument))
		let offlineCreationSource =
			"---\ntitle: Created offline\npath: Offline\ntags: [durable]\n---\n# A document born offline\n\nNo connection was required."
		browser(session, "fill", "#editor", offlineCreationSource)
		wait(
			session,
			'document.querySelector("#save-status")?.textContent === "Saved on this device"',
		)
		assert(
			evaluate(session, 'document.querySelector("#editor").value') ===
				offlineCreationSource,
			"native document creation and editing require no connection",
		)
		browser(session, "reload")
		wait(
			session,
			'document.querySelector("#editor")?.value === ' +
				JSON.stringify(offlineCreationSource),
		)
		assert(
			evaluate(
				session,
				'performance.getEntriesByType("resource").every(entry => !entry.name.includes("/api/documents/"))',
			),
			"a document created offline reopens from its own journal without a remote snapshot",
		)
		browser(session, "click", `[data-doc="${first}"]`)
		wait(
			session,
			'document.querySelector("#editor")?.value === ' + JSON.stringify(offline),
		)
		wait(
			session,
			`document.querySelector('[data-doc="${createdOffline}"]')?.textContent.includes("Created offline")`,
		)
		assert(
			true,
			"closed offline documents retain source-derived sidebar metadata",
		)
		evaluate(
			session,
			'window.originalJournalAdd = IDBObjectStore.prototype.add; IDBObjectStore.prototype.add = function(...args) { if (this.name === "entries") throw new DOMException("Journal quota exceeded", "QuotaExceededError"); return Reflect.apply(window.originalJournalAdd, this, args) }',
		)
		offline += "\n\nKeep this draft if saving fails."
		browser(session, "fill", "#editor", offline)
		wait(
			session,
			'document.querySelector("#save-status")?.textContent === "Could not save on this device"',
		)
		browser(session, "click", `[data-doc="${second}"]`)
		wait(
			session,
			'document.querySelector("#toast")?.textContent !== "" && document.querySelector("#editor")?.readOnly === false',
		)
		assert(
			evaluate(session, currentDocument) === first &&
				evaluate(session, 'document.querySelector("#editor").value') ===
					offline,
			"a failed source flush refuses document switching and preserves the current unsaved draft",
		)
		evaluate(
			session,
			`history.pushState(null, "", "/app/doc/" + ${JSON.stringify(second)}); dispatchEvent(new PopStateEvent("popstate"))`,
		)
		wait(session, currentDocument + " === " + JSON.stringify(first))
		assert(
			evaluate(session, 'document.querySelector("#editor").value') === offline,
			"failed URL navigation restores the selected document URL without discarding its unsaved draft",
		)
		evaluate(
			session,
			"IDBObjectStore.prototype.add = window.originalJournalAdd; delete window.originalJournalAdd",
		)
		wait(
			session,
			'document.querySelector("#save-status")?.textContent === "Saved on this device"',
		)
		browser(session, "set", "offline", "off")
		wait(
			session,
			'document.querySelector("#save-status")?.textContent === "Saved"',
		)
		wait(
			session,
			`fetch("/api/documents/${createdOffline}/snapshot").then(response => response.ok)`,
		)
		assert(
			evaluate(session, currentDocument) === first,
			"the background drainer publishes an offline-created document while it remains closed",
		)
		let creationHistory = evaluate(
			session,
			`fetch("/api/documents/${createdOffline}/history?after=0").then(response => response.json())`,
		)
		assert(
			Array.isArray(creationHistory) &&
				creationHistory.filter(
					fact => object(object(fact).action).label === "Create document",
				).length === 1,
			"publication retries retain one accepted creation action",
		)
		browser(session, "tab", "new", "--label", "peer", url + "/doc/" + first)
		wait(
			session,
			'document.querySelector("#editor")?.value === ' + JSON.stringify(offline),
		)
		let peer = offline + "\n\nA second tab contributed."
		browser(session, "fill", "#editor", peer)
		wait(
			session,
			'document.querySelector("#save-status")?.textContent === "Saved"',
		)
		browser(session, "tab", "t1")
		wait(
			session,
			'document.querySelector("#editor")?.value === ' + JSON.stringify(peer),
		)
		assert(
			true,
			"independent native app tabs share durable changes and accept distinct document actors",
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
		browser(reader, "open", url)
		wait(reader, 'document.querySelector("[data-document-app]") !== null')
		wait(reader, 'fetch("/api/accounts/session").then(response => response.ok)')
		let readerAccount = object(
			evaluate(
				reader,
				'fetch("/api/accounts/session").then(response => response.json())',
			),
		)
		if (typeof readerAccount.subject !== "string") {
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
		assert(
			evaluate(
				session,
				`fetch(${JSON.stringify(membership)}, {method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({role:"reader",request:"reader-v1"})}).then(response=>response.ok)`,
			),
			"native workspace owner grants reader access through the authenticated protocol",
		)
		browser(reader, "open", url + "/doc/" + first)
		wait(
			reader,
			'document.querySelector("#editor")?.value === ' + JSON.stringify(peer),
		)
		assert(
			evaluate(reader, 'document.querySelector("#editor").readOnly'),
			"native controller enforces reader access on the actual editor",
		)
		verifyReaderPresence(session, reader, first)
		browser(reader, "click", '[data-action="comments"]')
		wait(
			reader,
			'document.querySelector("[data-comments]")?.textContent.includes("Keep this discussion offline")',
		)
		assert(
			evaluate(
				reader,
				'document.querySelector("[data-comments] [data-action=comment]") === null && document.querySelector("[data-comments] footer") === null',
			),
			"native readers see discussion and source navigation without mutation controls",
		)
		browser(reader, "click", '[data-action="tools"]')
		visit(reader, "/app/doc/" + first + "/slideshow")
		wait(reader, 'document.querySelector("alkalye-presentation") !== null')
		browser(reader, "press", "Escape")
		assert(
			evaluate(
				reader,
				'location.pathname.endsWith("/slideshow") && document.querySelector("alkalye-presentation") !== null',
			),
			"Escape keeps a reader in the audience slideshow",
		)
		visit(reader, "/app/doc/" + first)
		wait(reader, 'document.querySelector("#editor")?.readOnly === true')
		assert(
			evaluate(
				session,
				`fetch(${JSON.stringify(membership)}, {method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({role:"writer",request:"writer-v1"})}).then(response=>response.ok)`,
			),
			"native owner can promote the same member to writer",
		)
		evaluate(reader, 'window.dispatchEvent(new Event("focus"))')
		wait(reader, 'document.querySelector("#editor")?.readOnly === false')
		let written = peer + "\n\nWritten by the workspace member."
		browser(reader, "fill", "#editor", written)
		wait(
			reader,
			'document.querySelector("#save-status")?.textContent === "Saved"',
		)
		wait(
			session,
			'document.querySelector("#editor")?.value === ' + JSON.stringify(written),
		)
		assert(
			true,
			"writer promotion enables native editing and synchronizes its accepted source",
		)
		evaluate(
			reader,
			'localStorage.setItem("live-websocket-blocked","true"); localStorage.setItem("native-preferences-offline","true")',
		)
		browser(reader, "reload")
		wait(
			reader,
			'document.querySelector("#editor")?.value === ' + JSON.stringify(written),
		)
		browser(reader, "set", "offline", "on")
		wait(
			reader,
			'navigator.onLine === false && document.querySelector("#editor")?.readOnly === false',
		)
		let offlineContribution = written + "\n\nOffline writer contribution."
		browser(reader, "fill", "#editor", offlineContribution)
		wait(
			reader,
			'document.querySelector("#editor")?.value === ' +
				JSON.stringify(offlineContribution) +
				' && document.querySelector("#save-status").getAttribute("aria-busy") === "false" && Number(document.querySelector("#save-status").dataset.pending) > 0',
		)
		let onlineContribution = written + "\n\nOnline owner contribution."
		browser(session, "fill", "#editor", onlineContribution)
		wait(
			session,
			'document.querySelector("#editor")?.value === ' +
				JSON.stringify(onlineContribution) +
				' && document.querySelector("#save-status")?.textContent === "Saved"',
		)
		browser(reader, "reload")
		wait(
			reader,
			'document.querySelector("#editor")?.value === ' +
				JSON.stringify(offlineContribution),
		)
		browser(reader, "set", "offline", "off")
		evaluate(
			reader,
			'localStorage.removeItem("native-preferences-offline"); localStorage.removeItem("live-websocket-blocked"); delete navigator.onLine; dispatchEvent(new Event("online")); dispatchEvent(new Event("focus"))',
		)
		wait(
			reader,
			'document.querySelector("#save-status")?.dataset.pending === "0" && document.querySelector("#editor").value.includes("Offline writer contribution.") && document.querySelector("#editor").value.includes("Online owner contribution.")',
		)
		written = String(
			evaluate(reader, 'document.querySelector("alkalye-editor").source.value'),
		)
		wait(
			session,
			'document.querySelector("alkalye-editor")?.source.value === ' +
				JSON.stringify(written),
		)
		let mergedSnapshot = Schema.decodeUnknownSync(DocumentSnapshotSchema)(
			evaluate(
				session,
				`fetch("/api/documents/${first}/snapshot").then(response=>response.json())`,
			),
		)
		let merged = await Effect.runPromise(
			restoreSnapshot(mergedSnapshot, "offline-convergence-oracle"),
		)
		assert(
			merged.text(first) === written,
			"independent online and offline writers converge to the exact accepted source after reload and reconnect",
		)
		evaluate(
			reader,
			'{let input = document.querySelector("#editor"); input.focus(); input.setSelectionRange(0, 5); input.dispatchEvent(new Event("select"))}',
		)
		wait(session, 'document.querySelectorAll(".remote-selection").length > 0')
		assert(
			true,
			"native live channel renders another writer's cursor and selection",
		)
		browser(session, "click", '[data-action="teleprompter"]')
		browser(session, "click", '#speaker-notes [data-item="0"]')
		let presentingDocument = String(evaluate(session, currentDocument))
		visit(reader, "/app/doc/" + presentingDocument + "/slideshow?follow=1")
		wait(reader, 'document.querySelector("alkalye-presentation") !== null')
		let laserBounds = object(
			evaluate(
				session,
				'(() => {let bounds=document.querySelector("#slide").getBoundingClientRect();return {x:bounds.left+40,y:bounds.top+40}})()',
			),
		)
		let laserX = Math.round(Number(laserBounds.x)),
			laserY = Math.round(Number(laserBounds.y))
		browser(session, "mouse", "move", String(laserX), String(laserY))
		browser(session, "mouse", "down")
		browser(session, "mouse", "move", String(laserX + 80), String(laserY + 45))
		wait(
			reader,
			'document.querySelector(".laser-trail path").getAttribute("d")?.length > 0',
		)
		browser(session, "mouse", "up")
		assert(
			true,
			"native presentation broadcasts the laser pointer through the same live channel",
		)
		browser(session, "press", "ArrowRight")
		wait(
			reader,
			'document.querySelector("alkalye-presentation")?.dataset.slide === "2"',
		)
		assert(true, "native audience follows the presenter's selected slide")
		browser(session, "click", '[data-action="edit"]')
		browser(reader, "click", '[data-action="edit"]')

		let revokedDraft =
			written + "\n\nRetain this offline contribution after revocation."
		visit(reader, url + "/doc/" + first)
		wait(
			reader,
			'document.querySelector("#editor")?.value === ' +
				JSON.stringify(written) +
				' && document.querySelector("#editor").readOnly === false',
		)
		evaluate(
			reader,
			'localStorage.setItem("live-websocket-blocked","true"); localStorage.setItem("native-preferences-offline","true")',
		)
		browser(reader, "reload")
		wait(
			reader,
			'document.querySelector("#editor")?.value === ' + JSON.stringify(written),
		)
		browser(reader, "set", "offline", "on")
		wait(
			reader,
			'navigator.onLine === false && document.querySelector("#editor")?.readOnly === false',
		)
		browser(reader, "fill", "#editor", revokedDraft)
		wait(
			reader,
			'document.querySelector("#editor")?.value === ' +
				JSON.stringify(revokedDraft) +
				' && document.querySelector("#save-status").getAttribute("aria-busy") === "false" && Number(document.querySelector("#save-status").dataset.pending) > 0',
		)
		browser(reader, "reload")
		wait(
			reader,
			'document.querySelector("#editor")?.value === ' +
				JSON.stringify(revokedDraft),
		)
		assert(
			true,
			"a writer's unsynchronized source survives a complete offline reload before revocation",
		)

		assert(
			evaluate(
				session,
				`fetch(${JSON.stringify(membership)}, {method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({role:null,request:"remove-v1"})}).then(response=>response.ok)`,
			),
			"native owner revokes inherited workspace access",
		)
		browser(reader, "set", "offline", "off")
		evaluate(
			reader,
			'localStorage.removeItem("native-preferences-offline"); localStorage.removeItem("live-websocket-blocked"); delete navigator.onLine; dispatchEvent(new Event("online")); dispatchEvent(new Event("focus"))',
		)
		wait(
			reader,
			'document.querySelector("#editor")?.readOnly === true && document.querySelector("alkalye-sync-recovery")?.hidden === false',
		)
		assert(
			evaluate(reader, 'document.querySelector("#editor").value') ===
				revokedDraft,
			"revocation makes the editor read-only while preserving its local source for export",
		)
		assert(
			evaluate(
				reader,
				`fetch("/api/documents/${first}/snapshot").then(response=>response.status)`,
			) === 404,
			"revoked native members cannot download another document snapshot",
		)
		let acceptedSnapshot = Schema.decodeUnknownSync(DocumentSnapshotSchema)(
			evaluate(
				session,
				`fetch("/api/documents/${first}/snapshot").then(response=>response.json())`,
			),
		)
		let accepted = await Effect.runPromise(
			restoreSnapshot(acceptedSnapshot, "offline-revocation-oracle"),
		)
		assert(
			accepted.text(first) === written,
			"revoked offline contributions remain local and never enter the owner's accepted source",
		)
		assert(
			evaluate(
				reader,
				'document.querySelector("alkalye-sync-recovery").textContent.includes("Your edits remain on this device") && !document.querySelector("[data-action=recover-copy]").disabled',
			),
			"revocation exposes a usable personal-copy recovery action",
		)
		browser(reader, "set", "offline", "on")
		browser(reader, "reload")
		wait(
			reader,
			'document.querySelector("#editor")?.value === ' +
				JSON.stringify(revokedDraft),
		)
		assert(
			true,
			"revoked pending source remains journal-backed across a second offline reload",
		)
		browser(reader, "set", "offline", "off")

		verifyNativeWorkspaces(session, reader, subject, url)
		verifyNativeAgents(session, url)
		await verifyNativeRoutes(session, url)
	} finally {
		browser(session, "set", "offline", "off")
		browser(session, "close")
		browser(reader, "close")
		server.kill("SIGTERM")
		await server.exited
	}
}
