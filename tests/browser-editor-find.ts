import {
	assert,
	browser,
	evaluate,
	serverAddress,
	wait,
} from "./browser-driver"
import {
	searchHighlightCount,
	searchHighlightsVisible,
} from "./browser-search-highlights"
import { editorPreferences } from "../src/shared/preferences"

let session = "editor-find-" + Date.now()
let server = Bun.spawn(["bun", "tests/browser-document-app.ts", "--serve"], {
	stdout: "pipe",
	stderr: "inherit",
})
try {
	let url = new URL("/app", await serverAddress(server.stdout)).href
	browser(session, "set", "viewport", "1280", "800")
	browser(session, "open", url)
	wait(
		session,
		'document.querySelector("#editor") && !document.querySelector("#editor").readOnly',
	)
	browser(session, "click", '[data-action="new"]')
	wait(
		session,
		'document.querySelector("alkalye-editor").source.value === "" && !document.querySelector("#editor").readOnly',
	)
	fill("Needle needle\n**needle** [needle](https://example.com)")
	browser(session, "press", "Control+f")
	browser(session, "fill", "#find-text", "needle")
	assert(
		evaluate(
			session,
			'(() => {let close = document.querySelector("#close-find").getBoundingClientRect(); let next = document.querySelector("#find-next").getBoundingClientRect(); return close.left > next.right})()',
		),
		"Close is the rightmost Find control",
	)
	wait(session, `${searchHighlightCount} === 4`)
	if (Bun.env.TEST_SEARCH_HIGHLIGHTS === "fallback")
		assert(
			evaluate(
				session,
				'!CSS.highlights?.has("alkalye-search") && document.querySelectorAll(".search-match").length === 4',
			),
			"Unsupported browsers render every match through the overlay fallback",
		)
	assert(
		evaluate(session, searchHighlightsVisible),
		"Plain and projected Markdown matches have visible highlights",
	)
	browser(session, "click", "#find-next")
	wait(
		session,
		'document.querySelectorAll(".search-match[data-active]").length === 1',
	)
	assert(
		evaluate(session, 'document.activeElement.id === "find-text"'),
		"Navigation highlights the active match without stealing search focus",
	)
	browser(session, "check", "#find-case")
	wait(session, `${searchHighlightCount} === 3`)
	browser(session, "check", "#find-regex")
	browser(session, "fill", "#find-text", "[Nn]eedle")
	wait(session, `${searchHighlightCount} === 4`)
	browser(session, "fill", "#find-text", "[")
	wait(session, `${searchHighlightCount} === 0`)
	browser(session, "fill", "#find-text", "(?=needle)")
	wait(
		session,
		`document.querySelector(".find-count").textContent.includes("3") && ${searchHighlightCount} === 0`,
	)
	browser(session, "uncheck", "#find-regex")
	browser(session, "fill", "#find-text", "needle")
	wait(session, `${searchHighlightCount} === 3`)
	fill("needle changed needle")
	wait(
		session,
		`document.querySelector(".find-count").textContent.endsWith("of 2") && ${searchHighlightCount} === 2`,
	)
	evaluate(
		session,
		'document.querySelector("alkalye-editor").source.setSelectionRange(21, 21)',
	)
	browser(session, "click", "#find-next")
	wait(
		session,
		'document.querySelector("alkalye-editor").source.selectionStart === 6 && document.querySelector("alkalye-editor").source.selectionEnd === 6',
	)
	browser(session, "click", "#find-next")
	wait(
		session,
		'document.querySelector("alkalye-editor").source.selectionStart === 21 && document.querySelector("alkalye-editor").source.selectionEnd === 21',
	)
	browser(session, "click", "#find-next")
	wait(
		session,
		'document.querySelector("alkalye-editor").source.selectionStart === 6 && document.querySelector("alkalye-editor").source.selectionEnd === 6',
	)
	assert(
		true,
		"Editing invalidates cached matches; repeated navigation wraps through the new source",
	)
	browser(session, "click", '[data-find-action="toggle-replace"]')
	browser(session, "fill", "#replace-text", "mark")
	browser(session, "click", "#replace-one")
	wait(
		session,
		'document.querySelector("alkalye-editor").source.value === "mark changed needle"',
	)
	assert(
		true,
		"Replace changes the active match even when navigation leaves a collapsed caret",
	)
	browser(session, "click", "#find-next")
	wait(
		session,
		'document.querySelector("alkalye-editor").source.selectionStart === 19 && document.querySelector("alkalye-editor").source.selectionEnd === 19',
	)
	browser(session, "click", "#close-find")
	browser(session, "press", "x")
	wait(
		session,
		'document.querySelector("alkalye-editor").source.value === "mark changed needlex"',
	)
	assert(
		true,
		"Typing after closing Find appends at the match end without replacing the match",
	)
	browser(session, "press", "Control+f")
	fill("needle\n" + "Distant paragraph.\n".repeat(2000) + "needle")
	evaluate(
		session,
		'(() => {let source = document.querySelector("alkalye-editor").source; source.setSelectionRange(source.value.length, source.value.length); source.viewport.scrollTop = 8000; return true})()',
	)
	browser(session, "click", "#find-next")
	wait(
		session,
		'document.querySelector("alkalye-editor").source.selectionStart === 6 && document.querySelector("alkalye-editor").source.selectionEnd === 6 && document.querySelectorAll(".search-match[data-active]").length === 1',
	)
	assert(
		evaluate(
			session,
			'document.querySelector("alkalye-editor").source.value.slice(0, 6) === "needle" && document.activeElement.id === "find-text" && document.querySelector("alkalye-editor").source.viewport.scrollTop < 100',
		),
		"Find reveals a distant selected match and preserves search focus",
	)
	assert(
		evaluate(
			session,
			'(() => {let source = document.querySelector("alkalye-editor").source; source.setSelectionRange(0, source.value.length); let input = document.querySelector("#editor"); return source.selectionStart === 0 && source.selectionEnd === source.value.length && input.value.length === source.value.length && input.selectionEnd === input.value.length})()',
		),
		"Programmatic selection across viewport windows preserves the whole native range",
	)
	fill("needle changed needle")
	browser(session, "click", "#close-find")
	wait(session, `${searchHighlightCount} === 0`)
	assert(
		true,
		"Case, regex, invalid and zero-width searches update or clear highlights",
	)
	if (
		evaluate(
			session,
			'typeof Highlight === "function" && Boolean(CSS.highlights)',
		)
	) {
		browser(session, "press", "Control+f")
		browser(session, "fill", "#find-text", "needle")
		wait(session, `${searchHighlightCount} === 2`)
		evaluate(
			session,
			`(() => {
				let Editor = customElements.get("alkalye-editor"), second = new Editor();
				second.dataset.searchOwner = "second";
				second.style.cssText = "position:fixed;inset:300px 20px auto auto;width:300px;height:100px";
				second.configure({
					content: "Second needle", atoms: [], editable: false,
					preferences: ${JSON.stringify(editorPreferences({}))},
					isDrawing: () => false, openDrawing() {}, documents: () => [], openDocument() {},
					createLinkedDocument: async () => "", report(error) {throw error}, comments: () => [],
					change: () => undefined, undo() {}, select() {}, requestAsset() {}, attach() {}, command() {}, find() {}
				});
				document.body.append(second);
				second.search(/needle/g);
			})()`,
		)
		wait(session, `${searchHighlightCount} === 3`)
		browser(session, "click", "#close-find")
		wait(session, `${searchHighlightCount} === 1`)
		assert(
			evaluate(
				session,
				'[...CSS.highlights.get("alkalye-search")].every(range => document.querySelector("[data-search-owner=second]").contains(range.startContainer))',
			),
			"Closing one search preserves the other editor's native highlights",
		)
		evaluate(
			session,
			'document.querySelector("[data-search-owner=second]").remove()',
		)
		wait(session, `${searchHighlightCount} === 0`)
		assert(true, "Removing an editor releases its native search ranges")
	}

	browser(session, "set", "viewport", "504", "842")
	browser(session, "press", "Control+f")
	wait(session, 'Boolean(document.querySelector("#close-find"))')
	assert(
		evaluate(
			session,
			'(() => {let close = document.querySelector("#close-find").getBoundingClientRect(); let next = document.querySelector("#find-next").getBoundingClientRect(); return close.left > next.right && close.right <= innerWidth})()',
		),
		"Mobile Find also keeps Close on the right",
	)
	browser(session, "press", "Escape")
	wait(
		session,
		`document.querySelector("#find-bar").hidden && ${searchHighlightCount} === 0`,
	)
	browser(session, "set", "viewport", "1280", "800")

	fill("first needle\n" + "ordinary line\n".repeat(3000) + "last needle")
	evaluate(
		session,
		'document.querySelector("alkalye-editor").selectRange(0, 0)',
	)
	browser(session, "press", "Control+f")
	browser(session, "fill", "#find-text", "needle")
	wait(session, `${searchHighlightCount} === 1`)
	browser(session, "click", "#find-previous")
	wait(
		session,
		'document.querySelectorAll(".search-match[data-active]").length === 1 && document.querySelector("alkalye-editor").source.selectionEnd === document.querySelector("alkalye-editor").source.value.length',
	)
	assert(
		evaluate(
			session,
			'(() => {let mark = document.querySelector(".search-match[data-active]").getBoundingClientRect(); return mark.width > 0 && mark.top >= 0 && mark.bottom <= innerHeight})()',
		),
		"Distant matches paint after crossing viewport windows",
	)
	browser(session, "click", "#close-find")
	wait(session, `${searchHighlightCount} === 0`)
	let dense = ("a" + "\u0301".repeat(400)).repeat(40)
	fill(dense)
	evaluate(
		session,
		'document.querySelector("alkalye-editor").selectRange(document.querySelector("alkalye-editor").source.value.length)',
	)
	wait(
		session,
		`document.querySelector("#editor").value === ${JSON.stringify(dense)} && document.querySelector("#editor").parentElement.scrollHeight <= document.querySelector("#editor").parentElement.clientHeight`,
	)
	browser(session, "keyboard", "inserttext", "!")
	wait(
		session,
		`document.querySelector("alkalye-editor").source.value === ${JSON.stringify(dense + "!")} && document.querySelector("#editor").parentElement.scrollHeight <= document.querySelector("#editor").parentElement.clientHeight`,
	)
	assert(
		true,
		"Dense combining text stays on its native visual row while editing",
	)
	let ordinary = "ordinary line\n".repeat(3000)
	fill(ordinary)
	wait(
		session,
		'document.querySelector("#editor").value.length < 8192 && document.querySelector("#editor").parentElement.scrollHeight > document.querySelector("#editor").parentElement.clientHeight',
	)
	assert(
		true,
		"Replacing dense text restores bounded native windows and document scrolling",
	)
	evaluate(
		session,
		`(() => {
		window.previousEditorLineHeight = document.documentElement.style.getPropertyValue("--editor-line-height");
		window.lineHeightSelection = document.querySelector("alkalye-editor").source.selectionStart;
		document.documentElement.style.setProperty("--editor-line-height", "2.25");
	})()`,
	)
	wait(
		session,
		'(() => {let native=document.querySelector("#editor"), line=document.querySelector("[data-editor-line]"), height=Math.round(parseFloat(getComputedStyle(native).fontSize)*2.25*64)/64; return parseFloat(getComputedStyle(native).lineHeight)===height && parseFloat(getComputedStyle(line).lineHeight)===height})()',
	)
	assert(
		evaluate(
			session,
			`document.querySelector("alkalye-editor").source.value === ${JSON.stringify(ordinary)} && document.querySelector("alkalye-editor").source.selectionStart === window.lineHeightSelection`,
		),
		"Changing line spacing keeps native and painted rows aligned without moving the source selection",
	)
	evaluate(
		session,
		'(() => {let root=document.documentElement; if(window.previousEditorLineHeight)root.style.setProperty("--editor-line-height",window.previousEditorLineHeight);else root.style.removeProperty("--editor-line-height")})()',
	)
	wait(
		session,
		'(() => {let native=document.querySelector("#editor"), height=Math.round(parseFloat(getComputedStyle(native).fontSize)*Number(window.previousEditorLineHeight || "1.8")*64)/64;return Math.abs(parseFloat(getComputedStyle(native).lineHeight)-height)<0.001})()',
	)
} finally {
	try {
		browser(session, "close")
	} finally {
		server.kill()
		await server.exited
	}
}
function fill(content: string) {
	evaluate(
		session,
		`(() => {let source = document.querySelector("alkalye-editor").source; source.value = ${JSON.stringify(content)}; source.setSelectionRange(0, 0); source.dispatchEvent(new Event("input"));})()`,
	)
	wait(
		session,
		`document.querySelector("alkalye-editor").source.value === ${JSON.stringify(content)}`,
	)
}
