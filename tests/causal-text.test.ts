import { expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import { Replica } from "../src/shared/crdt"
import { compactCheckpoint, parseCheckpoint } from "../src/shared/checkpoint"
import {
	parseOperation,
	expandDeletions,
	compactOperation,
} from "../src/shared/model"
import type { Operation } from "../src/shared/model"
import { TextVisibility } from "../src/shared/text-visibility"
import { validateTextCausality } from "../src/shared/document-causality"
import { CausalText } from "../experiments/causal-text-undo/document"

function setup(source = "ABC") {
	let replica = new Replica("writer")
	let initial = replica.edit("document", source)
	if (!initial) throw new Error("Fixture needs source")
	return { replica, initial }
}
function reopen(replica: Replica, actor = "cold") {
	let restored = new Replica(actor)
	restored.restore(
		parseCheckpoint(
			JSON.parse(JSON.stringify(compactCheckpoint(replica.checkpoint()))),
		),
	)
	return restored
}
function edit(replica: Replica, actor: string, source: string) {
	let staged = reopen(replica, actor)
	let operation = staged.edit("document", source)
	if (!operation) throw new Error("Fixture needs a change")
	return operation
}
function legacy(replica: Replica) {
	let snapshot = replica.checkpoint()
	return {
		...snapshot,
		format: "alkalye-state-v1",
		targets: snapshot.targets.map(target => ({
			id: target.id,
			created: target.created,
			updated: target.updated,
			atoms: target.atoms,
			fields: target.fields,
			removed: target.visibility.removals.flatMap(([, runs]) =>
				expandDeletions(runs),
			),
		})),
	}
}

test("causal undo and redo preserve a peer anchored inside the cancelled insertion", () => {
	let { replica } = setup("AB")
	let own = edit(replica, "own", "AxyB")
	replica.apply([own])
	replica.apply([edit(replica, "peer", "Ax!yB")])
	let undo = replica.cancel("document", own.id)
	expect(replica.text("document")).toBe("A!B")
	replica.cancel("document", undo.id)
	expect(replica.text("document")).toBe("Ax!yB")
})

test("each deletion retains its owner so undo cannot resurrect a peer's deletion", () => {
	let { replica } = setup()
	let first = edit(replica, "alice", "AC"),
		second = edit(replica, "bob", "AC")
	replica.apply([first, second])
	replica.cancel("document", first.id)
	expect(replica.text("document")).toBe("AC")
	let restored = reopen(replica)
	expect(restored.canCancel("document", second.id)).toBe(true)
	restored.cancel("document", second.id)
	expect(restored.text("document")).toBe("ABC")
})

test("redo cannot restore the part of an insertion subsequently deleted by a peer", () => {
	let { replica } = setup("AB")
	let own = edit(replica, "own", "AxyB")
	replica.apply([own])
	replica.apply([edit(replica, "peer", "AyB")])
	let undo = replica.cancel("document", own.id)
	expect(replica.text("document")).toBe("AB")
	replica.cancel("document", undo.id)
	expect(replica.text("document")).toBe("AyB")
})

test("cold snapshots support undo and redo without any historical text operations", () => {
	let { replica } = setup()
	let deletion = edit(replica, "own", "AC")
	replica.apply([deletion])
	let before = replica.visible("document")
	let cold = reopen(replica)
	expect(cold.operations.size).toBe(0)
	let undo = cold.cancel("document", deletion.id)
	expect(cold.text("document")).toBe("ABC")
	let again = reopen(cold)
	expect(again.hasTextOperation("document", undo.id)).toBe(true)
	again.cancel("document", undo.id)
	expect(again.visible("document")).toEqual(before)
})

test("replacement cancellation restores original identities after a cold reopen", () => {
	let { replica } = setup()
	let before = replica.visible("document")
	let change = edit(replica, "own", "AXC")
	replica.apply([change])
	let cold = reopen(replica)
	cold.cancel("document", change.id)
	expect(cold.visible("document")).toEqual(before)
})

test("historical views use only facts at that version and hydration does not change current state", () => {
	let { replica } = setup("AB")
	let own = replica.edit("document", "AXB")
	if (!own) throw new Error("Missing insertion")
	let undo = replica.cancel("document", own.id)
	let redo = replica.cancel("document", undo.id)
	let cold = reopen(replica)
	expect(() => cold.text("document", undo.id)).toThrow("Load history")
	let revision = cold.revision("document")
	cold.apply([...replica.operations.values()].reverse())
	cold.historyLoaded = true
	expect(cold.text("document", own.id)).toBe("AXB")
	expect(cold.text("document", undo.id)).toBe("AB")
	expect(cold.text("document", redo.id)).toBe("AXB")
	expect(cold.revision("document")).toBe(revision)
})

test("a cancelled contribution changes revision even when a peer deletion keeps visible text unchanged", () => {
	let { replica } = setup()
	let first = edit(replica, "alice", "AC"),
		second = edit(replica, "bob", "AC")
	replica.apply([first, second])
	let revision = replica.revision("document")
	replica.cancel("document", first.id)
	expect(replica.text("document")).toBe("AC")
	expect(replica.revision("document")).not.toBe(revision)
})

test("a conflicting suffix cannot partly apply registers or cancellation facts", () => {
	let { replica, initial } = setup()
	let staged = reopen(replica, "prefix")
	let prefix = staged.set("document", "note", "Must not save")
	let forged = {
		...initial,
		insert: initial.insert.map((atom, index) =>
			index ? atom : { ...atom, value: "X" },
		),
	}
	let before = replica.checkpoint()
	expect(() => replica.apply([prefix, forged])).toThrow("immutable")
	expect(replica.checkpoint()).toEqual(before)
	let cold = reopen(replica)
	expect(() => cold.apply([prefix, forged])).toThrow("immutable")
	expect(cold.checkpoint()).toEqual(before)
})

test("identical covered operations hydrate once, while changed empty-removal provenance fails", () => {
	let { replica, initial } = setup()
	let cold = reopen(replica)
	let before = cold.checkpoint()
	cold.apply([initial, initial])
	expect(cold.operations.size).toBe(1)
	expect(cold.checkpoint()).toEqual(before)
	let another = reopen(replica)
	let atom = initial.insert[0]
	if (!atom) throw new Error("Missing atom")
	expect(() => another.apply([{ ...initial, remove: [atom.id] }])).toThrow(
		"immutable",
	)
	expect(another.checkpoint()).toEqual(before)
})

test("a covered delete-only operation cannot lose or change its removal set", () => {
	let { replica } = setup()
	let deletion = replica.edit("document", "AC")
	if (!deletion) throw new Error("Missing deletion")
	let cold = reopen(replica),
		before = cold.checkpoint()
	cold.apply([deletion])
	expect(cold.checkpoint()).toEqual(before)
	expect(() => cold.apply([{ ...deletion, remove: [] }])).toThrow("immutable")
	expect(cold.checkpoint()).toEqual(before)
})

test("new snapshot merges retain local text and both cancellation branches", () => {
	let { replica } = setup("AB")
	let own = replica.edit("document", "AXB")
	if (!own) throw new Error("Missing insertion")
	let left = reopen(replica, "left"),
		right = reopen(replica, "right")
	left.cancel("document", own.id)
	let second = right.cancel("document", own.id)
	right.cancel("document", second.id)
	left.restore(right.checkpoint())
	expect(left.text("document")).toBe("AB")
	let merged = reopen(left)
	expect(merged.revision("document")).toBe(left.revision("document"))
})

test("legacy snapshots retain permanent deletions and block old text undo", () => {
	let { replica } = setup()
	let deletion = replica.edit("document", "AC")
	if (!deletion) throw new Error("Missing deletion")
	let old = new Replica("migrated")
	old.restore(parseCheckpoint(legacy(replica)))
	expect(old.text("document")).toBe("AC")
	expect(old.canCancel("document", deletion.id)).toBe(false)
	expect(() => old.cancel("document", deletion.id)).toThrow("migration floor")
	let later = old.edit("document", "A")
	if (!later) throw new Error("Missing later deletion")
	let cold = reopen(old)
	cold.cancel("document", later.id)
	expect(cold.text("document")).toBe("AC")
	expect(cold.checkpoint().targets[0]?.visibility.floor).toBe(replica.clock)
})

test("an accepted cancellation prevents a late legacy snapshot from raising its floor", () => {
	let { replica } = setup()
	let own = replica.edit("document", "AXC")
	if (!own) throw new Error("Missing replacement")
	let old = legacy(replica)
	replica.cancel("document", own.id)
	let before = replica.checkpoint()
	expect(() => replica.restore(parseCheckpoint(old))).toThrow("migration floor")
	expect(replica.checkpoint()).toEqual(before)
})

test("frontmatter undo preserves peer metadata, and metadata always follows the source", () => {
	let { replica } = setup("---\ntitle: Before\npath: Original\n---\nBody")
	let own = edit(replica, "own", "---\ntitle: After\npath: Original\n---\nBody")
	replica.apply([own])
	replica.apply([
		edit(replica, "peer", "---\ntitle: After\npath: Peer\n---\nBody"),
	])
	let cold = reopen(replica)
	let undo = cold.cancel("document", own.id)
	expect(cold.metadata("document").title).toBe("Before")
	expect(cold.metadata("document").path).toBe("Peer")
	cold.cancel("document", undo.id)
	expect(cold.metadata("document").title).toBe("After")
	expect(cold.metadata("document").path).toBe("Peer")
})

test("checkpoint deletion runs retain ownership without repeating every identity", () => {
	let { replica } = setup("x".repeat(10000))
	let deletion = replica.edit("document", "")
	if (!deletion) throw new Error("Missing deletion")
	let visibility = replica.checkpoint().targets[0]?.visibility
	let firstRemoved = deletion.remove[0]
	if (!firstRemoved) throw new Error("Missing first deletion")
	if (!visibility) throw new Error("Missing provenance")
	expect(visibility.removals).toEqual([
		[deletion.id, [{ id: firstRemoved, count: 10000 }]],
	])
	expect(JSON.stringify(visibility).length).toBeLessThan(250)
	let cold = reopen(replica)
	cold.cancel("document", deletion.id)
	expect(cold.text("document")).toBe("x".repeat(10000))
})

test("malformed snapshot cancellation targets and operation ownership fail before restore", () => {
	let { replica, initial } = setup()
	let snapshot = replica.checkpoint(),
		target = snapshot.targets[0]
	if (!target) throw new Error("Missing target")
	let cancelId = "0000000000000002:cancel"
	for (let original of ["0000000000000001:absent", cancelId])
		expect(() =>
			parseCheckpoint({
				...snapshot,
				clock: 2,
				targets: [
					{
						...target,
						visibility: {
							...target.visibility,
							cancels: [[cancelId, original]],
						},
					},
				],
			}),
		).toThrow("cancellation")
	let first = initial.insert[0]
	if (!first) throw new Error("Missing insertion")
	expect(() =>
		parseCheckpoint({
			...snapshot,
			targets: [
				...snapshot.targets,
				{
					...target,
					id: "other",
					atoms: [{ ...first, id: initial.id + ":99999999", after: "" }],
				},
			],
		}),
	).toThrow("identity")
	expect(() => parseCheckpoint({ ...snapshot, clock: 0 })).toThrow("clock")
	expect(replica.checkpoint()).toEqual(snapshot)
})

test("snapshot copies cannot mutate live atom metadata or winning registers", () => {
	let { replica } = setup("---\ntitle: Original\n---\nBody")
	replica.set("document", "note", "Saved")
	let before = replica.revision("document"),
		detached = replica.checkpoint()
	let target = detached.targets[0],
		atom = target?.atoms[0],
		field = target?.fields[0]
	if (!atom || !field) throw new Error("Missing state")
	atom.value = "X"
	field.value = "Changed"
	if (atom.order) Reflect.set(atom.order, "0", "wrong")
	expect(replica.revision("document")).toBe(before)
	expect(replica.fields("document").note).toBe("Saved")
})

test("cancellation dependency validation requires known same-target text even after snapshot reopening", async () => {
	let { replica, initial } = setup()
	let cold = reopen(replica),
		cancelled = cold.cancel("document", initial.id)
	for (let invalid of [
		{ ...cancelled, value: "0000000000000001:unknown" },
		{ ...cancelled, target: "another" },
	]) {
		let result = await Effect.runPromise(
			validateTextCausality(reopen(replica), "document", [invalid]).pipe(
				Effect.result,
			),
		)
		if (result._tag !== "Failure")
			throw new Error("Unknown cancellation dependency accepted")
		expect(result.failure._tag).toBe("CausalDependencyMissing")
	}
	await Effect.runPromise(
		validateTextCausality(reopen(replica), "document", [cancelled]),
	)
})

test("cancellation wire identities require a higher safe clock and no embedded text or register", () => {
	let { replica, initial } = setup()
	let cancellation = replica.cancel("document", initial.id)
	for (let invalid of [
		{ ...cancellation, value: cancellation.id },
		{ ...cancellation, field: "note" },
		{ ...cancellation, insert: initial.insert },
		{ ...cancellation, remove: [initial.insert[0]?.id ?? ""] },
		{ ...cancellation, value: "9999999999999999:unknown" },
	])
		expect(() => parseOperation(invalid)).toThrow()
})

test("oversized provenance and overflowing deletion runs fail before expansion", () => {
	let visibility = new TextVisibility()
	let before = visibility.checkpoint()
	let id = "0000000000000001:writer:00000000"
	expect(() =>
		visibility.restore({
			...before,
			legacyRemoved: [
				{ id, count: 2000000 },
				{ id, count: 2000000 },
				{ id, count: 1 },
			],
			floor: 1,
		}),
	).toThrow("four million")
	expect(() =>
		visibility.restore({
			...before,
			legacyRemoved: [{ id: id.slice(0, -8) + "99999999", count: 2 }],
			floor: 1,
		}),
	).toThrow("identity range")
	expect(visibility.checkpoint()).toEqual(before)
})

test("production visibility agrees with the independent contribution oracle through edits, cancellation and cold snapshots", () => {
	let { replica, initial } = setup("---\ntitle: Original\n---\nBody")
	let oracle = new CausalText("document")
	oracle.append(initial)
	let changes: Operation[] = []
	for (let source of [
		"---\ntitle: First\n---\nBody",
		"---\ntitle: First\npath: Peer\n---\nBody!",
		"Body!",
		"---\ntitle: New\n---\nBody!!",
	]) {
		let change = edit(replica, "writer", source)
		replica.apply([change])
		oracle.append(change)
		changes.push(change)
		expect(replica.visible("document")).toEqual(
			oracle.materialize().visible("document"),
		)
	}
	for (let change of changes.reverse()) {
		let undo = replica.cancel("document", change.id)
		oracle.append({ ...undo, kind: "text", value: "" }, undo.value)
		expect(replica.visible("document")).toEqual(
			oracle.materialize().visible("document"),
		)
		replica = reopen(replica, "writer")
	}
})

test("legacy restored aliases reject cycles rather than trapping later undo", () => {
	let { replica, initial } = setup()
	let snapshot = replica.checkpoint(),
		first = initial.insert[0],
		second = initial.insert[1]
	if (!first || !second) throw new Error("Missing aliases")
	expect(() =>
		parseCheckpoint({
			...snapshot,
			restored: [
				[first.id, second.id],
				[second.id, first.id],
			],
		}),
	).toThrow("cycle")
	expect(() =>
		parseCheckpoint({
			...snapshot,
			restored: [
				[first.id, second.id],
				[first.id, second.id],
			],
		}),
	).toThrow("Duplicate")
	expect(() =>
		parseCheckpoint({
			...snapshot,
			restored: [[first.id, "0000000000000001:unknown:00000000"]],
		}),
	).toThrow("Unknown")
})

test("deletion wire expansions are bounded and cannot overflow atom offsets", () => {
	let { initial } = setup()
	let id = initial.insert[0]?.id
	if (!id) throw new Error("Missing insertion")
	expect(() =>
		parseOperation({
			...initial,
			remove: [
				{ id, count: 2000000 },
				{ id, count: 1 },
			],
		}),
	).toThrow("identity limit")
	expect(() =>
		parseOperation({
			...initial,
			remove: [{ id: id.slice(0, -8) + "99999999", count: 2 }],
		}),
	).toThrow("identity range")
})

test("cold insertion ownership cannot gain or lose atoms through historical replay", () => {
	let { replica, initial } = setup()
	let before = replica.checkpoint()
	let extra = {
		id: `${initial.id}:00000099`,
		after: initial.insert.at(-1)?.id ?? "",
		value: "!",
	}
	for (let insert of [
		[...initial.insert, extra],
		initial.insert.slice(1),
		[...initial.insert.slice(1), extra],
	]) {
		let cold = reopen(replica)
		expect(() => cold.apply([{ ...initial, insert }])).toThrow("immutable")
		expect(cold.checkpoint()).toEqual(before)
	}
})

test("a covered deletion cannot acquire an insertion after snapshot reopening", () => {
	let { replica } = setup()
	let deletion = replica.edit("document", "AC")
	if (!deletion) throw new Error("Missing deletion")
	let cold = reopen(replica),
		before = cold.checkpoint()
	expect(() =>
		cold.apply([
			{
				...deletion,
				insert: [{ id: `${deletion.id}:00000000`, after: "", value: "!" }],
			},
		]),
	).toThrow("immutable")
	expect(cold.checkpoint()).toEqual(before)
})

test("merging snapshots cannot change an insertion owner's removal set in either direction", () => {
	let { replica, initial } = setup()
	let atom = initial.insert[0]
	if (!atom) throw new Error("Missing atom")
	let changed = replica.checkpoint(),
		target = changed.targets[0]
	if (!target) throw new Error("Missing target")
	target.visibility = {
		...target.visibility,
		removals: [...target.visibility.removals, [initial.id, [atom.id]]],
	}
	let altered = new Replica("altered")
	altered.restore(parseCheckpoint(changed))
	for (let [local, incoming] of [
		[reopen(replica), altered.checkpoint()],
		[altered, replica.checkpoint()],
	] satisfies [Replica, ReturnType<Replica["checkpoint"]>][]) {
		let before = local.checkpoint()
		expect(() => local.restore(incoming)).toThrow("immutable")
		expect(local.checkpoint()).toEqual(before)
	}
})

test("snapshot merges cannot enlarge or shrink a covered insertion", () => {
	let { replica, initial } = setup()
	let extra = { id: `${initial.id}:00000099`, after: "", value: "!" }
	for (let change of ["grow", "shrink", "replace"]) {
		let incoming = replica.checkpoint(),
			target = incoming.targets[0]
		if (!target) throw new Error("Missing target")
		if (change !== "grow") target.atoms.pop()
		if (change !== "shrink") target.atoms.push(extra)
		let local = reopen(replica),
			before = local.checkpoint()
		expect(() => local.restore(incoming)).toThrow("immutable")
		expect(local.checkpoint()).toEqual(before)
	}
})

test("restore aliases reject backward clocks before merging any state", () => {
	let { replica, initial } = setup()
	let next = replica.edit("document", "ABC!")
	let first = initial.insert[0],
		second = next?.insert[0]
	if (!first || !second) throw new Error("Missing atoms")
	let left = replica.checkpoint(),
		right = replica.checkpoint()
	left.restored = [[first.id, second.id]]
	right.restored = [[second.id, first.id]]
	let local = new Replica("aliases")
	local.restore(parseCheckpoint(left))
	let before = local.checkpoint()
	expect(() => parseCheckpoint(right)).toThrow("advance")
	expect(() => local.restore(right)).toThrow("advance")
	expect(local.checkpoint()).toEqual(before)
})

test("concurrent legacy undo restoration hints merge deterministically", () => {
	let { replica } = setup()
	let first = edit(replica, "alice", "AC"),
		second = edit(replica, "bob", "AC")
	let left = reopen(replica, "left"),
		right = reopen(replica, "right")
	left.apply([first, second])
	right.apply([second, first])
	left.inverse(first)
	right.inverse(second)
	let leftSnapshot = parseCheckpoint(left.checkpoint()),
		rightSnapshot = parseCheckpoint(right.checkpoint())
	left.restore(rightSnapshot)
	right.restore(leftSnapshot)
	expect(left.text("document")).toBe(right.text("document"))
	expect(left.checkpoint().restored).toEqual(right.checkpoint().restored)
	expect(left.revision("document")).toBe(right.revision("document"))
	expect(parseCheckpoint(left.checkpoint())).toEqual(left.checkpoint())
})

test("a hot empty text contribution cannot acquire facts through snapshot merging", () => {
	let { replica } = setup()
	let empty = replica.create("document", "text")
	replica.apply([empty])
	let before = replica.checkpoint()
	for (let kind of ["insert", "remove"]) {
		let incoming = replica.checkpoint(),
			target = incoming.targets[0]
		if (!target) throw new Error("Missing target")
		if (kind === "insert")
			target.atoms.push({ id: `${empty.id}:00000000`, after: "", value: "!" })
		else {
			let atom = target.atoms[0]
			if (!atom) throw new Error("Missing atom")
			target.visibility = {
				...target.visibility,
				removals: [[empty.id, [atom.id]]],
			}
		}
		expect(() => replica.restore(parseCheckpoint(incoming))).toThrow(
			"immutable",
		)
		expect(replica.checkpoint()).toEqual(before)
	}
})

test("hydrating migrated history preserves revision and permanent deletion marks", () => {
	let { replica } = setup()
	replica.edit("document", "AC")
	replica.edit("document", "AXC")
	let cold = new Replica("legacy")
	cold.restore(parseCheckpoint(legacy(replica)))
	let before = cold.checkpoint(),
		revision = cold.revision("document")
	cold.apply([...replica.operations.values()].reverse())
	cold.historyLoaded = true
	expect(cold.text("document")).toBe("AXC")
	expect(cold.checkpoint()).toEqual(before)
	expect(cold.revision("document")).toBe(revision)
	expect(cold.checkpoint().targets[0]?.visibility.removals).toEqual([])
})

test("a rejected legacy inverse cannot leave restoration hints or reserve a clock", () => {
	let { replica } = setup()
	let deletion = replica.edit("document", "AC")
	if (!deletion) throw new Error("Missing deletion")
	let local = reopen(replica, "invalid actor"),
		before = local.checkpoint()
	expect(() => local.inverse(deletion)).toThrow()
	expect(local.checkpoint()).toEqual(before)
	expect(parseCheckpoint(local.checkpoint())).toEqual(before)
})

test("packed checkpoints preserve causal facts, forks and legacy decoding", () => {
	let { replica } = setup("A😀BC")
	let deletion = edit(replica, "own", "A😀C")
	replica.apply([deletion])
	replica.apply([edit(replica, "peer", "A😀!C")])
	let original = replica.checkpoint()
	let packed = compactCheckpoint(original)
	expect(parseCheckpoint(JSON.parse(JSON.stringify(packed)))).toEqual(original)
	expect(parseCheckpoint(JSON.parse(JSON.stringify(original)))).toEqual(
		original,
	)
	expect(parseCheckpoint(legacy(replica)).format).toBe("alkalye-state-v1")
	let cold = reopen(replica)
	let fork = cold.fork("fork")
	fork.cancel("document", deletion.id)
	expect(fork.text("document")).toBe("A😀!BC")
	expect(cold.text("document")).toBe("A😀!C")
})

test("checkpoint hydration owns its input across restores and fork edits", () => {
	let source = "---\ntitle: Name\n---\nA😀BC"
	let { replica } = setup(source)
	let deletion = replica.edit("document", source.replace("BC", "C"))
	if (!deletion) throw Error("Missing deletion")
	for (let packed of [false, true]) {
		let raw = replica.checkpoint()
		let input = packed ? compactCheckpoint(raw) : raw
		let parsed = parseCheckpoint(input)
		let saved = JSON.stringify(parsed)
		let cold = new Replica("cold-cache")
		cold.restoreCheckpoint(input)
		let nested = input.targets[0]?.atoms.find(atom => atom.order)
		if (!nested?.order) throw Error("Missing ordered frontmatter")
		expect(Reflect.set(nested.order, "0", "changed after validation")).toBe(
			true,
		)
		expect(JSON.stringify(parsed)).toBe(saved)
		let inputAtom = input.targets[0]?.atoms[0]
		if (!inputAtom) throw Error("Missing input atom")
		expect(Reflect.set(inputAtom, "value", "Changed")).toBe(true)
		let plain = new Replica("plain-cache")
		plain.restore(structuredClone(parsed))
		expect(cold.checkpoint()).toEqual(plain.checkpoint())
		expect(cold.generation).toBe(plain.generation)
		expect(cold.canCancel("document", deletion.id)).toBe(
			plain.canCancel("document", deletion.id),
		)
		expect(cold.text("document")).toBe(replica.text("document"))
		let held = cold.visible("document")
		let fork = cold.fork("unicode-cache")
		let offset = cold.text("document").indexOf("😀") + 2
		let replacement = fork.prepareReplacements("document", [
			{ start: offset, remove: 1, text: "!" },
		])
		if (!replacement) throw Error("Missing precise fork replacement")
		fork.apply([parseOperation(compactOperation(replacement))])
		expect(fork.text("document")).toBe(source.replace("BC", "!"))
		expect(cold.text("document")).toBe(source.replace("BC", "C"))
		expect(cold.visible("document")).toBe(held)
		expect(held.map(atom => atom.value).join("")).toBe(cold.text("document"))
		cold.cancel("document", deletion.id)
		expect(cold.text("document")).toBe(source)
		expect(fork.text("document")).toBe(source.replace("BC", "!"))
		expect(JSON.stringify(parsed)).toBe(saved)
		let altered = structuredClone(parsed)
		let changed = altered.targets[0]?.atoms[0]
		if (!changed) throw Error("Missing altered atom")
		changed.value = "x"
		expect(() => cold.restore(altered)).toThrow("immutable")
		expect(() => cold.restoreCheckpoint(altered)).toThrow("immutable")
	}
})

test("checkpoint aliases cannot restore an atom into another target", () => {
	let replica = new Replica("alias-scope")
	replica.edit("first", "one")
	replica.edit("second", "two")
	let checkpoint = replica.checkpoint()
	let first = checkpoint.targets.find(target => target.id === "first")?.atoms[0]
	let second = checkpoint.targets.find(target => target.id === "second")
		?.atoms[0]
	if (!first || !second) throw Error("Missing separate targets")
	checkpoint.restored = [[first.id, second.id]]
	expect(() => parseCheckpoint(checkpoint)).toThrow("different targets")
	expect(() => new Replica("raw-restore").restore(checkpoint)).toThrow(
		"foreign",
	)
})

test("packed checkpoints reject overlapping runs, invalid anchors and forged clocks", () => {
	let { replica } = setup("ABC")
	let packed = compactCheckpoint(replica.checkpoint())
	let target = packed.targets[0]
	let atom = target?.atoms[0]
	if (!target || !atom) throw new Error("Missing checkpoint fixture")
	function altered(atoms: (typeof atom)[]) {
		return { ...packed, targets: [{ ...target, atoms }] }
	}
	expect(() => parseCheckpoint(altered([atom, atom]))).toThrow("identity")
	expect(() => parseCheckpoint(altered([{ ...atom, value: "" }]))).toThrow()
	expect(() =>
		parseCheckpoint(
			altered([
				{ ...atom, id: atom.id.slice(0, -8) + "99999999", value: "AB" },
			]),
		),
	).toThrow("range")
	expect(() => parseCheckpoint(altered([{ ...atom, after: atom.id }]))).toThrow(
		"identity",
	)
	expect(() => parseCheckpoint({ ...packed, clock: 0 })).toThrow("clock")
	expect(() =>
		parseCheckpoint(
			altered([
				{ ...atom, value: "a".repeat(2_000_000) },
				{ ...atom, value: "a".repeat(2_000_000) },
				{ ...atom, value: "a" },
			]),
		),
	).toThrow("limit")
	expect(parseCheckpoint(packed)).toEqual(replica.checkpoint())
})

test("operation and checkpoint runs preserve adjacent lone surrogate atom identities", () => {
	let { replica, initial } = setup("ab!")
	let operation = {
		...initial,
		insert: initial.insert.map((atom, index) => ({
			...atom,
			value: index === 0 ? "\uD83D" : index === 1 ? "\uDE00" : atom.value,
		})),
	}
	let compact = compactOperation(operation)
	expect(parseOperation(compact).insert).toEqual(operation.insert)
	let document = new Replica("surrogates")
	document.apply([operation])
	let packed = compactCheckpoint(document.checkpoint())
	expect(parseCheckpoint(packed)).toEqual(document.checkpoint())
	let cold = new Replica("cold-surrogates")
	cold.restore(parseCheckpoint(packed))
	expect(cold.visible("document")).toEqual(document.visible("document"))
	expect(replica.text("document")).toBe("ab!")
})
