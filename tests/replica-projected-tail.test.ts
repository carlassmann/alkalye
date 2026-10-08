import { expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import { Replica } from "../src/shared/crdt"
import type { Operation } from "../src/shared/model"

function assertReconstruction(replica: Replica) {
	let restored = new Replica("oracle")
	restored.restore(replica.checkpoint())
	expect(replica.text("doc")).toBe(restored.text("doc"))
	expect(replica.visible("doc")).toEqual(restored.visible("doc"))
	expect(replica.metadata("doc")).toEqual(restored.metadata("doc"))
}
function peerReplacement(
	replica: Replica,
	ranges: { start: number; remove: number; text: string }[],
	actor = "peer",
) {
	let peer = replica.fork(actor)
	let operation = peer.prepareReplacements("doc", ranges)
	if (!operation) throw Error("Missing peer operation")
	replica.apply([operation])
	assertReconstruction(replica)
	return operation
}
function peerPrefix(replica: Replica, prefix = "PREFIX\n") {
	peerReplacement(replica, [{ start: 0, remove: 0, text: prefix }], "prefix")
}
let seeds = [
	"---\ntitle: Shared\n---\nBody",
	"\uFEFF---\r\ntitle: Shared\r\n---\r\nBody😀",
	"---\n---\nBody",
	"---\ntitle: Shared\n---\n",
	"---\ntitle: Shared",
	"---\ntitle: Shared\n---\nBody\n---\nSecond",
	"Body without frontmatter",
]
for (let source of seeds)
	test(
		"projected terminal peer edits reconstruct exactly " +
			JSON.stringify(source),
		() => {
			let replica = new Replica("writer")
			replica.edit("doc", source)
			replica.text("doc")
			peerPrefix(replica)
			for (let text of ["a", "🌻", "b"]) {
				let before = replica.text("doc")
				peerReplacement(replica, [{ start: before.length, remove: 0, text }])
				expect(replica.text("doc")).toBe(before + text)
			}
			let before = replica.text("doc")
			let removed = peerReplacement(
				replica,
				[{ start: before.length - 1, remove: 1, text: "" }],
				"eraser",
			)
			expect(replica.text("doc")).toBe(before.slice(0, -1))
			let cancel = replica.cancel("doc", removed.id)
			if (!cancel) throw Error("Missing cancellation")
			assertReconstruction(replica)
			expect(replica.text("doc")).toBe(before)
			let emoji = replica.text("doc").indexOf("🌻")
			peerReplacement(
				replica,
				[{ start: emoji, remove: 2, text: "😀" }],
				"middle",
			)
			assertReconstruction(replica)
		},
	)
test("concurrent header rewrites, terminal siblings and metadata reconstruct", () => {
	let replica = new Replica("writer")
	replica.edit("doc", "---\ntitle: Shared\n---\nBody🌻")
	replica.text("doc")
	let a = replica.fork("header-a"),
		b = replica.fork("header-b")
	let x = a.prepareEdit("doc", "---\ntitle: Alpha\n---\nBody🌻"),
		y = b.prepareEdit("doc", "---\ntitle: Beta\n---\nBody🌻")
	if (!x || !y) throw Error("Missing header rewrites")
	replica.apply([x, y])
	assertReconstruction(replica)
	peerPrefix(replica)
	let one = replica.fork("sibling-a"),
		two = replica.fork("sibling-b"),
		end = replica.text("doc").length
	let first = one.prepareReplacements("doc", [
			{ start: end, remove: 0, text: "a" },
		]),
		second = two.prepareReplacements("doc", [
			{ start: end, remove: 0, text: "b" },
		])
	if (!first || !second) throw Error("Missing concurrent siblings")
	replica.apply([first])
	assertReconstruction(replica)
	replica.apply([second])
	assertReconstruction(replica)
	replica.set("doc", "pinned", "true")
	assertReconstruction(replica)
	let content = replica.text("doc")
	peerReplacement(
		replica,
		[{ start: content.length, remove: 0, text: "😀" }],
		"last",
	)
})
test("non-scalar legacy body retains full reconstruction and future Unicode edits", () => {
	let seed = new Replica("legacy")
	let operation = seed.prepareEdit("doc", "Body")
	if (!operation || !operation.insert[0]) throw Error("Missing legacy seed")
	let atom = operation.insert[0]
	let legacy: Operation = {
		...operation,
		insert: [{ ...atom, value: "Body😀 legacy" }],
	}
	seed.apply([legacy])
	seed.text("doc")
	peerPrefix(seed)
	let before = seed.text("doc")
	peerReplacement(
		seed,
		[{ start: before.length, remove: 0, text: "x" }],
		"tail",
	)
	assertReconstruction(seed)
	let value = seed.text("doc"),
		emoji = value.indexOf("😀")
	peerReplacement(seed, [{ start: emoji, remove: 2, text: "🌻" }], "unicode")
	assertReconstruction(seed)
})
test("cold cooperative projected view and hidden tail cancellation remain exact", async () => {
	let seed = new Replica("writer")
	seed.edit("doc", "---\ntitle: Shared\n---\nBody😀")
	peerPrefix(seed)
	let replica = new Replica("cold")
	replica.restore(seed.checkpoint())
	await Effect.runPromise(replica.textEffect("doc"))
	let before = replica.text("doc")
	let added = peerReplacement(
		replica,
		[{ start: before.length, remove: 0, text: "🌻" }],
		"tail",
	)
	replica.cancel("doc", added.id)
	assertReconstruction(replica)
	expect(replica.text("doc")).toBe(before)
	peerReplacement(
		replica,
		[{ start: before.length, remove: 0, text: "z" }],
		"later",
	)
	assertReconstruction(replica)
})
for (let separator of ["\n", "\r", "\u2028"])
	test(
		"tail fence completion and removal reconstruct " +
			JSON.stringify(separator),
		() => {
			let replica = new Replica("writer")
			replica.edit("doc", "---\ntitle: Shared\n---\nBody" + separator + "--")
			peerPrefix(replica)
			let before = replica.text("doc")
			let added = peerReplacement(
				replica,
				[{ start: before.length, remove: 0, text: "-" }],
				"fence",
			)
			assertReconstruction(replica)
			let text = replica.text("doc")
			peerReplacement(
				replica,
				[{ start: text.length, remove: 0, text: separator }],
				"line",
			)
			replica.cancel("doc", added.id)
			assertReconstruction(replica)
		},
	)
test("deleted frames mid-line, frontmatter undo and terminal peer edit reconstruct", () => {
	let replica = new Replica("writer")
	replica.edit("doc", "---\ntitle: Shared\n---\nBody")
	let one = replica.fork("header-one"),
		two = replica.fork("header-two")
	let a = one.prepareEdit("doc", "---\ntitle: One\n---\nBody"),
		b = two.prepareEdit("doc", "---\ntitle: Two\n---\nBody")
	if (!a || !b) throw Error("Missing frame edit")
	replica.apply([a, b])
	assertReconstruction(replica)
	one.apply([a, b])
	let undo = one.cancel("doc", a.id)
	if (!undo) throw Error("Missing frame cancellation")
	replica.apply([undo])
	assertReconstruction(replica)
	peerPrefix(replica, "abc")
	let end = replica.text("doc").length
	peerReplacement(replica, [{ start: end, remove: 0, text: "--x" }], "suffix")
	let content = replica.text("doc")
	let deleted = peerReplacement(
		replica,
		[{ start: content.length - 1, remove: 1, text: "" }],
		"eraser",
	)
	replica.cancel("doc", deleted.id)
	assertReconstruction(replica)
})
