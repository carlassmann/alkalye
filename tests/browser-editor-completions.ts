import {
	assert,
	browser,
	evaluate,
	serverAddress,
	wait,
} from "./browser-driver"

let source = 'document.querySelector("alkalye-editor").source'
let session = "editor-completions-" + Date.now()
let server = Bun.spawn(["bun", "tests/browser-document-app.ts", "--serve"], {
	stdout: "pipe",
	stderr: "inherit",
})
try {
	let url = new URL("/app", await serverAddress(server.stdout)).href
	browser(session, "open", url)
	wait(session, 'Boolean(document.querySelector("#editor"))')
	browser(session, "click", '[data-action="new"]')
	fill("```py")
	wait(session, '!document.querySelector("#completion-menu").hidden')
	assert(
		evaluate(
			session,
			'document.querySelector("#completion-menu").textContent.includes("Python")',
		),
		"Code-fence suggestions use the original language labels and details",
	)
	browser(session, "press", "Enter")
	expect("```python")
	assert(true, "Enter accepts a language without replacing the fence")
	assert(
		evaluate(
			session,
			'!document.querySelector("#editor").hasAttribute("aria-activedescendant")',
		),
		"Accepted completions release their active descendant",
	)
	for (let [query, language] of [
		["ts", "ts"],
		["sql", "sql"],
		["sh", "bash"],
	]) {
		fill("```" + query)
		browser(session, "press", "Enter")
		expect("```" + language)
	}
	assert(
		true,
		"Exact and prefix language matches rank ahead of substring matches",
	)
	fill("~~~ru")
	browser(session, "press", "Tab")
	expect("~~~rust")
	assert(true, "Tilde fences accept language completion with Tab")
	fill("```")
	assert(
		evaluate(session, 'document.querySelector("#completion-menu").hidden'),
		"Empty fence suggestions wait for an explicit request",
	)
	browser(session, "press", "Control+Space")
	wait(
		session,
		'document.querySelectorAll("#completion-menu [role=option]").length === 143',
	)
	browser(session, "press", "ArrowUp")
	let last = evaluate(
		session,
		'document.querySelector("#completion-menu [aria-selected=true]").textContent.trim()',
	)
	assert(
		typeof last === "string" && last.length > 0,
		"Language navigation wraps through the complete catalog",
	)
	browser(session, "press", "Escape")
	fill("```cpp")
	browser(session, "press", "Enter")
	expect("```cpp")
	fill("")
	browser(session, "press", "Control+Alt+c")
	expect("```cpp\n\n```")
	assert(true, "New code blocks reuse the last chosen language")
	fill("```ts\nconst value = 1\n```")
	select(20)
	browser(session, "press", "Control+Space")
	assert(
		evaluate(session, 'document.querySelector("#completion-menu").hidden'),
		"Code bodies do not offer prose or language suggestions",
	)
	fill(
		"---\ntitle: Link target\npath: Projects/Notes\ntags: [syntax]\n---\nBody",
	)
	wait(
		session,
		'document.querySelector("#save-status").getAttribute("aria-busy") === "false" && document.querySelector("#save-status").dataset.pending === "0"',
	)
	let target = evaluate(session, 'location.pathname.split("/").at(-1)')
	if (typeof target !== "string") throw new Error("Missing target document")
	browser(session, "click", '[data-action="new"]')
	for (let query of ["Projects", "syntax", target]) {
		fill("[[" + query)
		wait(
			session,
			'document.querySelector("#completion-menu").textContent.includes("Link target")',
		)
		assert(
			evaluate(
				session,
				'document.querySelector("#completion-menu").textContent.includes("Projects/Notes")',
			),
			"Wikilinks match folder, tags and identity and display their location",
		)
		browser(session, "press", "Enter")
		expect(`[[${target}]]`)
	}
	fill("[[literal [[Projects")
	browser(session, "press", "Enter")
	expect(`[[literal [[${target}]]`)
	assert(true, "Nested opening brackets keep preceding literal text")
	wait(
		session,
		'document.querySelector("#save-status").getAttribute("aria-busy") === "false" && document.querySelector("#save-status").dataset.pending === "0"',
	)
	browser(session, "reload")
	wait(
		session,
		`${source}?.value === ${JSON.stringify(`[[literal [[${target}]]`)}`,
	)
	assert(true, "Completed links survive durable reopening")
} finally {
	try {
		browser(session, "close")
	} finally {
		server.kill()
		await server.exited
	}
}

function fill(value: string) {
	browser(session, "fill", "#editor", value)
	expect(value)
	select(value.length)
}
function select(position: number) {
	evaluate(
		session,
		`document.querySelector("#editor").focus(); ${source}.setSelectionRange(${position}, ${position}); true`,
	)
}
function expect(value: string) {
	wait(session, `${source}.value === ${JSON.stringify(value)}`)
}
