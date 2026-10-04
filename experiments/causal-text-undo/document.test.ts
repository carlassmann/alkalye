import { expect, test } from "bun:test"
import { Replica } from "../../src/shared/crdt"
import { CausalText } from "./document"
import { frontmatter, withFrontmatter } from "../../src/shared/markdown"

function materialize(document: CausalText, actor = "experiment") {
	let oracle = document.materialize(actor)
	expect(document.materializeWithVisibility(actor).visible("document")).toEqual(
		oracle.visible("document"),
	)
	return oracle
}
function setup(source: string) {
	let writer = new Replica("writer")
	let initial = writer.edit("document", source)
	if (!initial) throw new Error("Fixture needs initial source")
	let document = new CausalText("document")
	document.append(initial)
	return { document, writer }
}
function edit(document: CausalText, actor: string, source: string) {
	let replica = materialize(document, actor)
	let operation = replica.edit("document", source)
	if (!operation) throw new Error("Fixture needs a text change")
	return operation
}
function cancel(document: CausalText, actor: string, original: string) {
	let operation = materialize(document, actor).create("document", "text")
	document.append(operation, original)
	return operation
}

test("undoing an insertion preserves peer text anchored inside that insertion", () => {
	let { document } = setup("AB")
	let own = edit(document, "own", "AxyB")
	document.append(own)
	document.append(edit(document, "peer", "Ax!yB"))
	cancel(document, "undo", own.id)
	expect(materialize(document).text("document")).toBe("A!B")
})

test("undoing one of two concurrent deletions cannot restore peer-deleted characters", () => {
	let { document } = setup("ABC")
	let own = edit(document, "own", "AC")
	let peer = edit(document, "peer", "AC")
	document.append(own)
	document.append(peer)
	cancel(document, "undo", own.id)
	expect(materialize(document).text("document")).toBe("AC")
	cancel(document, "peer-undo", peer.id)
	expect(materialize(document).text("document")).toBe("ABC")
})

test("redo cancels only its own undo and leaves another concurrent undo effective", () => {
	let { document } = setup("AB")
	let own = edit(document, "own", "AxyB")
	document.append(own)
	let first = cancel(document, "first", own.id)
	let second = cancel(document, "second", own.id)
	cancel(document, "redo-first", first.id)
	expect(materialize(document).text("document")).toBe("AB")
	cancel(document, "redo-second", second.id)
	expect(materialize(document).text("document")).toBe("AxyB")
})

test("replacement undo restores original identities, preserves peer insertions, and redo reverses it", () => {
	let { document } = setup("ABC")
	let originalIds = materialize(document)
		.visible("document")
		.map(atom => atom.id)
	let own = edit(document, "own", "AXC")
	document.append(own)
	document.append(edit(document, "peer", "AX!C"))
	let undo = cancel(document, "undo", own.id)
	expect(materialize(document).text("document")).toBe("A!BC")
	expect(
		materialize(document)
			.visible("document")
			.find(atom => atom.value === "B")?.id,
	).toBe(originalIds[1])
	cancel(document, "redo", undo.id)
	expect(materialize(document).text("document")).toBe("AX!C")
})

test("cold snapshots retain cancellation and deletion attribution without event bodies", () => {
	let { document } = setup("ABC")
	let deletion = edit(document, "own", "AC")
	document.append(deletion)
	let undo = cancel(document, "undo", deletion.id)
	let restored = new CausalText("document")
	restored.restore(JSON.parse(JSON.stringify(document.checkpoint())))
	expect(materialize(restored).text("document")).toBe("ABC")
	cancel(restored, "redo", undo.id)
	expect(materialize(restored).text("document")).toBe("AC")
	expect(
		restored
			.checkpoint()
			.contributions.every(
				contribution =>
					!Reflect.has(contribution, "label") &&
					!Reflect.has(contribution, "time"),
			),
	).toBe(true)
})

test("frontmatter cancellation preserves another writer's independently changed key", () => {
	let { document } = setup("---\ntitle: Before\npath: Original\n---\nBody")
	let own = edit(
		document,
		"own",
		"---\ntitle: After\npath: Original\n---\nBody",
	)
	document.append(own)
	document.append(
		edit(document, "peer", "---\ntitle: After\npath: Peer\n---\nBody"),
	)
	cancel(document, "undo", own.id)
	expect(materialize(document).text("document")).toBe(
		"---\ntitle: Before\npath: Peer\n---\nBody",
	)
})

test("an immutable retry cannot reapply or replace an existing contribution", () => {
	let { document } = setup("AB")
	let operation = edit(document, "own", "AXB")
	document.append(operation)
	let before = document.checkpoint()
	document.append(operation)
	expect(document.checkpoint()).toEqual(before)
	expect(() =>
		document.append({
			...operation,
			insert: operation.insert.map(atom => ({ ...atom, value: "Y" })),
		}),
	).toThrow("immutable")
	expect(document.checkpoint()).toEqual(before)
})

