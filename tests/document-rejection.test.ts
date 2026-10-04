import { expect, test } from "bun:test"
import * as Schema from "effect/Schema"
import * as Effect from "effect/Effect"
import * as Crypto from "effect/Crypto"
import { webCryptoLayer } from "../src/platform/web-crypto"
import { Replica } from "../src/shared/crdt"
import { partitionDocumentActions } from "../src/shared/document-dependencies"
import {
	applyAction,
	admitClocks,
	DocumentActionSchema,
	buildAction,
	committedAction,
	undoAction,
} from "../src/shared/document-actions"
import { newComment, newDocument } from "../src/shared/documents"
import { parseOperation } from "../src/shared/model"

function run<A, E>(program: Effect.Effect<A, E, Crypto.Crypto>) {
	return Effect.runPromise(program.pipe(Effect.provide(webCryptoLayer)))
}
function setup(source = "AB") {
	return Effect.gen(function* () {
		let accepted = new Replica("writer")
		let birth = yield* committedAction(
			accepted,
			yield* buildAction(accepted, "doc", "Create", staged =>
				newDocument(staged, "doc", "Untitled", source),
			),
			"owner",
		)
		yield* applyAction(accepted, birth)
		return accepted
	})
}
function copy(replica: Replica) {
	let restored = new Replica(replica.actor)
	restored.restore(replica.checkpoint())
	return restored
}

test("rejection partitions whole actions through anchors, removals, cancellations, record ownership and permission observations", () =>
	run(
		Effect.gen(function* () {
			let accepted = yield* setup()
			let staged = copy(accepted)
			let original = yield* buildAction(staged, "doc", "Mixed", draft => [
				...newComment(draft, "comment", "doc", "AB", "Original", "Owner"),
				draft.edit("doc", "AXB"),
				draft.set("doc", "access:reader", "reader"),
			])
			staged.apply(original.changes.map(parseOperation))
			let child = yield* buildAction(
				staged,
				"doc",
				"Dependent comment and mode",
				draft => [
					draft.set("comment", "body", "Later"),
					draft.set("doc", "mode", "slideshow"),
				],
			)
			staged.apply(child.changes.map(parseOperation))
			let text = yield* buildAction(
				staged,
				"doc",
				"Dependent anchor",
				draft => [draft.edit("doc", "AX!B")],
			)
			staged.apply(text.changes.map(parseOperation))
			let removal = yield* buildAction(
				staged,
				"doc",
				"Dependent removal",
				draft => [draft.edit("doc", "AB")],
			)
			staged.apply(removal.changes.map(parseOperation))
			let permission = yield* buildAction(
				staged,
				"doc",
				"Dependent permission",
				draft => [draft.set("doc", "access:reader", "writer")],
			)
			staged.apply(permission.changes.map(parseOperation))
			let independent = yield* buildAction(
				staged,
				"doc",
				"Independent note edit",
				draft => [draft.set("doc", "note", "Independent")],
			)
			staged.apply(independent.changes.map(parseOperation))
			let cancelled = yield* buildAction(
				staged,
				"doc",
				"Cancel insertion",
				draft => {
					let insertion = original.changes.find(
						change => change.kind === "text",
					)
					if (!insertion) throw new Error("Missing insertion")
					return [draft.cancel("doc", insertion.id)]
				},
			)
			let undo = { ...cancelled, undoOf: original.id }
			let actions = [
				original,
				child,
				text,
				removal,
				permission,
				independent,
				undo,
			]
			let partition = yield* partitionDocumentActions(accepted, actions, [
				original.id,
			])
			expect(partition.ready).toEqual([independent])
			expect(partition.blocked).toEqual(
				actions.filter(action => action !== independent),
			)
			expect(
				(yield* partitionDocumentActions(accepted, actions, [text.id])).blocked,
			).toEqual([text, removal])
			expect(
				(yield* partitionDocumentActions(accepted, actions, [])).ready,
			).toEqual(actions)
		}),
	))

