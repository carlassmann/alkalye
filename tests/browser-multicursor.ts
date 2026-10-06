import {
	assert,
	browser,
	evaluate,
	wait,
	serverAddress,
} from "./browser-driver"

let editor = 'document.querySelector("alkalye-editor").source'
let native = 'document.querySelector("#editor")'
let server = Bun.spawn(["bun", "tests/browser-document-app.ts", "--serve"], {
	stdout: "pipe",
	stderr: "inherit",
})
let session = "multicursor-" + Date.now()
try {
	let url = new URL("/app", await serverAddress(server.stdout)).href
	console.log(url)
	browser(session, "set", "viewport", "1280", "800")
	browser(session, "open", url)
	wait(session, `Boolean(${native})`)
	browser(session, "click", '[data-action="new"]')

	browser(session, "fill", "#editor", "it it it it")
	wait(
		session,
		`${editor}.value === "it it it it" && document.querySelector("#save-status").getAttribute("aria-busy") === "false"`,
	)
	selectSource(4)
	browser(session, "press", "Control+d")
	for (let index = 0; index < 3; index++) browser(session, "press", "Control+d")
	wait(session, 'document.querySelectorAll("#highlight mark").length === 3')
	assert(
		evaluate(
			session,
			`${editor}.selectionStart === 3 && ${editor}.selectionEnd === 5 && [...document.querySelectorAll("#highlight mark")].every(mark => mark.textContent === "it")`,
		),
		"Next occurrence wraps before the first selection without changing the primary range",
	)
	browser(session, "press", "Control+d")
	assert(
		evaluate(
			session,
			'document.querySelectorAll("#highlight mark").length === 3',
		),
		"Cycling selected matches never duplicates a selection",
	)
	browser(session, "press", "ArrowRight")
	wait(
		session,
		'document.querySelectorAll("#highlight .local-caret").length === 3',
	)
	browser(session, "press", "x")
	wait(session, `${editor}.value === "itx itx itx itx"`)
	assert(
		evaluate(
			session,
			`${editor}.selectionStart === 7 && ${editor}.selectionEnd === 7`,
		),
		"Appending at every cursor preserves the second occurrence as primary",
	)
	browser(session, "press", "y")
	wait(
		session,
		`${editor}.value === "itxy itxy itxy itxy" && document.querySelector("#save-status").getAttribute("aria-busy") === "false"`,
	)
	browser(session, "press", "Escape")
	browser(session, "press", "Control+z")
	undoUntil("it it it it")
	browser(session, "press", "Control+Shift+z")
	wait(session, `${editor}.value !== "it it it it"`)
	wait(
		session,
		'document.querySelector("#save-status").getAttribute("aria-busy") === "false"',
	)
	let multiSaved = evaluate(session, `${editor}.value`)
	browser(session, "reload")
	wait(session, `${editor}.value === ${JSON.stringify(multiSaved)}`)
	assert(
		true,
		"Multicursor edits participate in the journal and survive durable reopening",
	)

	browser(session, "fill", "#editor", "😀it 😀it")
	wait(session, `${editor}.value === "😀it 😀it"`)
	selectSource(4)
	browser(session, "press", "Control+Shift+l")
	browser(session, "press", "ArrowLeft")
	browser(session, "press", "Backspace")
	wait(session, `${editor}.value === "it it"`)
	assert(
		true,
		"Moving and deleting at multiple cursors keeps Unicode graphemes intact",
	)
	browser(session, "press", "Escape")
	selectSource(1)
	browser(session, "press", "Control+Shift+l")
	browser(session, "press", "x")
	browser(session, "press", "y")
	wait(session, `${editor}.value === "xy xy"`)
	assert(
		true,
		"Replacing all matches leaves cursors ready for subsequent typing",
	)
	browser(session, "press", "End")
	for (let index = 0; index < 5; index++)
		browser(session, "press", "ArrowRight")
	browser(session, "press", "z")
	wait(session, `${editor}.value === "xy xyz"`)
	assert(
		true,
		"Cursors meeting at the end merge instead of inserting duplicate characters",
	)

	browser(session, "press", "Escape")
	browser(session, "fill", "#editor", "it A\nit B")
	wait(session, `${editor}.value === ${JSON.stringify("it A\nit B")}`)
	selectSource(1)
	browser(session, "press", "Control+Shift+l")
	browser(session, "press", "ArrowRight")
	browser(session, "press", "Shift+ArrowLeft")
	browser(session, "press", "x")
	wait(session, `${editor}.value === ${JSON.stringify("ix A\nix B")}`)
	browser(session, "press", "Home")
	browser(session, "press", "p")
	wait(session, `${editor}.value === ${JSON.stringify("pix A\npix B")}`)
	browser(session, "press", "End")
	browser(session, "press", "s")
	wait(session, `${editor}.value === ${JSON.stringify("pix As\npix Bs")}`)
	assert(true, "Selection extension and line navigation apply to every cursor")
	browser(session, "press", "ArrowUp")
	browser(session, "press", "v")
	wait(session, `${editor}.value === ${JSON.stringify("vpix Asv\npix Bs")}`)
	assert(true, "Moving above the first visual line reaches the document start")
	browser(session, "press", "Escape")
	selectSource(1)
	browser(session, "press", "Control+d")
	browser(session, "press", "Control+d")
	browser(session, "click", "#editor")
	assert(
		evaluate(
			session,
			'document.querySelectorAll("#highlight mark").length === 0',
		),
		"Clicking the editor clears secondary selections",
	)
	browser(session, "fill", "#editor", "one it\none it")
	wait(session, `${editor}.value === ${JSON.stringify("one it\none it")}`)
	selectSource(5)
	browser(session, "press", "Control+Shift+l")
	browser(session, "press", "ArrowRight")
	browser(session, "press", "Control+Shift+ArrowLeft")
	browser(session, "press", "x")
	wait(session, `${editor}.value === ${JSON.stringify("one x\none x")}`)
	browser(session, "press", "Meta+ArrowLeft")
	browser(session, "press", "p")
	wait(session, `${editor}.value === ${JSON.stringify("pone x\npone x")}`)
	browser(session, "press", "Control+End")
	browser(session, "press", "z")
	wait(session, `${editor}.value === ${JSON.stringify("pone x\npone xz")}`)
	assert(
		true,
		"Word, line and document modifier navigation moves all cursors and merges duplicates",
	)
	browser(session, "press", "Escape")
	browser(session, "fill", "#editor", "it it")
	wait(session, `${editor}.value === "it it"`)
	selectSource(1)
	browser(session, "press", "Control+Shift+l")
	browser(session, "press", "ArrowRight")
	browser(session, "press", "Meta+Shift+ArrowLeft")
	browser(session, "press", "x")
	wait(session, `${editor}.value === "x"`)
	assert(
		true,
		"Overlapping selections merge before typing instead of corrupting text",
	)
	for (let { source, key } of [
		{
			source:
				"abcd it " + "word ".repeat(200) + "\nabcd it " + "word ".repeat(200),
			key: "ArrowDown",
		},
		{
			source:
				"abcd it abcdefghijk\nx\nabcdefghijk\n\nabcd it abcdefghijk\nx\nabcdefghijk",
			key: "ArrowDown",
		},
		{ source: "\nabcd it\n\nabcd it", key: "ArrowUp" },
	]) {
		browser(session, "press", "Escape")
		browser(session, "fill", "#editor", source)
		wait(session, `${editor}.value === ${JSON.stringify(source)}`)
		let first = source.indexOf("it") + 2,
			second = source.lastIndexOf("it") + 2
		let expected: number[] = []
		for (let offset of [first, second]) {
			selectSource(offset)
			browser(session, "press", key)
			browser(session, "press", key)
			let destination = evaluate(session, `${editor}.selectionStart`)
			if (typeof destination !== "number")
				throw new Error("Missing native caret offset")
			expected.push(destination)
		}
		selectSource(first - 1)
		browser(session, "press", "Control+Shift+l")
		browser(session, "press", "ArrowRight")
		browser(session, "press", key)
		browser(session, "press", key)
		assert(
			evaluate(
				session,
				`(() => {
			let positions = [${editor}.selectionStart];
			for (let mark of document.querySelectorAll("#highlight .local-caret")) {
				let range = document.createRange(); range.setStart(document.querySelector("#highlight"), 0); range.setEndBefore(mark); positions.push(range.toString().length);
			}
			return JSON.stringify(positions.sort((a,b)=>a-b)) === ${JSON.stringify(JSON.stringify(expected.sort((a, b) => a - b)))};
		})()`,
			),
			"Multicursor wrapping and sticky columns match native textarea navigation",
		)
	}
	browser(session, "press", "Escape")
	let many = "😀it line\n".repeat(512)
	browser(session, "fill", "#editor", many)
	wait(session, `${editor}.value === ${JSON.stringify(many)}`)
	selectSource(many.indexOf("it") + 1)
	browser(session, "press", "Control+Shift+l")
	browser(session, "press", "ArrowRight")
	browser(session, "keyboard", "inserttext", "!")
	wait(
		session,
		`${editor}.value === ${JSON.stringify(many.replaceAll("it", "it!"))}`,
	)
	browser(session, "keyboard", "inserttext", "?")
	browser(session, "press", "Backspace")
	wait(
		session,
		`${editor}.value === ${JSON.stringify(many.replaceAll("it", "it!"))} && document.querySelector("#save-status").getAttribute("aria-busy") === "false"`,
	)
	browser(session, "press", "Escape")
	browser(session, "reload")
	wait(
		session,
		`${editor}.value === ${JSON.stringify(many.replaceAll("it", "it!"))}`,
	)
	assert(
		true,
		"Repeated typing and deletion at 512 Unicode cursors persists every edit",
	)
	browser(session, "fill", "#editor", "e\u0301it\ne\u0301it")
	wait(session, `${editor}.value === "e\\u0301it\\ne\\u0301it"`)
	evaluate(
		session,
		`(() => { ${native}.focus(); ${editor}.setSelectionRange(2,4); return true })()`,
	)
	browser(session, "press", "Control+Shift+l")
	browser(session, "press", "ArrowLeft")
	browser(session, "press", "ArrowLeft")
	browser(session, "press", "ArrowRight")
	browser(session, "press", "Backspace")
	wait(session, `${editor}.value === "it\\nit"`)
	assert(
		true,
		"Multicursor arrows and deletion treat combining marks as one grapheme",
	)
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
	}
	wait(session, `${editor}.value === ${JSON.stringify(expected)}`)
}
