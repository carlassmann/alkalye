import {
	assert,
	browser,
	evaluate,
	serverAddress,
	wait,
} from "./browser-driver"

let session = "editor-selection-" + Date.now()
let server = Bun.spawn(["bun", "tests/browser-document-app.ts", "--serve"], {
	stdout: "pipe",
	stderr: "inherit",
})
let source = 'document.querySelector("alkalye-editor").source'
try {
	let url = new URL("/app", await serverAddress(server.stdout)).href
	browser(session, "set", "viewport", "1280", "800")
	browser(session, "open", url)
	wait(session, 'Boolean(document.querySelector("#editor"))')
	browser(session, "click", '[data-action="new"]')
	let expand = evaluate(session, "/Mac/i.test(navigator.platform)")
		? "Control+Alt+Shift+ArrowRight"
		: "Alt+Shift+ArrowRight"
	let shrink = expand.replace("ArrowRight", "ArrowLeft")
	let examples: [string, number, string[]][] = [
		["[a*b](u*v)\n\nnext", 3, ["b", "[a*b](u*v)", "[a*b](u*v)\n\nnext"]],
		[
			"intro words\n```\ncode\n```\nafter",
			2,
			["intro", "intro words", "intro words\n```\ncode\n```\nafter"],
		],
		[
			"***bold word*** here\n\nnext",
			5,
			[
				"bold",
				"**bold word**",
				"***bold word***",
				"***bold word*** here",
				"***bold word*** here\n\nnext",
			],
		],
		[
			"first **multi\nline** last\n\nnext",
			10,
			[
				"multi",
				"**multi\nline**",
				"first **multi\nline** last",
				"first **multi\nline** last\n\nnext",
			],
		],
		[
			"A **bold word** here\n\nnext",
			8,
			[
				"bold",
				"**bold word**",
				"A **bold word** here",
				"A **bold word** here\n\nnext",
			],
		],
		[
			"A _italic **bold** word_ here\n\nnext",
			14,
			[
				"bold",
				"**bold**",
				"_italic **bold** word_",
				"A _italic **bold** word_ here",
				"A _italic **bold** word_ here\n\nnext",
			],
		],
		[
			"[hello world](https://example.com)\n\nnext",
			4,
			[
				"hello",
				"[hello world](https://example.com)",
				"[hello world](https://example.com)\n\nnext",
			],
		],
		[
			"- first word\n- second word\n\nnext",
			5,
			[
				"first",
				"first word",
				"- first word",
				"- first word\n- second word",
				"- first word\n- second word\n\nnext",
			],
		],
		[
			"```ts\nlet foo = 1\n```\n\nnext",
			12,
			[
				"foo",
				"let foo = 1",
				"```ts\nlet foo = 1\n```",
				"```ts\nlet foo = 1\n```\n\nnext",
			],
		],
		[
			"## Heading words\n\nbody",
			7,
			["Heading", "## Heading words", "## Heading words\n\nbody"],
		],
	]
	for (let [text, cursor, steps] of examples) {
		fill(text)
		select(cursor)
		for (let selected of steps) {
			browser(session, "press", expand)
			expectSelection(selected)
		}
		for (let selected of steps.slice(0, -1).reverse()) {
			browser(session, "press", shrink)
			expectSelection(selected)
		}
		browser(session, "press", shrink)
		assert(
			evaluate(
				session,
				`${source}.selectionStart === ${cursor} && ${source}.selectionEnd === ${cursor}`,
			),
			"Shrink restores initial caret",
		)
		assert(
			evaluate(session, `${source}.value === ${JSON.stringify(text)}`),
			"Structural selection preserves document source",
		)
	}
	assert(
		true,
		"Native expand/shrink follows original word, nested markup, links, list, heading and fenced-code boundaries",
	)

	fill("A **bold word** here\n\nnext")
	select(8, 4, "backward")
	browser(session, "press", expand)
	expectSelection("**bold word**")
	browser(session, "press", shrink)
	assert(
		evaluate(session, `${source}.selectionDirection === "backward"`),
		"Shrink preserves backward selection direction",
	)
	browser(session, "press", expand)
	select(0)
	browser(session, "press", shrink)
	expectSelection("")
	assert(
		evaluate(session, `${source}.selectionStart === 0`),
		"Moving the caret invalidates expansion history",
	)

	fill("it **it**\n\nlast")
	select(0, 2)
	browser(session, "press", "Control+d")
	browser(session, "press", expand)
	expectSelection("it **it**")
	browser(session, "press", expand)
	expectSelection("it **it**\n\nlast")
	browser(session, "press", shrink)
	browser(session, "press", shrink)
	browser(session, "press", "ArrowRight")
	browser(session, "press", "x")
	wait(session, `${source}.value === "itx **itx**\\n\\nlast"`)
	assert(
		true,
		"Merged expansion ranges shrink back to all cursors, which remain independently editable",
	)

	fill("hello\nworld\nlast")
	select(7)
	let selectLine = evaluate(
		session,
		'/Mac/i.test(navigator.platform) && matchMedia("(display-mode: standalone)").matches',
	)
		? "Meta+l"
		: "Control+l"
	browser(session, "press", selectLine)
	expectSelection("world\n")
	assert(true, "Platform select-line shortcut includes trailing newline")
	select(14)
	browser(session, "press", selectLine)
	expectSelection("last")

	fill("**it****it**\n\nlast")
	select(2, 4)
	browser(session, "press", "Control+d")
	browser(session, "press", expand)
	browser(session, "press", "x")
	wait(session, `${source}.value === ${JSON.stringify("xx\n\nlast")}`)
	assert(
		true,
		"Touching structural ranges remain independently editable like the original",
	)

	fill("it it\nlast")
	select(0, 2)
	browser(session, "press", "Control+d")
	browser(session, "press", selectLine)
	expectSelection("it it\n")
	browser(session, "press", "x")
	wait(session, `${source}.value === "xlast"`)
	assert(
		true,
		"Selecting a shared line merges cursor ranges before replacing the line once",
	)
	fill("\nlast")
	select(0)
	browser(session, "press", selectLine)
	expectSelection("\n")
	assert(true, "Select-line includes an empty first line")
	fill(Array.from({ length: 40 }, () => "visible word").join("\n"))
	select(12 * 13 + 2)
	evaluate(session, 'document.querySelector("#editor").scrollTop = 0; true')
	browser(session, "press", expand)
	expectSelection("visible")
	assert(
		evaluate(session, 'document.querySelector("#editor").scrollTop === 0'),
		"Expanding a visible word preserves the scroll position",
	)
	browser(session, "press", "x")
	let cursor = evaluate(session, `${source}.selectionStart`)
	browser(session, "press", shrink)
	assert(
		evaluate(
			session,
			`${source}.selectionStart === ${cursor} && ${source}.selectionEnd === ${cursor}`,
		),
		"Typing invalidates expansion history",
	)
	fill("before\n\nfirst\n\nsecond\n\nafter")
	select(10, 19)
	browser(session, "press", expand)
	expectSelection("first\n\nsecond")
	assert(
		true,
		"A cross-paragraph selection expands to its enclosing paragraphs before the document",
	)

	fill("==你好 世界==\n\nnext")
	select(3)
	browser(session, "press", expand)
	expectSelection("你好")
	browser(session, "press", expand)
	expectSelection("==你好 世界==")
	assert(
		true,
		"Unicode word expansion uses native segmentation and enclosing highlight syntax",
	)
	wait(
		session,
		'document.querySelector("#save-status").getAttribute("aria-busy") === "false" && document.querySelector("#save-status").dataset.pending === "0"',
	)
	browser(session, "reload")
	wait(session, `${source}?.value === "==你好 世界==\\n\\nnext"`)
	assert(
		true,
		"Selection commands leave persisted document unchanged on reopen",
	)
} finally {
	try {
		browser(session, "close")
	} finally {
		server.kill()
		await server.exited
	}
}
function fill(text: string) {
	browser(session, "press", "Escape")
	browser(session, "fill", "#editor", text)
	wait(session, `${source}.value === ${JSON.stringify(text)}`)
}
function select(start: number, end = start, direction = "forward") {
	evaluate(
		session,
		`document.querySelector("#editor").focus(); ${source}.setSelectionRange(${Math.min(start, end)}, ${Math.max(start, end)}, ${JSON.stringify(direction)}); true`,
	)
}
function expectSelection(text: string) {
	wait(
		session,
		`${source}.value.slice(${source}.selectionStart, ${source}.selectionEnd) === ${JSON.stringify(text)}`,
	)
}