for (let [before, after] of [
	["AB", "A"],
	["A", "AB"],
	["---\ntitle: Before\n---\nAB", "---\ntitle: After\n---\nA"],
]) {
	if (before === undefined || after === undefined)
		throw new Error("Invalid source fixture")
	test(
		"a displayed base preserves typing without reproducing rejected compensation: " +
			JSON.stringify(after),
		() =>
			run(
				Effect.gen(function* () {
					let accepted = yield* setup(before)
					let changed = yield* committedAction(
						accepted,
						yield* buildAction(accepted, "doc", "Source", staged => [
							staged.edit("doc", after),
						]),
						"owner",
					)
					yield* applyAction(accepted, changed)
					let optimistic = copy(accepted)
					optimistic.apply(
						(yield* undoAction(optimistic, changed)).changes.map(
							parseOperation,
						),
					)
					let displayed = optimistic.visible("doc")
					let input = optimistic.text("doc") + "!"
					let rebuilt = copy(accepted)
					let edit = rebuilt.prepareEdit("doc", input, displayed)
					if (!edit) throw new Error("Lost keystroke")
					expect(edit.insert.map(atom => atom.value).join("")).toBe("!")
					expect(edit.remove).toEqual([])
					rebuilt.apply([edit])
					expect(rebuilt.text("doc")).toContain("!")
					expect(rebuilt.metadata("doc").title).toBe(
						accepted.metadata("doc").title,
					)
					expect(
						rebuilt
							.visible("doc")
							.filter(
								atom => !edit.insert.some(inserted => inserted.id === atom.id),
							)
							.map(atom => atom.value)
							.join(""),
					).toBe(after)
				}),
			),
	)
}

test("missing causal references fail instead of entering the healthy partition", () =>
	run(
		Effect.gen(function* () {
			let accepted = yield* setup()
			let action = yield* buildAction(accepted, "doc", "Insert", staged => [
				staged.edit("doc", "AB!"),
			])
			let atom = "0000000000000001:missing:00000000"
			let invalid = Schema.decodeUnknownSync(DocumentActionSchema)({
				...action,
				changes: action.changes.map(change => ({
					...change,
					insert: change.insert.map(inserted => ({ ...inserted, after: atom })),
				})),
			})
			let result = yield* partitionDocumentActions(
				accepted,
				[invalid],
				[],
			).pipe(Effect.result)
			expect(result._tag).toBe("Failure")
			if (result._tag === "Failure")
				expect(result.failure).toMatchObject({
					_tag: "CausalDependencyMissing",
					document: "doc",
					atom,
				})
		}),
	))

test("displayed frontmatter provenance survives replacing its replica, including whole-header replacement and removal", () =>
	run(
		Effect.gen(function* () {
			let accepted = yield* setup(
				"---\ntitle: Original\ntags: [base]\n---\nBody",
			)
			let left = new Replica("left"),
				right = new Replica("right")
			left.restore(accepted.checkpoint())
			right.restore(accepted.checkpoint())
			let title = left.edit("doc", "---\ntitle: Left\ntags: [base]\n---\nBody")
			let tags = right.edit(
				"doc",
				"---\ntitle: Original\ntags: [peer]\n---\nBody",
			)
			if (!title || !tags) throw new Error("Missing concurrent headers")
			accepted.apply([title, tags])
			let displayed = accepted.visible("doc")
			for (let input of [
				accepted
					.text("doc")
					.replace("title: Left", "# Decoration\ntitle: Next"),
				"Body",
			]) {
				let rebuilt = copy(accepted)
				let oracle = accepted.prepareEdit("doc", input, displayed)
				let actual = rebuilt.prepareEdit("doc", input, displayed)
				if (!oracle || !actual) throw new Error("Missing header change")
				expect(actual.remove).toEqual(oracle.remove)
				expect(actual.insert).toEqual(oracle.insert)
				rebuilt.apply([actual])
				expect(rebuilt.text("doc")).toBe(input)
				expect(rebuilt.metadata("doc").tags).toEqual(
					input === "Body" ? [] : ["peer"],
				)
			}
		}),
	))

test("clock admission counts supplied operations and preserves the frontier across rejected actions", () =>
	run(
		Effect.gen(function* () {
			let accepted = yield* setup()
			let staged = new Replica("local")
			staged.restore(accepted.checkpoint())
			let first = staged.set("doc", "note", "withdraw")
			let second = staged.set("doc", "note", "dependent")
			let healthy = staged.set("doc", "other", "keep")
			expect(() => admitClocks(accepted.clock, [healthy])).toThrow(
				"Operation clock exceeds",
			)
			let frontier = admitClocks(accepted.clock, [first])
			frontier = admitClocks(frontier, [second])
			expect(admitClocks(frontier, [healthy])).toBe(healthy.clock)
			expect(admitClocks(healthy.clock, [first])).toBe(healthy.clock)
			let inflated = { ...first, clock: Number.MAX_SAFE_INTEGER }
			expect(() => admitClocks(accepted.clock, [inflated])).toThrow(
				"Operation clock exceeds",
			)
		}),
	))