test("unknown or same-operation cancellation fails without changing the snapshot", () => {
	let { document } = setup("AB")
	let operation = materialize(document, "bad").create("document", "text")
	let before = document.checkpoint()
	expect(() => document.append(operation, "0000000000000001:missing")).toThrow(
		"earlier accepted",
	)
	expect(() => document.append(operation, operation.id)).toThrow(
		"earlier accepted",
	)
	expect(document.checkpoint()).toEqual(before)
})

test("a long undo/redo chain uses iterative evaluation", () => {
	let { document } = setup("AB")
	let own = edit(document, "own", "AXB")
	document.append(own)
	let id = own.id
	for (let index = 0; index < 2000; index++) {
		let replica = new Replica("chain")
		replica.clock = 100 + index
		let operation = replica.create("document", "text")
		document.append(operation, id)
		id = operation.id
	}
	expect(materialize(document).text("document")).toBe("AXB")
})

test("reordered concurrent delivery and independent cancellations converge", () => {
	let { document } = setup("ABC")
	let base = document.checkpoint()
	let first = edit(document, "alice", "AC")
	let second = edit(document, "bob", "AC")
	let insertion = edit(document, "charlie", "AB!C")
	let orders = [
		[first, second, insertion],
		[insertion, second, first],
		[second, first, insertion],
		[first, insertion, second],
	]
	let snapshots = orders.map(operations => {
		let replica = new CausalText("document")
		replica.restore(base)
		for (let operation of operations) replica.append(operation)
		cancel(replica, "undo-alice", first.id)
		expect(materialize(replica).text("document")).toBe("A!C")
		return materialize(replica).visible("document")
	})
	let expected = snapshots[0]
	if (!expected) throw new Error("Missing delivery result")
	for (let snapshot of snapshots) expect(snapshot).toEqual(expected)
})

test("malformed snapshot provenance, clocks and anchor cycles cannot replace live state", () => {
	let { document } = setup("ABC")
	let original = document.checkpoint()
	let duplicate = document.checkpoint()
	let first = duplicate.contributions[0]
	if (!first) throw new Error("Missing first contribution")
	expect(() =>
		document.restore({
			...duplicate,
			contributions: [...duplicate.contributions, first],
		}),
	).toThrow("Duplicate")
	let missing = document.checkpoint()
	expect(() =>
		document.restore({
			...missing,
			contributions: missing.contributions.map((contribution, index) =>
				index === 0
					? { ...contribution, insert: contribution.insert.slice(0, -1) }
					: contribution,
			),
		}),
	).toThrow("omits insertion provenance")
	let lowClock = document.checkpoint()
	expect(() => document.restore({ ...lowClock, clock: 0 })).toThrow("clock")
	let cycle = document.checkpoint()
	let atom = cycle.atoms[0],
		last = cycle.atoms.at(-1)
	if (!atom || !last) throw new Error("Missing cycle atoms")
	expect(() =>
		document.restore({
			...cycle,
			atoms: cycle.atoms.map((atom, index) =>
				index === 0 ? { ...atom, after: last.id } : atom,
			),
		}),
	).toThrow("anchor cycle")
	expect(document.checkpoint()).toEqual(original)
})

test("header creation cancellation leaves an intervening body edit and redo restores its metadata", () => {
	let { document } = setup("Body")
	let header = edit(document, "own", "---\ntitle: New\n---\nBody")
	document.append(header)
	document.append(edit(document, "peer", "---\ntitle: New\n---\nBody!"))
	let undo = cancel(document, "undo", header.id)
	expect(materialize(document).text("document")).toBe("Body!")
	cancel(document, "redo", undo.id)
	expect(materialize(document).text("document")).toBe(
		"---\ntitle: New\n---\nBody!",
	)
})

test("header removal cancellation restores metadata without overwriting peer body edits", () => {
	let { document } = setup("---\ntitle: Original\n---\nBody")
	let removal = edit(document, "own", "Body")
	document.append(removal)
	document.append(edit(document, "peer", "Body!"))
	cancel(document, "undo", removal.id)
	expect(materialize(document).text("document")).toBe(
		"---\ntitle: Original\n---\nBody!",
	)
})

test("different actors at the same clock cannot cancel one another", () => {
	let { document } = setup("AB")
	let own = edit(document, "alice", "AXB")
	let invalid = materialize(document, "zebra").create("document", "text")
	document.append(own)
	let before = document.checkpoint()
	expect(() => document.append(invalid, own.id)).toThrow("earlier accepted")
	expect(document.checkpoint()).toEqual(before)
	expect(() =>
		document.restore({
			...before,
			contributions: [
				...before.contributions,
				{ id: invalid.id, insert: [], remove: [], cancel: own.id },
			],
		}),
	).toThrow("Invalid snapshot cancellation")
	expect(document.checkpoint()).toEqual(before)
})

