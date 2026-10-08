import { expect, test } from "bun:test"
import { Replica } from "../src/shared/crdt"
import { documentMetadata } from "../src/shared/document-metadata"

function joined(source: string) {
	let first = new Replica("first")
	let second = new Replica("second")
	let initial = first.edit("doc", source)
	if (!initial) throw Error("Missing initial text")
	second.apply([initial])
	first.text("doc")
	second.text("doc")
	return { first, second }
}
function rebuilt(replica: Replica) {
	let restored = new Replica("restored")
	restored.restore(replica.checkpoint())
	expect(replica.text("doc")).toBe(restored.text("doc"))
	expect(replica.visible("doc")).toEqual(restored.visible("doc"))
	expect(documentMetadata(replica.text("doc"))).toEqual(
		documentMetadata(restored.text("doc")),
	)
	return replica.text("doc")
}
for (let source of [
	"Body",
	"Body😀",
	"---\ntitle: Shared\n---\nBody",
	"---\ntitle: Shared\n---\nBody😀",
	"---\ntitle: Shared\n---\n" + "z".repeat(65536),
])
	test(
		"two writers append and remove terminal body scalar " + source.length,
		() => {
			let { first, second } = joined(source)
			let appended = second.edit("doc", source + "🌻")
			if (!appended) throw Error("Missing peer append")
			first.apply([appended])
			expect(rebuilt(first)).toBe(source + "🌻")
			let removed = first.edit("doc", source)
			if (!removed) throw Error("Missing peer removal")
			second.apply([removed])
			expect(rebuilt(second)).toBe(source)
			first.apply([appended, removed])
			expect(rebuilt(first)).toBe(source)
		},
	)
test("prearrived orphan subtree is revealed with incoming parent", () => {
	let { first, second } = joined("Body")
	let parent = second.edit("doc", "BodyX")
	let child = second.edit("doc", "BodyXY")
	if (!parent || !child) throw Error("Missing peer edits")
	first.apply([child])
	expect(first.text("doc")).toBe("Body")
	first.apply([parent])
	expect(rebuilt(first)).toBe("BodyXY")
})
for (let kind of ["remove", "cancel"])
	test("prearrived " + kind + " keeps incoming scalar hidden", () => {
		let { first, second } = joined("Body")
		let appended = second.edit("doc", "BodyX")
		if (!appended) throw Error("Missing peer append")
		let hidden =
			kind === "cancel"
				? second.cancel("doc", appended.id)
				: second.edit("doc", "Body")
		if (!hidden) throw Error("Missing peer removal")
		first.apply([hidden])
		first.text("doc")
		first.apply([appended])
		expect(rebuilt(first)).toBe("Body")
	})
test("cancelled prearrived remover permits later incoming scalar", () => {
	let { first, second } = joined("Body")
	let appended = second.edit("doc", "BodyX")
	let removed = second.edit("doc", "Body")
	if (!appended || !removed) throw Error("Missing peer edits")
	let cancelled = second.cancel("doc", removed.id)
	first.apply([removed, cancelled])
	first.text("doc")
	first.apply([appended])
	expect(rebuilt(first)).toBe("BodyX")
})
test("checkpoint indexed identity redelivery preserves warm body", () => {
	let { first, second } = joined("---\ntitle: Shared\n---\nBody")
	let appended = second.edit("doc", second.text("doc") + "X")
	if (!appended) throw Error("Missing append")
	first.apply([appended])
	let restored = new Replica("reader")
	restored.restore(first.checkpoint())
	let source = restored.text("doc")
	restored.apply([appended])
	expect(rebuilt(restored)).toBe(source)
})
test("conflicting identity rejects entire multi-replica publication", () => {
	let { first, second } = joined("Body")
	let appended = second.edit("doc", "BodyX")
	if (!appended) throw Error("Missing append")
	let before = first.checkpoint()
	expect(() =>
		Replica.applyTogether(
			[first, second],
			[{ ...appended, author: "conflict" }],
		),
	).toThrow()
	expect(first.checkpoint()).toEqual(before)
	expect(rebuilt(first)).toBe("Body")
})
for (let source of [
	"Body\n---x",
	"---\ntitle: Shared\n---\nx",
	"Body\n---",
	"Body\r---x",
	"Body\u2028---x",
])
	test(
		"terminal removal preserves structural projection " +
			JSON.stringify(source),
		() => {
			let { first, second } = joined(source)
			let removed = second.edit("doc", second.text("doc").slice(0, -1))
			if (!removed) throw Error("Missing removal")
			first.apply([removed])
			expect(rebuilt(first)).toBe(rebuilt(second))
		},
	)
