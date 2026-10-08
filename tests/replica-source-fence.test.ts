import { expect, test } from "bun:test"
import { Replica } from "../src/shared/crdt"
import { newDocument } from "../src/shared/documents"

let cases = [
	{
		name: "separator assembled from two disjoint edits",
		source: "intro\nx-x\nbody\n",
		changes: [
			{ start: 6, remove: 1, text: "-" },
			{ start: 8, remove: 1, text: "-" },
		],
		expected: "intro\n---\nbody\n",
	},
	{
		name: "editing a literal body separator",
		source: "intro\n---\nbody\n",
		changes: [{ start: 7, remove: 1, text: "x" }],
		expected: "intro\n-x-\nbody\n",
	},
	{
		name: "editing away from a literal separator",
		source: "intro\n---\nbody\n",
		changes: [{ start: 0, remove: 5, text: "Heading" }],
		expected: "Heading\n---\nbody\n",
	},
	{
		name: "plain Unicode and CRLF document",
		source: "Alpha😀\r\nBeta\n",
		changes: [
			{ start: 0, remove: 5, text: "Gamma" },
			{ start: 9, remove: 4, text: "Delta" },
		],
		expected: "Gamma😀\r\nDelta\n",
	},
	{
		name: "separator assembled across replacement boundaries",
		source: "intro\n--x\nbody\n",
		changes: [{ start: 8, remove: 1, text: "-" }],
		expected: "intro\n---\nbody\n",
	},
	{
		name: "new frontmatter assembled from existing dashes",
		source: "--x\ntitle: First\n--x\nbody\n",
		changes: [
			{ start: 2, remove: 1, text: "-" },
			{ start: 19, remove: 1, text: "-" },
		],
		expected: "---\ntitle: First\n---\nbody\n",
	},
	{
		name: "removing an existing opening fence",
		source: "---\ntitle: First\n---\nbody\n",
		changes: [{ start: 0, remove: 1, text: "" }],
		expected: "--\ntitle: First\n---\nbody\n",
	},
	{
		name: "BOM and CRLF frontmatter body edit",
		source: "\uFEFF---\r\ntitle: First\r\n---\r\nbody😀\r\n",
		changes: [{ start: 29, remove: 2, text: "🌟" }],
		expected: "\uFEFF---\r\ntitle: First\r\n---\r\nbody🌟\r\n",
	},
]

for (let scenario of cases)
	test("precise replacements preserve " + scenario.name, () => {
		let birth = new Replica("birth")
		newDocument(birth, "doc", "", scenario.source)
		let writer = birth.fork("writer")
		let operation = writer.prepareReplacements("doc", scenario.changes)
		if (!operation) throw Error("Missing replacement")
		writer.apply([operation])
		expect(writer.text("doc")).toBe(scenario.expected)
		let restored = new Replica("restored")
		restored.restore(writer.checkpoint())
		expect(restored.text("doc")).toBe(scenario.expected)
		let inverse = writer.inverse(operation)
		writer.apply([inverse])
		expect(writer.text("doc")).toBe(scenario.source)
	})

test("plain precise edits from stale atoms retain another writer through convergence and causal undo", () => {
	let birth = new Replica("birth")
	newDocument(birth, "doc", "", "Alpha😀\r\nBeta\n")
	let first = birth.fork("first"),
		second = birth.fork("second"),
		base = first.visible("doc")
	let remote = second.prepareReplacements("doc", [
		{ start: 14, remove: 0, text: "Remote\n" },
	])
	if (!remote) throw Error("Missing remote edit")
	second.apply([remote])
	first.apply([remote])
	let local = first.prepareReplacements(
		"doc",
		[
			{ start: 0, remove: 5, text: "Gamma" },
			{ start: 9, remove: 4, text: "Delta" },
		],
		base,
	)
	if (!local) throw Error("Missing stale-base edit")
	first.apply([local])
	second.apply([local])
	expect(first.text("doc")).toBe("Gamma😀\r\nDelta\nRemote\n")
	expect(second.text("doc")).toBe(first.text("doc"))
	let undo = first.inverse(local)
	first.apply([undo])
	second.apply([undo])
	expect(first.text("doc")).toBe("Alpha😀\r\nBeta\nRemote\n")
	expect(second.text("doc")).toBe(first.text("doc"))
})