test("cancelling a complete header edit preserves peer keys and unkeyed header content", () => {
	let { document } = setup(
		"---\n# Metadata\ntitle: Before\npath: Old\n---\nBody",
	)
	let own = edit(
		document,
		"own",
		"---\n# Changed metadata\ntitle: After\npath: Own\n---\nBody",
	)
	document.append(own)
	document.append(
		edit(
			document,
			"peer",
			"---\n# Changed metadata\ntitle: After\npath: Peer\n---\nBody",
		),
	)
	let undo = cancel(document, "undo", own.id)
	expect(materialize(document).text("document")).toBe(
		"---\n# Metadata\ntitle: Before\npath: Peer\n---\nBody",
	)
	cancel(document, "redo", undo.id)
	expect(materialize(document).text("document")).toBe(
		"---\n# Changed metadata\ntitle: After\npath: Peer\n---\nBody",
	)
})

test("undoing a header edit preserves a peer's later edit to the same key", () => {
	let { document } = setup("---\ntitle: Before\npath: Folder\n---\nBody")
	let own = edit(document, "own", "---\ntitle: Own\npath: Folder\n---\nBody")
	document.append(own)
	document.append(
		edit(document, "peer", "---\ntitle: Peer\npath: Folder\n---\nBody"),
	)
	let undo = cancel(document, "undo", own.id)
	expect(materialize(document).text("document")).toBe(
		"---\ntitle: Peer\npath: Folder\n---\nBody",
	)
	cancel(document, "redo", undo.id)
	expect(materialize(document).text("document")).toBe(
		"---\ntitle: Peer\npath: Folder\n---\nBody",
	)
})

test("undoing header creation retains metadata subsequently introduced by a peer", () => {
	let { document } = setup("Body")
	let own = edit(document, "own", "---\ntitle: Own\n---\nBody")
	document.append(own)
	document.append(
		edit(document, "peer", "---\ntitle: Own\npath: Peer\n---\nBody"),
	)
	let undo = cancel(document, "undo", own.id)
	expect(materialize(document).text("document")).toBe(
		"---\npath: Peer\n---\nBody",
	)
	cancel(document, "redo", undo.id)
	expect(materialize(document).text("document")).toBe(
		"---\ntitle: Own\npath: Peer\n---\nBody",
	)
})

test("undoing header removal preserves a subsequently recreated peer header", () => {
	let { document } = setup("---\ntitle: Before\npath: Original\n---\nBody")
	let own = edit(document, "own", "Body")
	document.append(own)
	document.append(edit(document, "peer", "---\ntitle: Peer\n---\nBody"))
	let undo = cancel(document, "undo", own.id)
	expect(materialize(document).text("document")).toBe(
		"---\ntitle: Peer\npath: Original\n---\nBody",
	)
	cancel(document, "redo", undo.id)
	expect(materialize(document).text("document")).toBe(
		"---\ntitle: Peer\n---\nBody",
	)
})

test("seeded real edits round-trip exact text and identities through cancellation and redo", () => {
	for (let seed = 1; seed <= 100; seed++) {
		let random = seed
		function nextRandom() {
			random = (Math.imul(random, 1664525) + 1013904223) >>> 0
			return random
		}
		let { document } = setup("Body")
		let history: string[] = []
		for (let step = 0; step < 30; step++) {
			let before = materialize(document),
				source = before.text("document")
			let body = frontmatter(source).body
			let candidates = [
				source + ([" ", "a", "b", "c", "😀"][nextRandom() % 5] ?? "a"),
				source + "\n---\n",
				withFrontmatter(source, { title: "Title " + step }),
				withFrontmatter(source, { path: "Folder " + (nextRandom() % 3) }),
				withFrontmatter(source, { title: undefined }),
				body,
				"---\n# Header " +
					step +
					"\ntitle: Draft " +
					step +
					"\npath: Writing\n---\n" +
					body,
				"---\nk: v" + step + "\n---\n" + body,
				body ? Array.from(body).slice(0, -1).join("") : "Body",
			]
			let next = candidates[nextRandom() % candidates.length]
			if (next === undefined || next === source) continue
			let actor = ["alice", "bob", "charlie"][nextRandom() % 3] ?? "alice"
			let change = edit(document, actor, next)
			document.append(change)
			let after = materialize(document)
			let undo = cancel(document, actor, change.id)
			let undone = materialize(document)
			expect(undone.text("document")).toBe(source)
			expect(undone.visible("document")).toEqual(before.visible("document"))
			let redo = cancel(document, actor, undo.id)
			let redone = materialize(document)
			expect(redone.text("document")).toBe(after.text("document"))
			expect(redone.visible("document")).toEqual(after.visible("document"))
			history.push(change.id, undo.id, redo.id)
			if (nextRandom() % 4 === 0) {
				let target = history[nextRandom() % history.length]
				if (target) {
					let other = cancel(document, actor, target)
					history.push(other.id)
					materialize(document)
				}
			}
			if (step % 10 === 0) {
				let cold = new CausalText("document")
				cold.restore(JSON.parse(JSON.stringify(document.checkpoint())))
				expect(materialize(cold).visible("document")).toEqual(
					materialize(document).visible("document"),
				)
				document = cold
			}
		}
	}
}, 30000)
