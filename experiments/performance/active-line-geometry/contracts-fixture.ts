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
async function check(editor: EditorElement, name: string) {
	await frame()
	let source = editor.source
	let highlight = editor.querySelector("#highlight")
	let active = editor.querySelector(".active-line")
	if (
		!source ||
		!(highlight instanceof HTMLElement) ||
		!(active instanceof HTMLElement)
	)
		throw Error("Missing mounted editor geometry")
	let offset =
		source.toView(source.selectionStart) - source.viewport.viewport.start
	let walker = document.createTreeWalker(highlight, NodeFilter.SHOW_TEXT)
	let node = walker.nextNode()
	while (node && offset > (node.textContent?.length ?? 0)) {
		offset -= node.textContent?.length ?? 0
		node = walker.nextNode()
	}
	if (!node) throw Error("Caret absent from visible overlay")
	let range = document.createRange()
	range.setStart(node, Math.min(offset, node.textContent?.length ?? 0))
	range.collapse(true)
	let bounds = range.getBoundingClientRect()
	if (!bounds.height) {
		if (offset < (node.textContent?.length ?? 0)) range.setEnd(node, offset + 1)
		else if (offset) range.setStart(node, offset - 1)
		bounds = range.getClientRects()[0] ?? range.getBoundingClientRect()
	}
	let actual = active.getBoundingClientRect()
	assert(
		!active.hidden &&
			Math.abs(actual.top - bounds.top) < 1 &&
			Math.abs(actual.height - bounds.height) < 1,
		name,
	)
	results.push({ name, exact: true })
}
async function run() {
	let replica = new Replica("owner")
	let content = "word wrapped paragraph ".repeat(6000)
	replica.edit("doc", content)
	let editor = createEditor(replica)
	try {
		await frame()
		let source = editor.source
		if (!source) throw Error("Missing source")
		source.setSelectionRange(12, 12)
		await check(editor, "initial active line")
		for (let scroll of [8, 16, 24]) {
			source.viewport.scrollTop = scroll
			await check(editor, "same-window scroll " + scroll)
		}
		source.setSelectionRange(
			content.indexOf("paragraph") + 2,
			content.indexOf("paragraph") + 2,
		)
		await check(editor, "caret movement")
		editor.style.width = "560px"
		await check(editor, "resize and wrapping")
		editor.style.fontSize = "23px"
		source.viewport.remeasure()
		await check(editor, "font metrics remeasurement")
		let remote = new Replica("peer")
		remote.restore(replica.checkpoint())
		let operation = remote.edit("doc", "Prefix.\n" + content)
		if (!operation) throw Error("Missing peer edit")
		replica.apply([operation])
		editor.update(replica.text("doc"), replica.visible("doc"), true)
		await check(editor, "remote source and anchor relocation")
		source.setSelectionRange(
			replica.text("doc").length - 35,
			replica.text("doc").length - 35,
		)
		await check(editor, "far-window selection")
		let priorTop = source.viewport.viewport.top
		editor.style.width = "417px"
		source.viewport.remeasure()
		source.setSelectionRange(
			replica.text("doc").length - 35,
			replica.text("doc").length - 35,
		)
		await check(editor, "window-top shift with resize")
		assert(
			source.viewport.viewport.top !== priorTop,
			"Actual content window top changed " +
				JSON.stringify({
					priorTop,
					window: source.viewport.viewport,
					scroll: source.viewport.scrollTop,
					hostWidth: editor.clientWidth,
					nativeFont: getComputedStyle(source.element).font,
					nativePadding: getComputedStyle(source.element).padding,
					measure: editor
						.querySelector("[data-viewport-measure]")
						?.getBoundingClientRect()
						.toJSON(),
				}),
		)
		editor.preferences(
			editorPreferences({ autocomplete: false, highlightCurrentLine: false }),
		)
		await frame()
		let active = editor.querySelector(".active-line")
		assert(
			active instanceof HTMLElement && active.hidden,
			"Highlight preference disables active line",
		)
		editor.preferences(
			editorPreferences({ autocomplete: false, highlightCurrentLine: true }),
		)
		await check(editor, "highlight preference re-enabled")
		let deadline = performance.now() + 1000
		let observedTop = source.viewport.viewport.top
		while (performance.now() < deadline) {
			await frame()
			if (source.viewport.viewport.top !== observedTop) {
				await check(editor, "asynchronous refinement top shift")
				observedTop = source.viewport.viewport.top
			}
		}
		await check(editor, "post-refinement active line")
	} finally {
		editor.remove()
	}
	document.body.dataset.results = JSON.stringify(results)
	document.body.dataset.done = "true"
}
run().catch(error => {
	document.body.dataset.failure = String(error)
	document.body.dataset.done = "true"
})
