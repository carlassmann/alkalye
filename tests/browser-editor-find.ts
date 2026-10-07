import {
	assert,
	browser,
	evaluate,
	serverAddress,
	wait,
} from "./browser-driver"

let session = "editor-find-" + Date.now()
let server = Bun.spawn(["bun", "tests/browser-document-app.ts", "--serve"], {
	stdout: "pipe",
	stderr: "inherit",
})
try {
	let url = new URL("/app", await serverAddress(server.stdout)).href
	browser(session, "set", "viewport", "1280", "800")
	browser(session, "open", url)
	wait(session, 'Boolean(document.querySelector("#editor"))')
	browser(session, "click", '[data-action="new"]')
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
	wait(session, 'document.querySelectorAll(".search-match").length === 4')
	assert(
		evaluate(
			session,
			'[...document.querySelectorAll(".search-match")].every(mark => {let rect = mark.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 && getComputedStyle(mark).backgroundColor !== "rgba(0, 0, 0, 0)"})',
		),
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
	wait(session, 'document.querySelectorAll(".search-match").length === 3')
	browser(session, "check", "#find-regex")
	browser(session, "fill", "#find-text", "[Nn]eedle")
	wait(session, 'document.querySelectorAll(".search-match").length === 4')
	browser(session, "fill", "#find-text", "[")
	wait(session, 'document.querySelectorAll(".search-match").length === 0')
	browser(session, "fill", "#find-text", "(?=needle)")
	wait(
		session,
		'document.querySelector(".find-count").textContent.includes("3") && document.querySelectorAll(".search-match").length === 0',
	)
	browser(session, "uncheck", "#find-regex")
	browser(session, "fill", "#find-text", "needle")
	wait(session, 'document.querySelectorAll(".search-match").length === 3')
	fill("needle changed needle")
	wait(
		session,
		'document.querySelector(".find-count").textContent.endsWith("of 2") && document.querySelectorAll(".search-match").length === 2',
	)
	browser(session, "click", "#find-next")
	wait(
		session,
		'document.querySelector("alkalye-editor").source.selectionStart === 0',
	)
	browser(session, "click", "#find-next")
	wait(
		session,
		'document.querySelector("alkalye-editor").source.selectionStart === 15',
	)
	browser(session, "click", "#find-next")
	wait(
		session,
		'document.querySelector("alkalye-editor").source.selectionStart === 0',
	)
	assert(
		true,
		"Editing invalidates cached matches; repeated navigation wraps through the new source",
	)
	browser(session, "click", "#close-find")
	wait(session, 'document.querySelectorAll(".search-match").length === 0')
	assert(
		true,
		"Case, regex, invalid and zero-width searches update or clear highlights",
	)

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
		'document.querySelector("#find-bar").hidden && document.querySelectorAll(".search-match").length === 0',
	)
	browser(session, "set", "viewport", "1280", "800")

	fill("first needle\n" + "ordinary line\n".repeat(3000) + "last needle")
	evaluate(
		session,
		'document.querySelector("alkalye-editor").selectRange(0, 0)',
	)
	browser(session, "press", "Control+f")
	browser(session, "fill", "#find-text", "needle")
	wait(session, 'document.querySelectorAll(".search-match").length === 1')
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
	wait(session, 'document.querySelectorAll(".search-match").length === 0')
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
