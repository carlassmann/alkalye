import { expect, test } from "bun:test"
import { Replica, insertionRemovalPosition } from "../src/shared/crdt"

function oracle(replica: Replica, expected: string) {
	let cold = new Replica("oracle")
	cold.restore(replica.checkpoint())
	expect(replica.text("doc")).toBe(expected)
	expect(cold.text("doc")).toBe(expected)
	expect(replica.visible("doc")).toEqual(cold.visible("doc"))
	expect(replica.metadata("doc")).toEqual(cold.metadata("doc"))
}
function insertion(source: string, offset: number, value = "x") {
	let replica = new Replica("writer")
	replica.edit("doc", source)
	replica.text("doc")
	let before = replica.visible("doc")
	let operation = replica.prepareReplacements(
		"doc",
		[{ start: offset, remove: 0, text: value }],
		before,
	)
	if (!operation) throw Error("Missing insertion")
	replica.apply([operation])
	return {
		replica,
		operation,
		before,
		after: replica.visible("doc"),
		edited: source.slice(0, offset) + value + source.slice(offset),
	}
}
for (let source of [
	"Left body Right",
	"Left 😀 Right",
	"---\ntitle: Test\n---\nLeft Right",
	"\ufeff---\r\ntitle: Test\r\n---\r\nLeft Right",
	"---\ntitle: Test\n---\n---\ntitle: Old\n---\nLeft Right",
])
	test(
		"middle insertion cancellation and repeated redo reconstruct exact source " +
			source.length,
		() => {
			let offset = source.indexOf("Right")
			let { replica, operation, after, edited } = insertion(source, offset)
			oracle(replica, edited)
			let undo = replica.cancel("doc", operation.id)
			oracle(replica, source)
			let position = insertionRemovalPosition(
				after,
				replica.visible("doc"),
				operation.insert[0]?.id ?? "",
			)
			if (source === "Left body Right" || position !== undefined)
				expect(position).toBe(offset)
			let redo = replica.cancel("doc", undo.id)
			oracle(replica, edited)
			replica.cancel("doc", redo.id)
			oracle(replica, source)
		},
	)
