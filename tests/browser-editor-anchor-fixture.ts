import { EditorElement } from "../src/client/components/editor"
import { editorPreferences } from "../src/shared/preferences"
import { Replica } from "../src/shared/crdt"
import type { Atom } from "../src/shared/model"

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
	editor.update(content(scenario.after), scenario.after, true)
	let actual = [source.selectionStart, source.selectionEnd]
	let exact =
		actual[0] === scenario.expected[0] &&
		actual[1] === scenario.expected[1] &&
		source.value === content(scenario.after)
	editor.remove()
	if (!exact)
		throw Error(`${scenario.name}: ${actual} expected ${scenario.expected}`)
	return { name: scenario.name, actual, exact }
}
let original = atoms("abcx")
let prefix = atoms("z".repeat(1024), "new")
let distant = [...prefix, ...original]
let missing = atoms("x".repeat(101))
let legacy = [
	{ id: "hello", after: "", value: "hello" },
	{ id: "emoji", after: "hello", value: "😀" },
	{ id: "world", after: "emoji", value: "world" },
]
let ranges = atoms("abcde")
let owner = new Replica("owner")
let initial = "---\ntitle: Shared\n---\n" + "Line 😀\n".repeat(2048)
owner.edit("doc", initial)
let operation = owner.edit("doc", initial + "X😀")
if (!operation) throw Error("Missing CRDT edit")
let beforeUndo = owner.visible("doc")
owner.cancel("doc", operation.id)
let scenarios: Scenario[] = [
	{
		name: "primary survives beyond capped local radius",
		before: original,
		after: distant,
		start: 4,
		expected: [1028, 1028],
	},
	{
		name: "closer predecessor survives far away",
		before: original,
		after: [
			requiredAtom(original, 1),
			...prefix,
			requiredAtom(original, 0),
			requiredAtom(original, 2),
		],
		start: 4,
		expected: [1027, 1027],
	},
	{
		name: "more than64 missing predecessors retains exhaustive fallback",
		before: missing,
		after: missing.slice(0, 20),
		start: 101,
		expected: [20, 20],
	},
	{
		name: "legacy variable-width atoms retain UTF16 offset",
		before: legacy,
		after: [requiredAtom(legacy, 0), requiredAtom(legacy, 2)],
		start: 7,
		expected: [5, 5],
	},
	{
		name: "two deleted range endpoints resolve independently",
		before: ranges,
		after: [
			requiredAtom(ranges, 0),
			requiredAtom(ranges, 2),
			requiredAtom(ranges, 4),
		],
		start: 2,
		end: 4,
		expected: [1, 2],
	},
	{
		name: "no old atoms surviving resolves start",
		before: original,
		after: atoms("fresh", "fresh"),
		start: 4,
		expected: [0, 0],
	},
	{
		name: "public CRDT undo restores Unicode caret to predecessor",
		before: beforeUndo,
		after: owner.visible("doc"),
		start: initial.length + 3,
		expected: [initial.length, initial.length],
	},
]
declare global {
	interface Window {
		anchorCases: () => Promise<Awaited<ReturnType<typeof exercise>>[]>
	}
}
window.anchorCases = async function () {
	let results = []
	for (let scenario of scenarios) results.push(await exercise(scenario))
	return results
}

window.anchorCases().then(
	results => {
		document.body.dataset.results = JSON.stringify(results)
		document.body.dataset.done = "true"
	},
	error => {
		document.body.dataset.failure = String(error)
		document.body.dataset.done = "true"
	},
)
