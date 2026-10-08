import { expect, test } from "bun:test"
import { Replica } from "../src/shared/crdt"
import { parseCheckpoint } from "../src/shared/checkpoint"

function cold(replica: Replica) {
	let restored = new Replica("independent-reconstruction")
	restored.restore(parseCheckpoint(replica.checkpoint()))
	return restored
}
let sources = [
	"---\ntitle: &n T\nalias: *n\n---\nBody TOKEN 😀\n",
	"---\nx: 1\nalias: *n\n---\nBody TOKEN 😀\n",
	"\uFEFF---\r\ntitle: &n T\r\nalias: *n\r\n---\r\nBody TOKEN 😀\r\n",
	'---\ntitle: "Broken\n---\nBody TOKEN 😀\n',
	"---\nunclosed: *n\nBody TOKEN 😀\n",
	"Body TOKEN 😀\n",
]
test.each(
	sources.flatMap(source => ["", "🦊é中"].map(text => ({ source, text }))),
)(
	"validated deletion/Unicode replacement Undo chains equal independent checkpoint reconstruction (%j)",
	({ source, text }) => {
		let replica = new Replica("writer")
		replica.edit("doc", source)
		let before = replica.text("doc")
		replica.visible("doc")
		let start = before.indexOf("TOKEN")
		expect(start).toBeGreaterThanOrEqual(0)
		let operation = replica.prepareReplacements("doc", [
			{ start, remove: 5, text },
		])
		if (!operation) throw Error("Replacement unavailable")
		replica.apply([operation])
		let after = replica.text("doc")
		replica.visible("doc")
		replica.apply([...replica.operations.values()])
		let last = operation
		for (let turn = 0; turn < 6; turn++) {
			last = replica.cancel("doc", last.id)
			let reconstructed = cold(replica)
			expect(replica.text("doc")).toBe(reconstructed.text("doc"))
			expect(
				replica
					.visible("doc")
					.map(atom => ({ id: atom.id, value: atom.value })),
			).toEqual(
				reconstructed
					.visible("doc")
					.map(atom => ({ id: atom.id, value: atom.value })),
			)
			expect(replica.text("doc")).toBe(turn % 2 === 0 ? before : after)
			replica.apply([last])
			expect(replica.text("doc")).toBe(reconstructed.text("doc"))
		}
	},
)

test.each([
	"---\nanchor: &n T\nalias: *n\n---\nBody\n",
	"\uFEFF---\r\nanchor: &n T\r\nalias: *n\r\n---\r\nBody\r\n",
])(
	"root header replacement cancellation always preserves cold alias normalization (%s)",
	source => {
		let replica = new Replica("writer")
		replica.edit("doc", "Body 😀")
		let changed = replica.prepareEdit("doc", source)
		if (!changed) throw Error("Header edit unavailable")
		replica.apply([changed])
		expect(replica.text("doc")).toBe(cold(replica).text("doc"))
		let cancelled = replica.cancel("doc", changed.id)
		expect(replica.text("doc")).toBe(cold(replica).text("doc"))
		replica.cancel("doc", cancelled.id)
		expect(replica.text("doc")).toBe(cold(replica).text("doc"))
	},
)

test("body replacement inverse preserves concurrent lost-alias normalization", () => {
	let base = new Replica("base")
	base.edit("doc", "---\ntitle: &n T\nx: 1\n---\nBody TOKEN 😀")
	let first = base.fork("a")
	let second = base.fork("z")
	first.edit("doc", "---\ntitle: &n T\nx: 1\nalias: *n\n---\nBody TOKEN 😀")
	second.edit("doc", "---\nx: 1\n---\nBody TOKEN 😀")
	first.apply([...second.operations.values()])
	let before = first.text("doc")
	let start = before.indexOf("TOKEN")
	let operation = first.prepareReplacements("doc", [
		{ start, remove: 5, text: "🦊" },
	])
	if (!operation) throw Error("Replacement unavailable")
	first.apply([operation])
	let last = operation
	for (let turn = 0; turn < 5; turn++) {
		let restored = cold(first)
		expect(first.text("doc")).toBe(restored.text("doc"))
		expect(first.visible("doc").map(atom => atom.id)).toEqual(
			restored.visible("doc").map(atom => atom.id),
		)
		last = first.cancel("doc", last.id)
	}
	expect(first.text("doc")).toBe(cold(first).text("doc"))
})
