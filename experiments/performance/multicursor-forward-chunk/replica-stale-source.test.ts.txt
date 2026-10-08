import { expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import { Replica } from "../src/shared/crdt"
import type { TextReplacement } from "../src/shared/crdt"

function scenario(source: string) {
	let seed = new Replica("birth")
	seed.edit("doc", source)
	let warm = seed.fork("writer"),
		cold = new Replica("writer")
	cold.restore(seed.checkpoint())
	warm.text("doc")
	let warmBase = warm.visible("doc"),
		coldBase = cold.visible("doc")
	let peer = seed.fork("peer"),
		change = peer.edit("doc", source + " PEER")
	if (!change) throw Error("Missing peer action")
	warm.apply([change])
	cold.apply([change])
	return { warm, cold, warmBase, coldBase, change }
}
function rebuilt(warm: Replica, cold: Replica) {
	let restored = new Replica("oracle")
	restored.restore(warm.checkpoint())
	expect(warm.text("doc")).toBe(cold.text("doc"))
	expect(warm.text("doc")).toBe(restored.text("doc"))
	expect(warm.visible("doc")).toEqual(restored.visible("doc"))
	expect(warm.metadata("doc")).toEqual(restored.metadata("doc"))
}
for (let source of [
	"Body",
	"Body😀🌻",
	"---\ntitle: Shared\nmode: present\n---\nBody😀",
	"---\r\ntitle: Shared\r\n---\r\nBody🌻",
	"---\ntitle: Shared\n---\n" + "x".repeat(131072),
])
	test(
		"published stale base matches cold action and reconstruction " +
			source.length,
		() => {
			let { warm, cold, warmBase, coldBase } = scenario(source)
			let replacements: TextReplacement[] = [
				{ start: source.length, remove: 0, text: " LOCAL😀" },
			]
			let a = warm.prepareReplacements("doc", replacements, warmBase),
				b = cold.prepareReplacements("doc", replacements, coldBase)
			if (!a || !b) throw Error("Missing replacement")
			expect({ ...a, time: b.time }).toEqual(b)
			warm.apply([a])
			cold.apply([b])
			rebuilt(warm, cold)
		},
	)
test("stale prepareEdit matches cold frontmatter merge and peer preservation", () => {
	let source = "---\ntitle: Shared\n---\nBody😀"
	let { warm, cold, warmBase, coldBase } = scenario(source)
	let a = warm.prepareEdit(
			"doc",
			source.replace("Shared", "Changed"),
			warmBase,
		),
		b = cold.prepareEdit("doc", source.replace("Shared", "Changed"), coldBase)
	if (!a || !b) throw Error("Missing header edit")
	expect({ ...a, time: b.time }).toEqual(b)
	warm.apply([a])
	cold.apply([b])
	rebuilt(warm, cold)
	expect(warm.text("doc")).toContain(" PEER")
})
test("external mutable atom arrays keep current values and Unicode bounds", () => {
	let { warm, warmBase } = scenario("A😀B")
	let external = warmBase.map(atom => ({ ...atom })),
		first = external[0]
	if (!first) throw Error("Missing atom")
	first.value = "😀"
	expect(() =>
		warm.prepareReplacements(
			"doc",
			[{ start: 1, remove: 0, text: "x" }],
			external,
		),
	).toThrow("Unicode")
	first.value = "A"
	let operation = warm.prepareReplacements(
		"doc",
		[{ start: 1, remove: 2, text: "🌻" }],
		external,
	)
	if (!operation) throw Error("Missing external edit")
	warm.apply([operation])
	expect(warm.text("doc")).toContain("A🌻B")
})
test("published frontmatter atoms and nested arrays cannot mutate before stale use", () => {
	let { warm, cold, warmBase, coldBase } = scenario(
		"---\ntitle: Shared\n---\nBody",
	)
	for (let atom of warmBase) {
		expect(Object.isFrozen(atom)).toBe(true)
		if (atom.order) expect(Object.isFrozen(atom.order)).toBe(true)
		if (atom.observed) expect(Object.isFrozen(atom.observed)).toBe(true)
		if (atom.deleted) expect(Object.isFrozen(atom.deleted)).toBe(true)
	}
	let first = warmBase[0]
	if (!first) throw Error("Missing atom")
	expect(() => {
		first.value = "X"
	}).toThrow()
	expect(() => {
		warmBase[0] = { ...first, value: "X" }
	}).toThrow()
	let start = "---\ntitle: Shared\n---\nBody".length
	let a = warm.prepareReplacements(
			"doc",
			[{ start, remove: 0, text: "Z" }],
			warmBase,
		),
		b = cold.prepareReplacements(
			"doc",
			[{ start, remove: 0, text: "Z" }],
			coldBase,
		)
	if (!a || !b) throw Error("Missing immutable edit")
	expect({ ...a, time: b.time }).toEqual(b)
})
test("cooperative source materialization preserves stale bases through cancellation", async () => {
	let { warm, cold, warmBase, coldBase, change } = scenario("Body😀")
	await Effect.runPromise(warm.textEffect("doc"))
	let canceled = warm.cancel("doc", change.id)
	if (!canceled) throw Error("Missing cancellation")
	cold.apply([canceled])
	let a = warm.prepareReplacements(
			"doc",
			[{ start: 6, remove: 0, text: "🌻" }],
			warmBase,
		),
		b = cold.prepareReplacements(
			"doc",
			[{ start: 6, remove: 0, text: "🌻" }],
			coldBase,
		)
	if (!a || !b) throw Error("Missing stale replacement")
	expect({ ...a, time: b.time }).toEqual(b)
	warm.apply([a])
	cold.apply([b])
	rebuilt(warm, cold)
})
test("cold cooperative materialization publishes an exact immutable stale basis", async () => {
	let seed = new Replica("birth")
	seed.edit("doc", "---\ntitle: Shared\n---\nBody😀")
	let warm = new Replica("writer"),
		cold = new Replica("writer")
	warm.restore(seed.checkpoint())
	cold.restore(seed.checkpoint())
	await Effect.runPromise(warm.textEffect("doc"))
	let warmBase = warm.visible("doc"),
		coldBase = cold.visible("doc")
	let peer = seed.fork("peer"),
		change = peer.edit("doc", seed.text("doc") + " PEER")
	if (!change) throw Error("Missing peer edit")
	warm.apply([change])
	cold.apply([change])
	let start = seed.text("doc").length
	let a = warm.prepareReplacements(
			"doc",
			[{ start, remove: 0, text: "🌻" }],
			warmBase,
		),
		b = cold.prepareReplacements(
			"doc",
			[{ start, remove: 0, text: "🌻" }],
			coldBase,
		)
	if (!a || !b) throw Error("Missing cooperative stale edit")
	expect({ ...a, time: b.time }).toEqual(b)
	warm.apply([a])
	cold.apply([b])
	rebuilt(warm, cold)
})
for (let mode of ["local", "peer-scalar", "peer-run", "terminal-cancel"])
	test(
		"published fast source view remains exact through stale use " + mode,
		() => {
			let owner = new Replica("writer")
			owner.edit(
				"doc",
				mode === "terminal-cancel"
					? "Body😀"
					: "---\ntitle: Shared\n---\nBody😀",
			)
			owner.text("doc")
			if (mode === "local") owner.edit("doc", owner.text("doc") + "x")
			else {
				let peer = owner.fork("peer"),
					changed = peer.edit(
						"doc",
						owner.text("doc") + (mode === "peer-run" ? " RUN🌻" : "x"),
					)
				if (!changed) throw Error("Missing peer edit")
				owner.apply([changed])
				if (mode === "terminal-cancel") owner.cancel("doc", changed.id)
			}
			let text = owner.text("doc"),
				base = owner.visible("doc")
			expect(base.map(atom => atom.value).join("")).toBe(text)
			let cold = new Replica("writer")
			cold.restore(owner.checkpoint())
			let coldBase = cold.visible("doc")
			let peer = owner.fork("next-peer"),
				changed = peer.edit("doc", text + " PEER")
			if (!changed) throw Error("Missing subsequent peer edit")
			owner.apply([changed])
			cold.apply([changed])
			let a = owner.prepareReplacements(
					"doc",
					[{ start: text.length, remove: 0, text: " LOCAL" }],
					base,
				),
				b = cold.prepareReplacements(
					"doc",
					[{ start: text.length, remove: 0, text: " LOCAL" }],
					coldBase,
				)
			if (!a || !b) throw Error("Missing cached stale edit")
			expect({ ...a, time: b.time }).toEqual(b)
			owner.apply([a])
			cold.apply([b])
			rebuilt(owner, cold)
		},
	)