test("accepted duplicate insertion preserves exact source and inverse through a detached fork", () => {
	let source = "Left 😀 Right"
	let { replica, operation, edited } = insertion(
		source,
		source.indexOf("Right"),
		"🌻",
	)
	replica.apply([operation])
	let staged = replica.fork()
	let undo = staged.cancel("doc", operation.id)
	oracle(staged, source)
	oracle(replica, edited)
	replica.apply([undo])
	oracle(replica, source)
})
test("concurrent sibling and metadata publication preserve peer text across cancellation", () => {
	let source = "Left Right"
	let { replica, operation } = insertion(source, 5)
	let peer = replica.fork("peer")
	let change = peer.edit("doc", "Left xPEER Right")
	if (!change) throw Error("Missing peer insertion")
	replica.apply([change])
	let expected = replica.text("doc").replace("x", "")
	replica.cancel("doc", operation.id)
	oracle(replica, expected)
})
test("identity mutation cannot preserve acknowledgement or publish an inverse", () => {
	let source = "Left Right"
	let { replica, operation, edited } = insertion(source, 5)
	expect(() => replica.apply([{ ...operation, author: "Forged" }])).toThrow(
		"identity",
	)
	oracle(replica, edited)
	replica.cancel("doc", operation.id)
	oracle(replica, source)
})
test("cold restored cancellation preserves exact Unicode without a receipt", () => {
	let source = "Left 😀 Right"
	let { replica, operation, edited } = insertion(
		source,
		source.indexOf("Right"),
		"🌻",
	)
	let cold = new Replica("writer")
	cold.restore(replica.checkpoint())
	oracle(cold, edited)
	cold.cancel("doc", operation.id)
	oracle(cold, source)
})
test("previously unknown child revealed by its parent survives parent cancellation", () => {
	let replica = new Replica("writer")
	replica.edit("doc", "Left Right")
	replica.text("doc")
	let original = replica.prepareReplacements(
		"doc",
		[{ start: 5, remove: 0, text: "x" }],
		replica.visible("doc"),
	)
	if (!original?.insert[0]) throw Error("Missing parent")
	let peer = replica.fork("peer")
	let child = peer.prepareReplacements(
		"doc",
		[{ start: 5, remove: 0, text: "P" }],
		peer.visible("doc"),
	)
	if (!child?.insert[0]) throw Error("Missing child")
	child.insert[0].after = original.insert[0].id
	replica.apply([child])
	replica.apply([original])
	oracle(replica, "Left xPRight")
	replica.cancel("doc", original.id)
	oracle(replica, "Left PRight")
})
test("intervening metadata keeps source reconstruction and later inverse exact", () => {
	let source = "Left Right"
	let { replica, operation } = insertion(source, 5)
	replica.set("doc", "title", "Changed")
	replica.cancel("doc", operation.id)
	oracle(replica, source)
	expect(replica.fields("doc").title).toBe("Changed")
})
test("all prepared replicas retain their own exact cursor removal proof", () => {
	let replica = new Replica("writer")
	replica.edit("doc", "Left Right")
	replica.text("doc")
	let second = replica.fork()
	let replacements = [{ start: 5, remove: 0, text: "x" }]
	let operation = replica.prepareReplacements(
		"doc",
		replacements,
		replica.visible("doc"),
	)
	let other = second.prepareReplacements(
		"doc",
		replacements,
		second.visible("doc"),
	)
	if (!operation || !other) throw Error("Missing insertion")
	Replica.applyTogether([replica, second], [operation])
	let beforeFirst = replica.visible("doc"),
		beforeSecond = second.visible("doc")
	expect(beforeFirst).not.toBe(beforeSecond)
	let staged = replica.fork()
	let undo = staged.cancel("doc", operation.id)
	Replica.applyTogether([replica, second], [undo])
	oracle(replica, "Left Right")
	oracle(second, "Left Right")
	expect(
		insertionRemovalPosition(
			beforeFirst,
			replica.visible("doc"),
			operation.insert[0]?.id ?? "",
		),
	).toBe(5)
	expect(
		insertionRemovalPosition(
			beforeSecond,
			second.visible("doc"),
			operation.insert[0]?.id ?? "",
		),
	).toBe(5)
})
for (let value of ["\ud800", "\udc00"])
	test(
		"malformed UTF16 insertion and its inverse preserve exact source " +
			value.charCodeAt(0),
		() => {
			let replica = new Replica("writer")
			replica.edit("doc", "Left Right")
			expect(() =>
				replica.prepareReplacements(
					"doc",
					[{ start: 5, remove: 0, text: value }],
					replica.visible("doc"),
				),
			).toThrow("Unicode")
			oracle(replica, "Left Right")
		},
	)
test("peer cancellation uses validated inverse and reconstructs the same source", () => {
	let { replica, operation } = insertion("Left Right", 5)
	let peer = replica.fork("peer")
	let cancel = peer.cancel("doc", operation.id)
	replica.apply([cancel])
	oracle(replica, "Left Right")
})
test("a cancellation received before its target cannot publish an inactive inverse", () => {
	let { replica, operation, edited } = insertion("Left Right", 5)
	let staged = replica.fork()
	let undo = staged.cancel("doc", operation.id)
	let peer = staged.fork("peer")
	let counter = peer.cancel("doc", undo.id)
	replica.apply([counter])
	expect(replica.text("doc")).toBe(edited)
	replica.apply([undo])
	oracle(replica, edited)
})
test("mixed known acknowledgement and new metadata preserve reconstruction", () => {
	let { replica, operation, after } = insertion("Left Right", 5)
	let peer = replica.fork("peer")
	let metadata = peer.set("doc", "title", "Peer title")
	replica.apply([operation, metadata])
	replica.cancel("doc", operation.id)
	oracle(replica, "Left Right")
	expect(replica.fields("doc").title).toBe("Peer title")
	expect(
		insertionRemovalPosition(
			after,
			replica.visible("doc"),
			operation.insert[0]?.id ?? "",
		),
	).toBeUndefined()
})