test("concurrent header edits retain independently projected body offsets", () => {
	let { first, second } = joined("---\ntitle: Initial\n---\nBody")
	let left = first.edit("doc", "---\ntitle: Left longer\n---\nBody")
	let right = second.edit(
		"doc",
		"---\ntitle: Right\ntags: [one, two]\n---\nBody",
	)
	if (!left || !right) throw Error("Missing header edits")
	first.apply([right])
	second.apply([left])
	let source = first.text("doc")
	expect(source).toBe(second.text("doc"))
	let appended = second.edit("doc", source + "😀")
	if (!appended) throw Error("Missing body append")
	first.apply([appended])
	expect(rebuilt(first)).toBe(source + "😀")
	let removed = first.edit("doc", source)
	if (!removed) throw Error("Missing body removal")
	second.apply([removed])
	expect(rebuilt(second)).toBe(source)
})
test("concurrent root header completion does not cache a truncated source", () => {
	let body = new Replica("zzbody")
	let bodyEdit = body.edit("doc", "Hello")
	let header = new Replica("aaheader")
	let headerEdit = header.create("doc", "text")
	let after = ""
	for (let value of "---\na: b\n---") {
		let id =
			headerEdit.id + ":" + String(headerEdit.insert.length).padStart(8, "0")
		headerEdit.insert.push({ id, after, value })
		after = id
	}
	header.apply([headerEdit])
	let tail = header.create("doc", "text")
	tail.insert = [{ id: tail.id + ":00000000", after, value: "x" }]
	header.apply([tail])
	if (!bodyEdit) throw Error("Missing body")
	let reader = new Replica("reader")
	reader.apply([bodyEdit, headerEdit, tail])
	let before = reader.text("doc")
	let removal = header.create("doc", "text")
	removal.remove = [tail.insert[0]?.id ?? ""]
	reader.apply([removal])
	expect(rebuilt(reader)).not.toBe(before.slice(0, -1))
})
test("malformed incoming suffix is rejected atomically", () => {
	let { first, second } = joined("Body")
	let appended = second.edit("doc", "BodyX")
	if (!appended) throw Error("Missing append")
	appended.clock = 0
	let before = first.checkpoint()
	expect(() => first.apply([appended])).toThrow()
	expect(first.checkpoint()).toEqual(before)
	expect(rebuilt(first)).toBe("Body")
})
test("prearrived cancellation keeps terminal removal inactive", () => {
	let { first, second } = joined("BodyX")
	let removed = second.edit("doc", "Body")
	if (!removed) throw Error("Missing removal")
	let cancellation = second.create("doc", "cancel")
	cancellation.value = removed.id
	first.apply([cancellation])
	first.text("doc")
	first.apply([removed])
	expect(rebuilt(first)).toBe("BodyX")
})
test("legacy checkpoint tail remains correct through remote append and removal", () => {
	let { first } = joined("Body😀")
	let checkpoint = first.checkpoint()
	let reader = new Replica("legacy")
	reader.restore({
		format: "alkalye-state-v1",
		clock: checkpoint.clock,
		restored: checkpoint.restored,
		targets: checkpoint.targets.map(target => ({
			id: target.id,
			created: target.created,
			updated: target.updated,
			atoms: target.atoms,
			fields: target.fields,
			removed: [],
		})),
	})
	let writer = new Replica("writer")
	writer.restore(reader.checkpoint())
	let source = reader.text("doc")
	let appended = writer.edit("doc", source + "X")
	if (!appended) throw Error("Missing append")
	reader.apply([appended])
	expect(rebuilt(reader)).toBe(source + "X")
	let removed = writer.edit("doc", source)
	if (!removed) throw Error("Missing removal")
	reader.apply([removed])
	expect(rebuilt(reader)).toBe(source)
})
