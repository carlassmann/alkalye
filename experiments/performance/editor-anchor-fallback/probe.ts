import { EditorElement } from "../../../src/client/components/editor"
import { editorPreferences } from "../../../src/shared/preferences"
import { immutableAtoms } from "../../../src/shared/atom-sequence"
import type { Atom } from "../../../src/shared/model"
interface Scenario {
	name: string
	before: Atom[]
	after: Atom[]
	start: number
	end?: number
	expected: [number, number]
}
function atoms(source: string, prefix = "old") {
	return Array.from(source, (value, index) => ({
		id: prefix + index,
		after: "",
		value,
	}))
}
function requiredAtom(atoms: Atom[], index: number) {
	let atom = atoms[index]
	if (!atom) throw Error("Missing fixture atom")
	return atom
}
function content(atoms: Atom[]) {
	return atoms.map(atom => atom.value).join("")
}
async function exercise(scenario: Scenario) {
	let editor = new EditorElement()
	editor.configure({
		content: content(scenario.before),
		atoms: scenario.before,
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
	if (!source) throw Error("Missing editor source")
	source.focus()
	source.setSelectionRange(scenario.start, scenario.end ?? scenario.start)
	await new Promise<void>(resolve =>
		requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
	)
	let after = content(scenario.after)
	let began = performance.now()
	editor.update(after, scenario.after, true)
	let synchronous = performance.now() - began
	await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
	let frameOpportunity = performance.now() - began
	let actual = [source.selectionStart, source.selectionEnd]
	let exact =
		actual[0] === scenario.expected[0] &&
		actual[1] === scenario.expected[1] &&
		source.value === content(scenario.after)
	editor.remove()
	if (!exact)
		throw Error(`${scenario.name}: ${actual} expected ${scenario.expected}`)
	return { name: scenario.name, actual, exact, synchronous, frameOpportunity }
}
declare global {
	interface Window {
		fallbackProbe: (
			characters: number,
			empty: boolean,
		) => Promise<Awaited<ReturnType<typeof exercise>>>
	}
}
window.fallbackProbe = async function (characters, empty) {
	let before = immutableAtoms(atoms("x".repeat(characters)))
	let first = requiredAtom(before, 120)
	let second = requiredAtom(before, 80)
	let after = immutableAtoms(empty ? [] : [first, second])
	return exercise({
		name: (empty ? "empty" : "reordered-survivors") + "-" + characters,
		before,
		after,
		start: Math.floor(characters / 2),
		end: characters,
		expected: empty ? [0, 0] : [1, 1],
	})
}
