import { EditorElement } from "../../../src/client/components/editor"
import { editorPreferences } from "../../../src/shared/preferences"
import { Replica } from "../../../src/shared/crdt"

function createEditor(owner: Replica) {
	let editor = new EditorElement()
	editor.configure({
		content: owner.text("doc"),
		atoms: owner.visible("doc"),
		editable: true,
		preferences: editorPreferences({ autocomplete: false }),
		documents: () => [
			{ id: "other", title: "Other document", archived: false },
		],
		isDrawing: () => false,
		openDrawing() {},
		openDocument() {},
		comments: () => [],
		createLinkedDocument: async () => "unused",
		report(error) {
			throw error
		},
		change: () => undefined,
		undo() {},
		select() {},
		requestAsset() {},
		attach() {},
		command() {},
		find() {},
	})
	document.body.append(editor)
	return editor
}
function assert(condition: boolean, message: string) {
	if (!condition) throw Error(message)
}
async function frame() {
	await new Promise<void>(resolve =>
		requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
	)
}
let results: { name: string; exact: boolean }[] = []
async function peer(name: string, before: string, next: string) {
	let first = new Replica("first")
	let second = new Replica("second")
	let initial = first.edit("doc", before)
	if (!initial) throw Error("Missing initial source")
	second.apply([initial])
	let editor = createEditor(first)
	try {
		await frame()
		let source = editor.source
		if (!source) throw Error("Missing source adapter")
		source.focus()
		source.setSelectionRange(before.length, before.length)
		let edit = second.edit("doc", next)
		if (!edit) throw Error("Missing remote edit")
		first.apply([edit])
		editor.update(first.text("doc"), first.visible("doc"), true)
		await frame()
		assert(source.value === next, name + " canonical source")
		assert(
			source.sourceIndex.codePoints === Array.from(next).length,
			name + " Unicode index",
		)
		let expected = next.startsWith(before) ? before.length : next.length
		assert(
			source.selectionStart === expected && source.selectionEnd === expected,
			name + " exact anchored caret",
		)
		if (next.length < 1024) {
			assert(
				source.element.value.includes("Tail") || !next.includes("Tail"),
				name + " visible native tail",
			)
			if (next.includes("[Example]")) {
				assert(
					source.projection.text.includes("Example"),
					name + " projected link label",
				)
				assert(
					!source.projection.text.includes("https://example.org"),
					name + " inactive URL collapsed",
				)
			}
		}
		results.push({ name, exact: true })
	} finally {
		editor.remove()
	}
}
async function boundary(name: string, before: string, next: string) {
	let owner = new Replica("boundary")
	owner.edit("doc", "Initial")
	let editor = createEditor(owner)
	try {
		await frame()
		let source = editor.source
		if (!source) throw Error("Missing source adapter")
		source.value = before
		source.value = next
		await frame()
		assert(source.value === next, name + " source")
		assert(
			source.sourceIndex.codePoints === Array.from(next).length,
			name + " exact Unicode counts",
		)
		assert(
			source.selectionStart === next.length &&
				source.selectionEnd === next.length,
			name + " terminal selection",
		)
		assert(source.element.value === next, name + " complete native input")
		results.push({ name, exact: true })
	} finally {
		editor.remove()
	}
}
try {
	for (let [name, before, next] of [
		["scalar append", "Tail", "TailX"],
		["scalar removal", "TailX", "Tail"],
		["astral append", "Tail", "Tail😀"],
		["astral removal", "Tail😀", "Tail"],
		[
			"projected link append",
			"Read [Example](https://example.org). Tail",
			"Read [Example](https://example.org). TailX",
		],
		[
			"projected link removal",
			"Read [Example](https://example.org). TailX",
			"Read [Example](https://example.org). Tail",
		],
		[
			"ordinary frontmatter append",
			"---\ntitle: Shared\n---\nTail",
			"---\ntitle: Shared\n---\nTail😀",
		],
		["middle fallback", "TailABCDEFGHIJ", "TailABXYZCDEFGHIJ"],
		["bidi append", "العربية 😀", "العربية 😀X"],
		["bidi removal", "العربية 😀X", "العربية 😀"],
		[
			"bounded wrapped append",
			"word ".repeat(26214) + "Tail",
			"word ".repeat(26214) + "TailX",
		],
		[
			"bounded wrapped removal",
			"word ".repeat(26214) + "TailX",
			"word ".repeat(26214) + "Tail",
		],
	]) {
		if (name === undefined || before === undefined || next === undefined)
			throw Error("Incomplete scenario")
		await peer(name, before, next)
	}
	for (let [name, before, next] of [
		["complete split surrogate by append", "A\ud83d", "A😀"],
		["delete low surrogate", "A😀", "A\ud83d"],
		["append lone low surrogate", "A", "A\udc00"],
		["remove lone low surrogate", "A\udc00", "A"],
		["empty append", "", "😀"],
		["empty removal", "😀", ""],
	]) {
		if (name === undefined || before === undefined || next === undefined)
			throw Error("Incomplete scenario")
		await boundary(name, before, next)
	}
	document.body.dataset.results = JSON.stringify(results)
} catch (error) {
	document.body.dataset.failure =
		error instanceof Error ? error.message : String(error)
} finally {
	document.body.dataset.done = "true"
}
