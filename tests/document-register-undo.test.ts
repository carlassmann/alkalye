import { expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import type * as Crypto from "effect/Crypto"
import * as Schema from "effect/Schema"
import { webCryptoLayer } from "../src/platform/web-crypto"
import { Replica } from "../src/shared/crdt"
import { parseCheckpoint } from "../src/shared/checkpoint"
import { compactOperation, parseOperation } from "../src/shared/model"
import { newDocument } from "../src/shared/documents"
import {
	applyAction,
	buildAction,
	committedAction,
	DocumentActionSchema,
	CommittedActionSchema,
	prepareAction,
	undoAction,
	validateAction,
} from "../src/shared/document-actions"
import type {
	CommittedAction,
	DocumentAction,
} from "../src/shared/document-actions"
import { partitionDocumentActions } from "../src/shared/document-dependencies"

test("successive setting undos and redos retain their contributors through cold snapshots", () =>
	run(
		Effect.gen(function* () {
			let replica = yield* setup()
			let first = yield* set(replica, "alpha")
			let second = yield* set(replica, "beta")
			expect(
				second.before.find(field => field.field === "note")?.contributor,
			).toBe(first.id)
			let undoSecond = yield* compensate(replica, second)
			expect(replica.fields("doc").note).toBe("alpha")
			expect(replica.register("doc", "note")?.id).toBe(undoSecond.id)
			expect(replica.contributor("doc", "note")).toBe(first.id)
			replica = cold(replica)
			let undoFirst = yield* compensate(replica, first)
			expect(replica.fields("doc").note).toBe("")
			replica = cold(replica)
			let redoFirst = yield* compensate(replica, undoFirst)
			expect(replica.fields("doc").note).toBe("alpha")
			expect(replica.contributor("doc", "note")).toBe(first.id)
			replica = cold(replica)
			let redoSecond = yield* compensate(replica, undoSecond)
			expect(replica.fields("doc").note).toBe("beta")
			expect(replica.contributor("doc", "note")).toBe(second.id)
			replica = cold(replica)
			yield* compensate(replica, redoSecond)
			expect(replica.fields("doc").note).toBe("alpha")
			yield* compensate(replica, redoFirst)
			expect(replica.fields("doc").note).toBe("")
		}),
	))

test("an intervening peer write with the same value remains an independent contribution", () =>
	run(
		Effect.gen(function* () {
			let replica = yield* setup()
			let first = yield* set(replica, "alpha")
			let second = yield* set(replica, "beta")
			yield* compensate(replica, second)
			let peer = yield* set(replica, "alpha", "peer")
			let before = replica.checkpoint()
			let result = yield* undoAction(replica, first).pipe(Effect.result)
			expect(result).toMatchObject({
				_tag: "Failure",
				failure: { _tag: "UndoUnavailable", reason: "Exhausted" },
			})
			expect(replica.checkpoint()).toEqual(before)
			expect(replica.contributor("doc", "note")).toBe(peer.id)
			expect(replica.fields("doc").note).toBe("alpha")
		}),
	))

test("provisional provenance with the right value but wrong contributor is refused atomically", () =>
	run(
		Effect.gen(function* () {
			let replica = yield* setup()
			let first = yield* set(replica, "alpha")
			let local = cold(replica)
			let proposal = yield* buildAction(
				local,
				"doc",
				"Queued setting",
				staged => [staged.set("doc", "note", "beta")],
			)
			let predicted = yield* prepareAction(local, proposal, "owner")
			local.apply(proposal.changes.map(parseOperation))
			let queued = yield* undoAction(local, predicted, "queued-undo")
			let peer = yield* set(replica, "alpha", "peer")
			let accepted = yield* accept(replica, proposal)
			expect(
				predicted.before.find(field => field.field === "note")?.contributor,
			).toBe(first.id)
			expect(
				accepted.before.find(field => field.field === "note")?.contributor,
			).toBe(peer.id)
			let before = replica.checkpoint()
			let rejected = yield* committedAction(
				replica,
				queued,
				"owner",
				accepted,
			).pipe(Effect.result)
			expect(rejected).toMatchObject({
				_tag: "Failure",
				failure: { _tag: "UndoUnavailable", reason: "Stale" },
			})
			expect(replica.checkpoint()).toEqual(before)
			yield* compensate(replica, accepted)
			expect(replica.fields("doc").note).toBe("alpha")
			expect(replica.contributor("doc", "note")).toBe(peer.id)
		}),
	))

test("forged contributor tags require a canonical compensation and cannot change another field", () =>
	run(
		Effect.gen(function* () {
			let replica = yield* setup()
			let first = yield* set(replica, "alpha")
			let unrelated = replica.set("doc", "other", "unrelated")
			let proposal = yield* buildAction(replica, "doc", "Forge", staged => [
				staged.set("doc", "note", "alpha", first.id),
			])
			for (let work of [
				validateAction(replica, proposal).pipe(Effect.asVoid),
				committedAction(replica, proposal, "owner").pipe(Effect.asVoid),
			])
				expect(yield* work.pipe(Effect.result)).toMatchObject({
					_tag: "Failure",
					failure: { _tag: "DocumentConflict" },
				})
			let undo = yield* undoAction(replica, first)
			let forged = Schema.decodeUnknownSync(DocumentActionSchema)({
				...undo,
				changes: undo.changes.map(change => ({
					...change,
					restores: unrelated.id,
				})),
			})
			let before = replica.checkpoint()
			expect(
				yield* committedAction(replica, forged, "owner", first).pipe(
					Effect.result,
				),
			).toMatchObject({
				_tag: "Failure",
				failure: { _tag: "UndoUnavailable", reason: "Stale" },
			})
			expect(replica.checkpoint()).toEqual(before)
		}),
	))

test("old beforeimages remain compensable without fabricating missing contributor provenance", () =>
	run(
		Effect.gen(function* () {
			let replica = yield* setup()
			let first = yield* set(replica, "alpha")
			let second = yield* set(replica, "beta")
			let legacy = Schema.decodeUnknownSync(CommittedActionSchema)({
				...second,
				before: second.before.map(({ target, field, value }) => ({
					target,
					field,
					value,
				})),
			})
			let undo = yield* compensate(replica, legacy)
			expect(undo.changes.every(change => !change.restores)).toBe(true)
			expect(replica.fields("doc").note).toBe("alpha")
			expect(replica.contributor("doc", "note")).toBe(undo.id)
			expect(
				yield* undoAction(replica, first).pipe(Effect.result),
			).toMatchObject({
				_tag: "Failure",
				failure: { _tag: "UndoUnavailable", reason: "Exhausted" },
			})
		}),
	))

test("restoration tags survive compaction, reject forward references and remain immutable", () => {
	let replica = new Replica("writer")
	let first = replica.set("doc", "note", "alpha")
	let second = replica.set("doc", "note", "beta")
	let restored = replica.set("doc", "note", "alpha", first.id)
	expect(parseOperation(compactOperation(restored))).toEqual(restored)
	expect(cold(replica).contributor("doc", "note")).toBe(first.id)
	expect(() => replica.apply([{ ...restored, restores: second.id }])).toThrow(
		"immutable",
	)
	expect(() => parseOperation({ ...restored, restores: restored.id })).toThrow(
		"restoration",
	)
	expect(() => parseOperation({ ...restored, kind: "text" })).toThrow(
		"restoration",
	)
})

test("a compensation restoring a pending register also depends on that register's action", () =>
	run(
		Effect.gen(function* () {
			let accepted = yield* setup()
			let local = cold(accepted)
			let first = yield* buildAction(local, "doc", "First", staged => [
				staged.set("doc", "note", "alpha"),
			])
			local.apply(first.changes.map(parseOperation))
			let second = yield* buildAction(local, "doc", "Second", staged => [
				staged.set("doc", "note", "beta"),
			])
			let predicted = yield* prepareAction(local, second, "owner")
			local.apply(second.changes.map(parseOperation))
			let undo = yield* undoAction(local, predicted, "undo-second")
			let partition = yield* partitionDocumentActions(
				accepted,
				[first, second, undo],
				[first.id],
			)
			expect(partition.ready.map(action => action.id)).toEqual([])
			expect(partition.blocked.map(action => action.id)).toEqual([
				first.id,
				second.id,
				undo.id,
			])
		}),
	))

function run<A, E>(program: Effect.Effect<A, E, Crypto.Crypto>) {
	return Effect.runPromise(program.pipe(Effect.provide(webCryptoLayer)))
}
function setup() {
	return Effect.gen(function* () {
		let replica = new Replica("writer")
		yield* accept(
			replica,
			yield* buildAction(replica, "doc", "Create", staged =>
				newDocument(staged, "doc", "Untitled", "Source"),
			),
		)
		return replica
	})
}
function set(replica: Replica, value: string, actor = replica.actor) {
	return buildAction(
		replica,
		"doc",
		"Set note",
		staged => [staged.set("doc", "note", value)],
		actor,
	).pipe(Effect.flatMap(proposal => accept(replica, proposal)))
}
function accept(
	replica: Replica,
	proposal: DocumentAction,
	original?: CommittedAction,
) {
	return Effect.gen(function* () {
		let fact = yield* committedAction(replica, proposal, "owner", original)
		yield* applyAction(replica, fact)
		return fact
	})
}
function compensate(replica: Replica, original: CommittedAction) {
	return undoAction(replica, original).pipe(
		Effect.flatMap(proposal => accept(replica, proposal, original)),
	)
}
function cold(replica: Replica) {
	let restored = new Replica(replica.actor)
	restored.restore(
		parseCheckpoint(JSON.parse(JSON.stringify(replica.checkpoint()))),
	)
	return restored
}
