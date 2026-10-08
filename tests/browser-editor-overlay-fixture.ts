import { EditorElement } from "../src/client/components/editor"
import { editorPreferences } from "../src/shared/preferences"
import { Replica } from "../src/shared/crdt"

let results: Array<{ name: string; exact: boolean }> = []
function verify(name: string, exact: boolean) {
	if (!exact) throw Error(name)
	results.push({ name, exact })
}
async function run() {
	let replica = new Replica("fixture")
	let content = "**first**\n" + "line 😀 text\n".repeat(3000) + "**target**"
	replica.edit("doc", content)
	let editor = new EditorElement()
	editor.configure({
		content,
		atoms: replica.visible("doc"),
		editable: true,
		preferences: editorPreferences({ autocomplete: false }),
		documents: () => [],
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
	await new Promise<void>(resolve =>
		requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
	)
	let source = editor.source
	if (!source) throw Error("Missing source")
	let target = content.lastIndexOf("target")
	editor.selectRange(target, target + 6)
	let highlight = editor.querySelector<HTMLElement>("#highlight")
	if (!highlight) throw Error("Missing overlay")
	verify(
		"Immediate far-away selection uses current overlay",
		source.selectionStart === target &&
			source.selectionEnd === target + 6 &&
			Boolean(highlight.textContent?.includes("target")),
	)
	let native = editor.querySelector<HTMLTextAreaElement>("#editor")
	if (!native) throw Error("Missing native input")
	source.focus()
	source.setSelectionRange(target, target)
	native.dispatchEvent(
		new CompositionEvent("compositionstart", { bubbles: true, data: "" }),
	)
	native.setRangeText(
		"日本語",
		native.selectionStart,
		native.selectionEnd,
		"end",
	)
	native.dispatchEvent(
		new InputEvent("input", {
			bubbles: true,
			inputType: "insertCompositionText",
			data: "日本語",
			isComposing: true,
		}),
	)
	native.dispatchEvent(
		new CompositionEvent("compositionend", { bubbles: true, data: "日本語" }),
	)
	await Promise.resolve()
	verify(
		"Simulated composition reconciles complete source",
		source.value ===
			content.slice(0, target) + "日本語" + content.slice(target),
	)
	source.replace(
		source.value + " queued",
		source.value.length,
		source.value.length,
	)
	editor.remove()
	let detached = editor.innerHTML
	await Promise.resolve()
	await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
	verify(
		"Queued overlay callbacks do not repaint disposed editor",
		editor.innerHTML === detached,
	)
	document.body.dataset.results = JSON.stringify(results)
}
run()
	.catch(error => {
		document.body.dataset.failure = String(error)
	})
	.finally(() => {
		document.body.dataset.done = "true"
	})
