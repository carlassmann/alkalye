import {
	assert,
	browser,
	evaluate,
	serverAddress,
	wait,
} from "./browser-driver"

let source = 'document.querySelector("alkalye-editor").source'
let session = "editor-authoring-" + Date.now()
let server = Bun.spawn(["bun", "tests/browser-document-app.ts", "--serve"], {
	stdout: "pipe",
	stderr: "inherit",
})
try {
	let url = new URL("/app", await serverAddress(server.stdout)).href
	console.log(url)
	browser(session, "set", "viewport", "1280", "800")
	browser(session, "open", url)
	wait(session, "Boolean(document.querySelector('#editor'))")
	browser(session, "click", '[data-action="new"]')

	fill("/")
	wait(session, '!document.querySelector("#completion-menu").hidden')
	browser(session, "press", "ArrowDown")
	assert(
		evaluate(
			session,
			'document.querySelector("#editor").getAttribute("aria-activedescendant") === "completion-1" && document.querySelector("#completion-1").getAttribute("aria-selected") === "true"',
		),
		"Completion arrows expose the active option while keeping editor focus",
	)
	browser(session, "press", "Enter")
	expect("## ")
	fill("/quo")
	browser(session, "press", "Tab")
	expect("> ")
	assert(true, "Enter and Tab accept the chosen slash completion")
	fill("/")
	browser(session, "press", "Escape")
	assert(
		evaluate(
			session,
			'document.querySelector("#completion-menu").hidden && !document.querySelector("#editor").hasAttribute("aria-activedescendant")',
		),
		"Escape dismisses completion and removes its active descendant",
	)
	browser(session, "press", "Tab")
	assert(
		evaluate(
			session,
			'document.activeElement !== document.querySelector("#editor")',
		),
		"Escape then Tab releases editor focus",
	)

	fill("/")
	evaluate(
		session,
		'document.querySelector("#editor").dispatchEvent(new CompositionEvent("compositionstart", {bubbles: true})); true',
	)
	browser(session, "press", "Enter")
	expect("/\n")
	assert(
		evaluate(session, 'document.querySelector("#completion-menu").hidden'),
		"Composition dismisses suggestions and Enter remains native",
	)
	evaluate(
		session,
		'document.querySelector("#editor").dispatchEvent(new CompositionEvent("compositionend", {bubbles: true, data: ""})); true',
	)

	let markers: [string, number, string][] = [
		["()", 1, "Backspace"],
		["****", 2, "Backspace"],
		["~~~~", 2, "Delete"],
		["````", 2, "Backspace"],
		["====", 2, "Delete"],
	]
	for (let [text, offset, key] of markers) {
		fill(text)
		select(offset)
		browser(session, "press", key)
		expect("")
	}
	assert(
		true,
		"Deleting inside empty smart pairs and formatting markers removes both halves",
	)
	fill("**hello**")
	select(7)
	browser(session, "press", "Delete")
	expect("**hello")
	assert(true, "Forward deletion removes closing Markdown markers as a whole")

	fill("```\n****\n```")
	select(6)
	browser(session, "press", "Backspace")
	expect("```\n***\n```")
	assert(true, "Formatting marker deletion leaves fenced source literal")

	let continuations: [string, string][] = [
		["- [x] Done", "- [x] Done\n- [ ] "],
		["7) [x] Done", "7) [x] Done\n8) [ ] "],
		["> Quote", "> Quote\n> "],
		["> - Item", "> - Item\n> - "],
		["- ", ""],
		["> ", ""],
	]
	for (let [text, expected] of continuations) {
		fill(text)
		browser(session, "press", "Enter")
		expect(expected)
	}
	assert(
		true,
		"Enter continues quotes, nested lists and ordered tasks; empty items exit markup",
	)
	fill("```md\n- Literal\n```")
	select(15)
	browser(session, "press", "Enter")
	expect("```md\n- Literal\n\n```")
	fill("```md\n/hea\n```")
	select(10)
	browser(session, "press", "d")
	expect("```md\n/head\n```")
	assert(
		evaluate(session, 'document.querySelector("#completion-menu").hidden'),
		"Fenced source neither continues list markup nor opens slash completion",
	)

	fill("Plain text")
	browser(session, "press", "Tab")
	expect("Plain text")
	assert(
		evaluate(
			session,
			'document.activeElement !== document.querySelector("#editor")',
		),
		"Tab in plain prose moves focus without changing text",
	)
	fill("- Item")
	browser(session, "press", "Tab")
	expect("  - Item")
	browser(session, "press", "Shift+Tab")
	expect("- Item")
	fill("```\ncode\n```")
	select(8)
	browser(session, "press", "Tab")
	expect("```\n  code\n```")
	assert(
		true,
		"Contextual Tab indents lists and code by two spaces; Shift-Tab reverses it",
	)

	let table = "| A | B |\n| --- | --- |\n| x | y |"
	fill(table)
	select(2)
	browser(session, "press", "Tab")
	assert(
		evaluate(
			session,
			`${source}.value.slice(${source}.selectionStart, ${source}.selectionEnd) === "B"`,
		),
		"Table Tab selects the next cell",
	)
	browser(session, "press", "Tab")
	assert(
		evaluate(
			session,
			`${source}.value.slice(${source}.selectionStart, ${source}.selectionEnd) === "x"`,
		),
		"Table Tab skips the delimiter row",
	)
	browser(session, "press", "Shift+Tab")
	assert(
		evaluate(
			session,
			`${source}.value.slice(${source}.selectionStart, ${source}.selectionEnd) === "B"`,
		),
		"Table Shift-Tab selects the preceding cell",
	)
	select(table.indexOf("y"))
	browser(session, "press", "Tab")
	expect(table + "\n|  |  |")
	assert(true, "Tab at the final table cell appends a row")
	fill(table)
	select(2)
	browser(session, "press", "Enter")
	expect("| A | B |\n| --- | --- |\n|  |  |\n| x | y |")
	assert(
		true,
		"Enter in a table header adds a row without separating the header and delimiter",
	)
	fill("| `a|b` | c |\n| --- | --- |\n| x | y |")
	select(4)
	browser(session, "press", "Tab")
	assert(
		evaluate(
			session,
			`${source}.value.slice(${source}.selectionStart, ${source}.selectionEnd) === "c"`,
		),
		"Pipes inside inline code stay within one table cell",
	)

	let shortDelimiter = "| A | B |\n|-|-|\n| x | y |"
	fill(shortDelimiter)
	select(shortDelimiter.indexOf("-"))
	browser(session, "press", "Tab")
	assert(
		evaluate(
			session,
			`${source}.value.slice(${source}.selectionStart, ${source}.selectionEnd) === "x"`,
		),
		"Tab from a short GFM delimiter row stays in table navigation",
	)
	fill(shortDelimiter)
	select(2)
	browser(session, "press", "Enter")
	expect("| A | B |\n|-|-|\n|  |  |\n| x | y |")
	assert(
		true,
		"Short GFM delimiters remain adjacent to their headers when adding rows",
	)
	fill("it it\nit")
	select(1)
	browser(session, "press", "Control+Shift+l")
	browser(session, "press", "Tab")
	expect("  it it\n  it")
	browser(session, "press", "Shift+Tab")
	expect("it it\nit")
	browser(session, "press", "Tab")
	browser(session, "press", "x")
	expect("  x x\n  x")
	assert(
		true,
		"Multicursor indentation edits each line once and preserves all selected ranges",
	)
	browser(session, "press", "Escape")

	fill("- [ ] First\n- [x] Second\nUntouched [ ] text")
	select(0, "- [ ] First\n- [x] Second\n".length)
	browser(session, "click", '#tools-edit [data-action="complete"]')
	expect("- [x] First\n- [x] Second\nUntouched [ ] text")
	browser(session, "click", '#tools-edit [data-action="complete"]')
	expect("- [ ] First\n- [ ] Second\nUntouched [ ] text")
	assert(
		true,
		"Mixed task selections toggle together and exclude the following unselected line",
	)

	fill("Hello")
	select(0, 5)
	evaluate(
		session,
		'Object.defineProperty(navigator.clipboard, "readText", {configurable: true, value: async () => "https://example.org"}); true',
	)
	browser(session, "click", '#tools-edit [data-action="paste"]')
	expect("[Hello](https://example.org)")
	assert(
		true,
		"Menu paste applies the same URL-on-selection conversion as native paste",
	)

	let documentURL = evaluate(session, "location.href")
	if (typeof documentURL !== "string") throw new Error("Missing document URL")
	browser(session, "open", new URL("/app/settings?category=editor", url).href)
	wait(session, 'Boolean(document.querySelector("input[name=autoSortTasks]"))')
	browser(session, "click", "label:has(input[name=autoSortTasks])")
	wait(session, 'document.querySelector("input[name=autoSortTasks]").checked')
	browser(session, "reload")
	wait(session, 'document.querySelector("input[name=autoSortTasks]")?.checked')
	browser(session, "open", documentURL)
	wait(session, `Boolean(${source})`)
	fill("- [ ] First\n- [x] Second\n- [ ] Third")
	select(8)
	browser(session, "click", '#tools-edit [data-action="complete"]')
	expect("- [ ] Third\n- [x] First\n- [x] Second")
	assert(
		true,
		"The persisted auto-sort preference moves completed tasks below open tasks",
	)

	fill(
		"- [ ] First\n- [x] Second\n\n~~~md\n- [x] Code done\n- [ ] Code open\n~~~",
	)
	select(8)
	browser(session, "click", '#tools-edit [data-action="complete"]')
	expect(
		"- [x] First\n- [x] Second\n\n~~~md\n- [x] Code done\n- [ ] Code open\n~~~",
	)
	assert(true, "Automatic task sorting preserves source inside tilde fences")

	wait(
		session,
		'document.querySelector("#save-status").getAttribute("aria-busy") === "false"',
	)
	let saved = evaluate(session, `${source}.value`)
	browser(session, "reload")
	wait(session, `${source}?.value === ${JSON.stringify(saved)}`)
	assert(true, "Authoring edits survive durable reopening")
} finally {
	try {
		browser(session, "close")
	} finally {
		server.kill()
		await server.exited
	}
}
function fill(text: string) {
	browser(session, "fill", "#editor", text)
	expect(text)
	select(text.length)
}
function select(start: number, end = start) {
	evaluate(
		session,
		`(() => { document.querySelector("#editor").focus(); ${source}.setSelectionRange(${start}, ${end}); return true })()`,
	)
}
function expect(text: string) {
	wait(session, `${source}.value === ${JSON.stringify(text)}`)
}
