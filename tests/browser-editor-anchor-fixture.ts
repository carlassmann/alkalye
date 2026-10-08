import { EditorElement } from "../src/client/components/editor"
import { editorPreferences } from "../src/shared/preferences"
import { Replica } from "../src/shared/crdt"
import { newDocument } from "../src/shared/documents"
import { changeMetadata } from "../src/shared/document-metadata"
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
		source.value === content(scenario.after) &&
		source.sourceIndex.value === source.value
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
let removedRange = atoms("x".repeat(4096))
let variableRange = Array.from({ length: 192 }, (_, index) => ({
	id: "variable" + index,
	after: "",
	value: index % 2 ? "😀" : "abc",
}))
let owner = new Replica("owner")
let initial = "---\ntitle: Shared\n---\n" + "Line 😀\n".repeat(2048)
owner.edit("doc", initial)
let operation = owner.edit("doc", initial + "X😀")
if (!operation) throw Error("Missing CRDT edit")
let beforeUndo = owner.visible("doc")
owner.cancel("doc", operation.id)
let generated = new Replica("generated")
generated.edit("sparse", "x".repeat(4096))
let generatedAtoms = generated.visible("sparse")
let gapped = new Replica("gapped")
gapped.edit("gapped", "x".repeat(4096))
gapped.edit("gapped", "x".repeat(100) + "new" + "x".repeat(3996))
gapped.edit(
	"gapped",
	gapped.text("gapped").slice(0, 200) + gapped.text("gapped").slice(600),
)
let gappedAtoms = gapped.visible("gapped")
let foreign = new Replica("foreign")
foreign.edit("foreign", "new")
let foreignAtoms = foreign.visible("foreign")
let generatedEmoji = new Replica("emoji-owner")
generatedEmoji.edit("emoji", "😀".repeat(4096))
let generatedEmojiAtoms = generatedEmoji.visible("emoji")
let mixedRuns = new Replica("mixed-owner")
mixedRuns.edit("mixed", "x".repeat(2048))
mixedRuns.edit("mixed", "x".repeat(2048) + "y".repeat(2048))
let mixedAtoms = mixedRuns.visible("mixed")
function terminalScenario(
	body: string,
	tail: string,
	selected = false,
): Scenario {
	let replica = new Replica("terminal-owner")
	newDocument(replica, "terminal", "Original", body)
	changeMetadata(replica, "terminal", {
		title: "Long renamed title",
		tags: ["green"],
	})
	changeMetadata(replica, "terminal", { title: "Short" })
	let source = replica.text("terminal")
	let inserted = replica.edit("terminal", source + tail)
	if (!inserted) throw Error("Missing terminal insertion")
	let before = replica.visible("terminal")
	replica.cancel("terminal", inserted.id)
	let after = replica.visible("terminal")
	let restored = new Replica("independent")
	restored.restore(replica.checkpoint())
	if (replica.text("terminal") !== restored.text("terminal"))
		throw Error("Checkpoint mismatch")
	let start = selected
		? source.indexOf("Body") + 2
		: source.length + tail.length
	return {
		name:
			"terminal cancellation " +
			tail +
			" preserves " +
			(selected ? "selection" : "caret"),
		before,
		after,
		start,
		...(selected ? { end: source.length + tail.length } : {}),
		expected: [selected ? start : source.length, source.length],
	}
}
function replacementScenarios(name: string, before: string, after: string) {
	let replica = new Replica("replacement-owner")
	replica.edit("replacement", before)
	let initial = replica.visible("replacement")
	replica.edit("replacement", after)
	let updated = replica.visible("replacement")
	return [
		{
			name: name + " forward",
			before: initial,
			after: updated,
			start: before.length,
			expected: [after.length, after.length],
		},
		{
			name: name + " backward",
			before: updated,
			after: initial,
			start: after.length,
			expected: [before.length, before.length],
		},
	] satisfies Scenario[]
}
let scenarios: Scenario[] = [
	...replacementScenarios(
		"Unicode replacement at a block boundary",
		"x".repeat(4095) + "😀\n" + "z".repeat(8192),
		"x".repeat(4095) + "Q\n" + "z".repeat(8192),
	),
	...replacementScenarios(
		"Long unchanged suffix after prefix insertion",
		"x".repeat(8193) + "tail\n",
		"Prefix\n" + "x".repeat(8193) + "tail\n",
	),
	...replacementScenarios(
		"Overlapping repeated text retains its final line",
		"a".repeat(12288) + "\nend",
		"a".repeat(8192) + "\nend",
	),
	terminalScenario("Body" + "z".repeat(16384), "X"),
	terminalScenario("Body😀" + "z".repeat(16384), "🌻"),
	terminalScenario("Body😀" + "z".repeat(16384), "🌻", true),
	terminalScenario("", "X"),
	{
		name: "generated Unicode survivors preserve UTF16 offsets",
		before: generatedEmojiAtoms,
		after: [
			requiredAtom(generatedEmojiAtoms, 120),
			requiredAtom(generatedEmojiAtoms, 3000),
		],
		start: 4096,
		end: 8192,
		expected: [2, 4],
	},
	{
		name: "two generated insertion owners retain independent anchor positions",
		before: mixedAtoms,
		after: [requiredAtom(mixedAtoms, 120), requiredAtom(mixedAtoms, 3000)],
		start: 2048,
		end: 4096,
		expected: [1, 2],
	},
	{
		name: "duplicate survivor keeps final next occurrence offset",
		before: generatedAtoms,
		after: [
			requiredAtom(generatedAtoms, 120),
			requiredAtom(generatedAtoms, 120),
		],
		start: 2048,
		end: 4096,
		expected: [2, 2],
	},
	{
		name: "generated sparse survivors resolve independent distant anchors",
		before: generatedAtoms,
		after: [
			requiredAtom(generatedAtoms, 120),
			requiredAtom(generatedAtoms, 80),
			requiredAtom(generatedAtoms, 3000),
		],
		start: 2048,
		end: 4096,
		expected: [1, 3],
	},
	{
		name: "unhinted gapped insertion owner forces exact nearest-survivor fallback",
		before: gappedAtoms,
		after: [
			requiredAtom(gappedAtoms, 120),
			requiredAtom(gappedAtoms, 100),
			requiredAtom(gappedAtoms, 3000),
		],
		start: 2048,
		end: content(gappedAtoms).length,
		expected: [1, 3],
	},
	{
		name: "new owner survivor forces exact fallback",
		before: generatedAtoms,
		after: [requiredAtom(foreignAtoms, 0), requiredAtom(generatedAtoms, 120)],
		start: 2048,
		end: 4096,
		expected: [2, 2],
	},
	{
		name: "empty replacement preserves both range anchors at zero",
		before: removedRange,
		after: [],
		start: 2048,
		end: 4096,
		expected: [0, 0],
	},
	{
		name: "exhaustive predecessor follows old order across reordered survivors",
		before: removedRange,
		after: [
			requiredAtom(removedRange, 120),
			requiredAtom(removedRange, 80),
			requiredAtom(removedRange, 3000),
		],
		start: 2048,
		end: 4096,
		expected: [1, 3],
	},
	{
		name: "exhaustive legacy predecessor preserves variable-width offsets",
		before: variableRange,
		after: [requiredAtom(variableRange, 19), requiredAtom(variableRange, 20)],
		start: content(variableRange).length,
		expected: [5, 5],
	},
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
