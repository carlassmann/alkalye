import {
	assert,
	browser,
	currentDocument,
	evaluate,
	wait,
} from "./browser-driver"

// Source reads go through the documented EditorElement API; #editor.value is
// the projection the native textarea shows.
let editor = 'document.querySelector("alkalye-editor").source'
let native = 'document.querySelector("#editor")'
let source = [
	"# Links",
	"Read [Example](https://example.org/a_(b)) and [[Welcome to Alkalye]].",
	"`[code](https://c.example)` ![Icon](/i.png)",
	"last",
].join("\n")
let projected = source
	.replace("[Example](https://example.org/a_(b))", "\u2003\u2060Example")
	.replace("[[Welcome to Alkalye]]", "\u2003\u2060Welcome to Alkalye")
	.replace("![Icon](/i.png)", "\u2003\u2060Icon")
let expanded = `${native}.value.includes("[Example](")`
let collapsed = `${native}.value.includes("Read \u2003\u2060Example and \u2003\u2060Welcome to Alkalye")`

let server = Bun.spawn(["bun", "tests/browser-document-app.ts", "--serve"], {
	stdout: "pipe",
	stderr: "inherit",
})
let session = "editor-prettification-" + Date.now()
try {
	let output = await server.stdout.getReader().read()
	if (!output.value) throw new Error("Missing app URL")
	let url = new URL("/app", new TextDecoder().decode(output.value).trim()).href
	console.log(url)
	browser(session, "set", "viewport", "1280", "800")
	browser(session, "open", url)
	wait(session, `Boolean(${native})`)
	browser(session, "click", '[data-action="new"]')
	browser(session, "fill", "#editor", source)
	wait(session, `${editor}.value === ${JSON.stringify(source)}`)
	wait(session, `${native}.value === ${JSON.stringify(projected)}`)
	assert(
		evaluate(
			session,
			`document.querySelector("#highlight").textContent === ${native}.value + "\\n" && [...document.querySelectorAll("#highlight .syntax-link")].map(link => link.textContent).join("|") === "\u2003\u2060Example|\u2003\u2060Welcome to Alkalye|\u2003\u2060Icon"`,
		),
		"inactive links and wiki-links collapse in the textarea and its overlay alike",
	)

	wait(
		session,
		'document.querySelector("#save-status").textContent === "Saved"',
	)
	let id = evaluate(session, currentDocument)
	browser(session, "reload")
	wait(
		session,
		`${currentDocument} === ${JSON.stringify(id)} && ${editor}?.value === ${JSON.stringify(source)}`,
	)
	assert(
		evaluate(session, collapsed),
		"saving and reopening keeps the Markdown source, not the projection",
	)

	wait(
		session,
		'document.querySelector("[data-editor-links] a[data-kind=link]")?.getAttribute("aria-label") === "Example"',
	)
	assert(
		evaluate(
			session,
			'document.querySelector("[data-editor-links] a[data-kind=link]").href === "https://example.org/a_(b)"',
		),
		"compact web links retain native anchor semantics and their destination",
	)
	evaluate(
		session,
		'document.querySelector("[data-editor]").style.setProperty("--brand", "rgb(113, 87, 217)")',
	)
	for (let kind of ["link", "wiki", "media"]) {
		browser(session, "hover", `[data-editor-links] a[data-kind="${kind}"]`)
		assert(
			evaluate(
				session,
				`(() => {
			let label = document.querySelector(".syntax-link.is-hovered .syntax-link-label");
			let anchor = document.querySelector('[data-editor-links] a[data-kind="${kind}"]');
			return label && getComputedStyle(label).textDecorationColor === "rgb(113, 87, 217)" && getComputedStyle(anchor).boxShadow === "none";
		})()`,
			),
			`${kind} hover recolors the existing underline without adding another`,
		)
	}
	browser(session, "mouse", "move", "0", "0")
	assert(
		evaluate(
			session,
			'document.querySelector(".syntax-link.is-hovered") === null',
		),
		"Leaving a link restores its underline color",
	)
	evaluate(
		session,
		'document.querySelector("[data-editor]").style.removeProperty("--brand")',
	)
	browser(session, "set", "viewport", "600", "800")
	wait(
		session,
		`(() => { let span = document.querySelector('#highlight .syntax-link'); let range = document.createRange(); range.selectNodeContents(span); let expected = range.getClientRects()[0]; let actual = document.querySelector('[data-editor-links] a[data-kind="link"]')?.getBoundingClientRect(); return actual && Math.abs(actual.left - expected.left) < 1 && Math.abs(actual.top - expected.top) < 1 && Math.abs(actual.width - expected.width) < 1 })()`,
	)
	assert(
		true,
		"compact link hit areas follow text wrapping after a viewport resize",
	)
	browser(session, "set", "viewport", "1280", "800")
	assert(
		evaluate(
			session,
			`(() => { let anchor = document.querySelector('[data-editor-links] a[data-kind="link"]'); anchor.focus(); ${native}.dispatchEvent(new Event("scroll")); return document.activeElement?.tagName === "A" && document.activeElement.href === anchor.href })()`,
		),
		"repainting compact links preserves keyboard focus",
	)
	selectSource(0)
	assert(
		evaluate(
			session,
			`(() => { let anchor = document.querySelector('[data-editor-links] a[data-kind="link"]'); let rect = anchor.getBoundingClientRect(); anchor.dispatchEvent(new PointerEvent("pointerdown", { pointerType:"mouse", shiftKey:true, bubbles:true, cancelable:true, clientX:rect.left + 3, clientY:rect.top + 3 })); let cancelled = !anchor.dispatchEvent(new MouseEvent("click", { shiftKey:true, bubbles:true, cancelable:true })); return cancelled && ${editor}.selectionStart === 0 && ${editor}.selectionEnd > 0 })()`,
		),
		"Shift-click extends source selection without opening the link",
	)
	selectSource(source.length)
	wait(session, collapsed)
	assert(
		evaluate(
			session,
			`(() => { let offset = ${native}.value.indexOf("Welcome to Alkalye") + 3; ${native}.setSelectionRange(offset, offset); return ${editor}.selectionStart === ${editor}.selectionEnd })()`,
		),
		"a caret in a resolved wiki label stays empty in source coordinates",
	)
	selectSource(source.length)
	wait(session, collapsed)
	evaluate(
		session,
		`(() => { let link = document.querySelector('[data-editor-links] a[data-kind="link"]'); let bounds = link.getBoundingClientRect(); link.dispatchEvent(new MouseEvent('contextmenu', { bubbles:true, cancelable:true, clientX:bounds.left + 2, clientY:bounds.top + 2 })) })()`,
	)
	wait(
		session,
		`[...document.querySelectorAll('[role="menuitem"]')].some(item => item.checkVisibility() && item.textContent.includes("Copy link"))`,
	)
	assert(true, "compact links retain the editor context menu")
	browser(session, "press", "Escape")
	selectSource(source.length)
	wait(session, collapsed)
	browser(session, "click", '[data-editor-links] a[data-kind="wiki"]')
	wait(session, `${currentDocument} !== ${JSON.stringify(id)}`)
	assert(true, "clicking a compact wiki-link opens its document")
	browser(session, "back")
	wait(
		session,
		`${currentDocument} === ${JSON.stringify(id)} && ${editor}?.value === ${JSON.stringify(source)}`,
	)

	let destination = source.indexOf("example.org")
	evaluate(
		session,
		`${native}.focus(); ${editor}.setSelectionRange(${destination}, ${destination + 11})`,
	)
	assert(
		evaluate(
			session,
			`${expanded} && ${editor}.value.slice(${editor}.selectionStart, ${editor}.selectionEnd) === "example.org" && ${native}.value.slice(${native}.selectionStart, ${native}.selectionEnd) === "example.org"`,
		),
		"source selections inside hidden destinations reveal the link",
	)

	let last = source.indexOf("last")
	selectSource(last)
	wait(session, collapsed)
	browser(session, "press", "ArrowUp")
	browser(session, "press", "ArrowUp")
	assert(
		evaluate(session, collapsed),
		"links stay compact when the cursor is elsewhere on their line",
	)
	selectSource(source.indexOf("[Example]") - 1)
	browser(session, "press", "ArrowRight")
	browser(session, "press", "ArrowRight")
	wait(session, expanded)
	assert(
		evaluate(
			session,
			`${editor}.selectionStart >= ${source.indexOf("Read")} && ${editor}.selectionStart < ${source.indexOf("\n`")}`,
		),
		"moving the caret into a link shows its Markdown",
	)
	selectSource(source.indexOf(" and ") + 1)
	wait(session, collapsed)
	assert(true, "leaving the link collapses it on the same line")

	selectSource(source.length)
	browser(session, "keyboard", "type", " more")
	wait(session, `${editor}.value === ${JSON.stringify(source + " more")}`)
	assert(
		evaluate(session, collapsed),
		"typing elsewhere edits the source while links stay collapsed",
	)
	undoUntil(source)
	assert(evaluate(session, collapsed), "undo restores the exact source")

	let lineEnd = source.indexOf("\n`")
	selectSource(lineEnd)
	browser(session, "keyboard", "type", "!")
	wait(session, `${editor}.value.includes("[[Welcome to Alkalye]].!")`)
	browser(session, "press", "ArrowDown")
	wait(
		session,
		`${native}.value.includes("Read \u2003\u2060Example and \u2003\u2060Welcome to Alkalye.!")`,
	)
	assert(true, "edits on a raw link line are kept when it collapses")
	undoUntil(source)

	selectSource(last)
	wait(session, collapsed)
	evaluate(
		session,
		`${native}.dispatchEvent(new CompositionEvent("compositionstart", {bubbles: true})); ${native}.setSelectionRange(${native}.value.indexOf("Example") + 2, ${native}.value.indexOf("Example") + 2)`,
	)
	browser(session, "wait", "300")
	assert(
		evaluate(session, collapsed),
		"composition keeps the textarea unchanged",
	)
	evaluate(
		session,
		`${native}.dispatchEvent(new CompositionEvent("compositionend", {bubbles: true, data: ""}))`,
	)
	wait(session, expanded)
	assert(
		evaluate(
			session,
			`${editor}.selectionStart === ${source.indexOf("Example") + 2}`,
		),
		"composition end reprojects around the caret's source offset",
	)

	selectSource(last)
	evaluate(
		session,
		`{
		${native}.dispatchEvent(new CompositionEvent("compositionstart", {bubbles:true}));
		let from = ${native}.value.indexOf("last");
		${native}.setRangeText("日本語", from, from + 4, "end");
		${native}.dispatchEvent(new CompositionEvent("compositionend", {bubbles:true, data:"日本語"}));
	}`,
	)
	wait(
		session,
		`${editor}.value === ${JSON.stringify(source.replace("last", "日本語"))}`,
	)
	assert(
		true,
		"composition end accepts final native text before the final input event",
	)
	undoUntil(source)

	selectSource(last)
	wait(session, collapsed)
	evaluate(
		session,
		`${native}.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true})); ${native}.setSelectionRange(0, ${native}.value.indexOf("last"))`,
	)
	browser(session, "wait", "300")
	assert(evaluate(session, collapsed), "a pointer drag keeps the text under it")
	assert(
		evaluate(
			session,
			`(() => { let clipboardData = new DataTransfer(); let event = new ClipboardEvent("copy", {bubbles: true, cancelable: true, clipboardData}); ${native}.dispatchEvent(event); return event.defaultPrevented && clipboardData.getData("text/plain") === ${JSON.stringify(source.slice(0, last))} })()`,
		),
		"copying collapsed text puts its Markdown source on the clipboard",
	)
	evaluate(session, `dispatchEvent(new PointerEvent("pointerup"))`)
	wait(session, `${native}.value === ${JSON.stringify(source)}`)
	assert(
		evaluate(
			session,
			`${editor}.selectionStart === 0 && ${editor}.selectionEnd === ${last}`,
		),
		"releasing the pointer expands the selected lines and keeps the selection",
	)

	selectSource(last)
	wait(session, collapsed)
	evaluate(
		session,
		`${native}.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true})); ${native}.setSelectionRange(${native}.value.indexOf("Read"), ${native}.value.indexOf("last"))`,
	)
	evaluate(
		session,
		`${native}.dispatchEvent(new ClipboardEvent("cut", {bubbles: true, cancelable: true, clipboardData: new DataTransfer()}))`,
	)
	wait(
		session,
		`${editor}.value === ${JSON.stringify(source.slice(0, source.indexOf("Read")) + "last")}`,
	)
	evaluate(session, `dispatchEvent(new PointerEvent("pointerup"))`)
	assert(true, "cutting collapsed text removes its whole Markdown source")
	undoUntil(source)

	selectSource(last)
	wait(session, collapsed)
	browser(session, "press", "Control+Alt+ArrowUp")
	wait(session, `${native}.value === ${JSON.stringify(source)}`)
	assert(true, "multiple selections show raw Markdown")
	browser(session, "press", "Escape")
	wait(session, collapsed)
	assert(true, "clearing extra selections collapses links again")

	evaluate(
		session,
		`${native}.focus(); ${editor}.setSelectionRange(${source.indexOf("example.org")}, ${source.indexOf("example.org") + 7})`,
	)
	browser(session, "press", "Control+Shift+l")
	wait(session, `${native}.value === ${JSON.stringify(source)}`)
	assert(
		evaluate(
			session,
			`document.querySelector("#highlight").textContent === ${native}.value + "\\n"`,
		),
		"select-all-occurrences switches both the native textarea and overlay to source",
	)
	browser(session, "press", "Escape")
	selectSource(last)
	browser(session, "press", "Control+f")
	wait(session, "Boolean(document.querySelector('#find-text'))")
	browser(session, "fill", "#find-text", "example.org")
	browser(session, "click", "#find-next")
	wait(
		session,
		`${expanded} && ${editor}.value.slice(${editor}.selectionStart, ${editor}.selectionEnd) === "example.org"`,
	)
	assert(true, "find matches text inside hidden link destinations")
	browser(session, "click", '[data-find-action="toggle-replace"]')
	browser(session, "fill", "#replace-text", "example.com")
	browser(session, "click", "#replace-one")
	wait(
		session,
		`${editor}.value.includes("[Example](https://example.com/a_(b))")`,
	)
	assert(true, "replace edits the source of a link")
	browser(session, "click", "#close-find")
	undoUntil(source)

	selectSource(source.indexOf("Read"))
	wait(
		session,
		'Boolean(document.querySelector("[data-line-actions] [aria-label^=\\"Open document\\"]"))',
	)
	assert(true, "line actions read the source of the current line")

	selectSource(last)
	wait(session, collapsed)
	browser(session, "tab", "new", "--label", "peer", url + "/doc/" + id)
	wait(session, `${editor}?.value === ${JSON.stringify(source)}`)
	evaluate(session, `${native}.focus(); ${editor}.setSelectionRange(0, 0)`)
	browser(session, "keyboard", "type", "Top ")
	wait(
		session,
		'document.querySelector("#save-status").textContent === "Saved"',
	)
	browser(session, "tab", "t1")
	wait(session, `${editor}.value === ${JSON.stringify("Top " + source)}`)
	assert(
		evaluate(
			session,
			`${editor}.selectionStart === ${last + 4} && ${collapsed}`,
		),
		"remote edits keep the local source selection and collapsed links",
	)
	let long =
		Array.from(
			{ length: 30 },
			(_, index) =>
				`[link ${index}](https://example.org/${"long/".repeat(10)})`,
		).join("\n") +
		"\n# Jump here\n" +
		"tail\n".repeat(100)
	browser(session, "fill", "#editor", long)
	wait(session, `${editor}.value === ${JSON.stringify(long)}`)
	let heading = long.indexOf("# Jump here")
	evaluate(
		session,
		`document.querySelector("alkalye-editor").selectRange(${heading})`,
	)
	assert(
		evaluate(
			session,
			`(() => { let walker = document.createTreeWalker(document.querySelector("#highlight"), NodeFilter.SHOW_TEXT), offset = ${native}.selectionStart, node; while(node = walker.nextNode()){ if(offset < node.textContent.length) break; offset -= node.textContent.length } let range = document.createRange(); range.setStart(node, offset); range.collapse(true); let rect = range.getBoundingClientRect(), viewport = ${native}.getBoundingClientRect(); return ${editor}.selectionStart === ${heading} && rect.top >= viewport.top && rect.bottom <= viewport.bottom })()`,
		),
		"source navigation scrolls to its projected position below many compact links",
	)
	let wrapped =
		"# Icons\nA long line just before [" +
		"wrapped label ".repeat(12) +
		"](https://example.org)\n![Photo](./photo.png)\ntail"
	browser(session, "set", "viewport", "1280", "800")
	for (let [panel, action] of [
		["library-open", "library"],
		["tools-open", "toggle-tools"],
	])
		if (
			evaluate(
				session,
				`document.querySelector("#app").classList.contains(${JSON.stringify(panel)})`,
			)
		)
			browser(session, "click", `[data-action="${action}"]`)
	browser(session, "set", "viewport", "390", "844")
	browser(session, "fill", "#editor", wrapped)
	evaluate(
		session,
		'document.documentElement.style.setProperty("--editor-size", "12px")',
	)
	wait(
		session,
		'document.querySelectorAll("#highlight .syntax-link-icon").length === 2',
	)
	assert(
		evaluate(
			session,
			`(() => { let icons = [...document.querySelectorAll(".syntax-link-icon")]; return icons.every(icon => icon.querySelector("svg").getBoundingClientRect().width <= icon.getBoundingClientRect().width) && ${native}.scrollHeight === document.querySelector("#highlight").scrollHeight && document.querySelector("#highlight").textContent === ${native}.value + "\\n" })()`,
		),
		"Small mobile text reserves icon space while wrapping stays aligned with the textarea",
	)
	browser(session, "fill", "#editor", "# Missing\n[[missing]]\ntail")
	wait(session, 'document.querySelector(".syntax-link-broken") !== null')
	assert(
		evaluate(
			session,
			'!document.querySelector("[data-editor-links] a[data-kind=wiki]")',
		),
		"A broken document link cannot navigate to a missing document",
	)
	evaluate(
		session,
		`${editor}.setSelectionRange(0,0); ${native}.scrollTop = 0; ${native}.dispatchEvent(new Event("scroll"))`,
	)
	let broken = evaluate(
		session,
		'JSON.stringify((() => {let bounds = document.querySelector(".syntax-link-broken").getBoundingClientRect(); return [bounds.left + bounds.width / 2, bounds.top + bounds.height / 2]})())',
	)
	if (typeof broken !== "string") throw new Error("Missing broken-link bounds")
	let [x, y] = JSON.parse(broken)
	browser(
		session,
		"mouse",
		"move",
		String(Math.round(x)),
		String(Math.round(y)),
	)
	browser(session, "mouse", "down")
	browser(session, "mouse", "up")
	wait(session, `${native}.value.includes("[[missing]]")`)
	assert(
		true,
		"Clicking a broken document label reveals its source for editing",
	)
	let unicode = "Intro\n[日本語😀](https://example.org) end\ntail"
	for (let prefix of [0, 1]) {
		browser(session, "fill", "#editor", unicode)
		wait(session, `${editor}.value === ${JSON.stringify(unicode)}`)
		assert(
			evaluate(
				session,
				`(() => {
		 let start = ${JSON.stringify(unicode)}.indexOf("日本語")
		 for (let offset = 0; offset <= "日本語😀".length; offset++) {
		  ${editor}.setSelectionRange(start + offset, start + offset)
		  if (${editor}.selectionStart !== start + offset || ${editor}.selectionEnd !== start + offset) return false
		 }
		 return ${editor}.value === ${JSON.stringify(unicode)}
		})()`,
			),
			"Unicode caret round-trips through the editor's source API",
		)
		selectSource(unicode.length)
		wait(session, `${native}.value.includes("\u2003\u2060日本語😀")`)
		evaluate(
			session,
			`(() => {
		 let input = ${native}, start = input.value.indexOf("\u2003\u2060") + ${prefix}
		 input.setRangeText("", start, start + 1, "end")
		 input.dispatchEvent(new InputEvent("input", {bubbles: true, inputType: "deleteContentBackward"}))
		})()`,
		)
		wait(
			session,
			`${editor}.value === "Intro\\n end\\ntail" && document.querySelector("#save-status").getAttribute("aria-busy") === "false"`,
		)
		browser(session, "reload")
		wait(session, `${editor}.value === "Intro\\n end\\ntail"`)
		assert(
			true,
			"Deleting synthetic icon space preserves valid source across a durable reload",
		)
	}
} finally {
	try {
		browser(session, "close")
	} finally {
		server.kill()
		await server.exited
	}
}

function selectSource(offset: number) {
	evaluate(
		session,
		`(() => { ${native}.focus(); ${editor}.setSelectionRange(${offset}, ${offset}); return true })()`,
	)
}
function undoUntil(expected: string) {
	for (let attempt = 0; attempt < 10; attempt++) {
		if (evaluate(session, `${editor}.value === ${JSON.stringify(expected)}`))
			return
		browser(session, "press", "Control+z")
		browser(session, "wait", "100")
	}
	wait(session, `${editor}.value === ${JSON.stringify(expected)}`)
}
