import { expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import { webCryptoLayer } from "../src/platform/web-crypto"
import { parseCheckpoint } from "../src/shared/checkpoint"
import { Replica } from "../src/shared/crdt"
import * as Crypto from "effect/Crypto"
import * as Schema from "effect/Schema"
import { expandDeletions, parseOperation } from "../src/shared/model"
import {
	applyAction,
	buildAction,
	DocumentActionSchema,
	CommittedActionSchema,
	committedAction,
	prepareAction,
	PreparedActionSchema,
	undoAction,
	validateAction,
	type CommittedAction,
	type DocumentAction,
} from "../src/shared/document-actions"
import { validateTextCausality } from "../src/shared/document-causality"
import {
	newComment,
	newDocument,
	replyToComment,
	setFields,
} from "../src/shared/documents"
import { encode } from "../src/shared/base64"
import { assetReferences } from "../src/shared/authoring"

function run<A, E>(program: Effect.Effect<A, E, Crypto.Crypto>) {
	return Effect.runPromise(program.pipe(Effect.provide(webCryptoLayer)))
}
function accept(
	replica: Replica,
	proposal: DocumentAction,
	original?: CommittedAction,
) {
	return Effect.gen(function* () {
		let fact = yield* committedAction(replica, proposal, "owner", original)
		yield* validateTextCausality(
			replica,
			fact.document,
			fact.changes.map(parseOperation),
		)
		yield* applyAction(replica, fact)
		return fact
	})
}
function setup(source = "Base") {
	return Effect.gen(function* () {
		let replica = new Replica("writer")
		let birth = yield* accept(
			replica,
			yield* buildAction(replica, "doc", "Create", staged =>
				newDocument(staged, "doc", "Untitled", source),
			),
		)
		return { replica, birth }
	})
}
function reopen(replica: Replica) {
	let cold = new Replica("cold")
	cold.restore(replica.checkpoint())
	return cold
}

test("one compensation restores text, frontmatter, comments, assets, drawings and settings without history replay", () =>
	run(
		Effect.gen(function* () {
			let { replica } = yield* setup("---\ntitle: Before\n---\nBase")
			let original = yield* accept(
				replica,
				yield* buildAction(replica, "doc", "Compose", staged => [
					staged.edit(
						"doc",
						"---\ntitle: After\n---\nBase\n![Photo](asset:photo)",
					),
					...newComment(staged, "comment", "doc", "Base", "Note", "Owner"),
					...setFields(staged, "photo", {
						type: "asset",
						document: "doc",
						data: "image-bytes",
					}),
					...setFields(staged, "drawing", {
						type: "stroke",
						document: "doc",
						points: "1,2;3,4",
					}),
					staged.set("doc", "mode", "slideshow"),
				]),
			)
			let cold = reopen(replica),
				before = cold.checkpoint()
			expect(
				[...cold.operations.values()].filter(change => change.kind === "text"),
			).toEqual([])
			let undo = yield* undoAction(cold, original)
			expect(cold.checkpoint()).toEqual(before)
			let fact = yield* accept(cold, undo, original)
			expect(cold.metadata("doc").title).toBe("Before")
			expect(cold.text("doc")).toBe("---\ntitle: Before\n---\nBase")
			for (let target of ["comment", "photo", "drawing"])
				expect(cold.fields(target).type).toBe("deleted")
			expect(cold.fields("doc").mode).toBe("")
			let redone = reopen(cold)
			let redo = yield* accept(redone, yield* undoAction(redone, fact), fact)
			expect(redone.text("doc")).toBe(replica.text("doc"))
			for (let target of ["doc", "comment", "photo", "drawing"])
				expect(redone.fields(target)).toEqual(replica.fields(target))
			let again = yield* accept(redone, yield* undoAction(redone, redo), redo)
			expect(again.undoOf).toBe(redo.id)
			expect(redone.fields("photo").type).toBe("deleted")
		}),
	))

test("peer insertion inside cancelled text survives undo and redo", () =>
	run(
		Effect.gen(function* () {
			let { replica } = yield* setup("ab")
			let original = yield* accept(
				replica,
				yield* buildAction(replica, "doc", "Insert X", staged => [
					staged.edit("doc", "aXb"),
				]),
			)
			yield* accept(
				replica,
				yield* buildAction(
					replica,
					"doc",
					"Peer insertion",
					staged => [staged.edit("doc", "aXPb")],
					"peer",
				),
			)
			let undo = yield* accept(
				replica,
				yield* undoAction(replica, original),
				original,
			)
			expect(replica.text("doc")).toBe("aPb")
			yield* accept(replica, yield* undoAction(replica, undo), undo)
			expect(replica.text("doc")).toBe("aXPb")
		}),
	))

test("peer deletion inside inserted text remains deleted after cold undo and redo", () =>
	run(
		Effect.gen(function* () {
			let { replica } = yield* setup("ab")
			let original = yield* accept(
				replica,
				yield* buildAction(replica, "doc", "Insert XYZ", staged => [
					staged.edit("doc", "aXYZb"),
				]),
			)
			yield* accept(
				replica,
				yield* buildAction(
					replica,
					"doc",
					"Peer deletion",
					staged => [staged.edit("doc", "aXZb")],
					"peer",
				),
			)
			let cold = reopen(replica)
			let undo = yield* accept(
				cold,
				yield* undoAction(cold, original),
				original,
			)
			expect(cold.text("doc")).toBe("ab")
			let redone = reopen(cold)
			yield* accept(redone, yield* undoAction(redone, undo), undo)
			expect(redone.text("doc")).toBe("aXZb")
		}),
	))

test("compensation preserves a peer reply, changed drawing and settings across the complete action", () =>
	run(
		Effect.gen(function* () {
			let { replica } = yield* setup()
			let original = yield* accept(
				replica,
				yield* buildAction(replica, "doc", "Compose", staged => [
					staged.edit("doc", "Base own"),
					...newComment(staged, "comment", "doc", "Base", "Note", "Owner"),
					...setFields(staged, "drawing", {
						type: "stroke",
						document: "doc",
						points: "1,2",
					}),
					staged.set("doc", "mode", "slideshow"),
				]),
			)
			yield* accept(
				replica,
				yield* buildAction(
					replica,
					"doc",
					"Peer edits",
					staged => [
						replyToComment(staged, "comment", "Reply", "Peer", {
							id: "peer",
							time: 1,
						}),
						staged.set("drawing", "points", "3,4"),
						staged.set("doc", "mode", "teleprompter"),
					],
					"peer",
				),
			)
			let undo = yield* undoAction(replica, original)
			expect(undo.changes).toHaveLength(1)
			yield* accept(replica, undo, original)
			expect(replica.text("doc")).toBe("Base")
			expect(replica.fields("comment").body).toBe("Note")
			expect(replica.fields("comment")["reply:1:peer"]).toContain("Reply")
			expect(replica.fields("drawing").points).toBe("3,4")
			expect(replica.fields("doc").mode).toBe("teleprompter")
		}),
	))

test("a stale asset compensation rejects atomically; rederivation retains the peer's exact reference and whole manifest", () =>
	run(
		Effect.gen(function* () {
			let { replica } = yield* setup()
			let original = yield* accept(
				replica,
				yield* buildAction(replica, "doc", "Attach", staged => [
					...setFields(staged, "photo", {
						type: "asset",
						document: "doc",
						data: "image-bytes",
						name: "Photo",
					}),
					staged.edit("doc", "Base\n![Own](asset:photo)"),
				]),
			)
			let stale = yield* undoAction(replica, original)
			yield* accept(
				replica,
				yield* buildAction(
					replica,
					"doc",
					"Peer reference",
					staged => [
						staged.edit("doc", staged.text("doc") + "\n![Peer](asset:photo)"),
					],
					"peer",
				),
			)
			let before = replica.checkpoint()
			let rejected = yield* accept(replica, stale, original).pipe(Effect.result)
			expect(rejected._tag).toBe("Failure")
			if (rejected._tag === "Failure")
				expect(rejected.failure).toMatchObject({
					_tag: "UndoUnavailable",
					reason: "Stale",
				})
			expect(replica.checkpoint()).toEqual(before)
			let fresh = yield* undoAction(replica, original)
			expect(fresh.changes).toHaveLength(1)
			yield* accept(replica, fresh, original)
			expect(replica.text("doc")).toBe("Base\n![Peer](asset:photo)")
			expect(replica.fields("photo")).toMatchObject({
				type: "asset",
				data: "image-bytes",
				name: "Photo",
			})
		}),
	))

test("asset tokens compare complete identities rather than matching prefixes", () =>
	run(
		Effect.gen(function* () {
			expect(assetReferences("asset:a asset:ab asset:a")).toEqual(
				new Set(["a", "ab"]),
			)
			expect(assetReferences("asset:a:b asset:a.b ASSET:a-b")).toEqual(
				new Set(["a:b", "a.b", "a-b"]),
			)
			let { replica } = yield* setup("Base ![Existing](asset:ab)")
			let original = yield* accept(
				replica,
				yield* buildAction(replica, "doc", "Attach a", staged => [
					...setFields(staged, "a", {
						type: "asset",
						document: "doc",
						data: "a-bytes",
					}),
					staged.edit("doc", staged.text("doc") + " ![Own](asset:a)"),
				]),
			)
			yield* accept(replica, yield* undoAction(replica, original), original)
			expect(replica.fields("a").type).toBe("deleted")
			expect(replica.text("doc")).toBe("Base ![Existing](asset:ab)")
		}),
	))

test("omitted changes, duplicate cancels, unrelated contributions and wrong references fail before any mutation", () =>
	run(
		Effect.gen(function* () {
			let { replica } = yield* setup()
			let original = yield* accept(
				replica,
				yield* buildAction(replica, "doc", "Compose", staged => [
					staged.edit("doc", "Base own"),
					staged.set("doc", "mode", "slideshow"),
				]),
			)
			let peer = yield* accept(
				replica,
				yield* buildAction(
					replica,
					"doc",
					"Peer",
					staged => [staged.edit("doc", "Base own peer")],
					"peer",
				),
			)
			let undo = yield* undoAction(replica, original)
			let cancel = undo.changes.find(change => change.kind === "cancel")
			let peerText = peer.changes.find(change => change.kind === "text")
			if (!cancel || !peerText) throw new Error("Missing contributions")
			let before = replica.checkpoint()
			for (let changes of [
				undo.changes.filter(change => change.kind !== "cancel"),
				undo.changes.filter(change => change.kind !== "set"),
				[...undo.changes, cancel],
				undo.changes.map(change =>
					change.kind === "cancel" ? { ...change, value: peerText.id } : change,
				),
				undo.changes.map(change =>
					change.kind === "cancel" ? { ...change, target: "other" } : change,
				),
				undo.changes.map(change =>
					change.kind === "set" ? { ...change, value: "teleprompter" } : change,
				),
			]) {
				let result = yield* Schema.decodeUnknownEffect(DocumentActionSchema)({
					...undo,
					changes,
				}).pipe(
					Effect.flatMap(proposal => accept(replica, proposal, original)),
					Effect.result,
				)
				expect(result._tag).toBe("Failure")
				expect(replica.checkpoint()).toEqual(before)
			}
			let result = yield* accept(replica, { ...undo, undoOf: undefined }).pipe(
				Effect.result,
			)
			expect(result._tag).toBe("Failure")
			expect(replica.checkpoint()).toEqual(before)
		}),
	))

test("multiple source operations compensate in reverse order without replacing peer text", () =>
	run(
		Effect.gen(function* () {
			let { replica } = yield* setup("ab")
			let original = yield* accept(
				replica,
				yield* buildAction(replica, "doc", "Two edits", staged => [
					staged.edit("doc", "aXb"),
					staged.edit("doc", "aXYb"),
				]),
			)
			yield* accept(
				replica,
				yield* buildAction(
					replica,
					"doc",
					"Peer",
					staged => [staged.edit("doc", "aXYPb")],
					"peer",
				),
			)
			let undo = yield* accept(
				replica,
				yield* undoAction(replica, original),
				original,
			)
			expect(undo.changes).toHaveLength(2)
			expect(replica.text("doc")).toBe("aPb")
			yield* accept(replica, yield* undoAction(replica, undo), undo)
			expect(replica.text("doc")).toBe("aXYPb")
		}),
	))

test("register beforeimages use the winning operation, even when repeated field writes are reordered", () =>
	run(
		Effect.gen(function* () {
			let { replica } = yield* setup()
			let proposal = yield* buildAction(
				replica,
				"doc",
				"Mode twice",
				staged => [
					staged.set("doc", "mode", "slideshow"),
					staged.set("doc", "mode", "teleprompter"),
					staged.set("doc", "other", "value"),
				],
			)
			let first = proposal.changes[0],
				second = proposal.changes[1],
				last = proposal.changes[2]
			if (!first || !second || !last) throw new Error("Missing changes")
			yield* accept(
				replica,
				yield* buildAction(
					replica,
					"doc",
					"Advance peer frontier",
					staged => [
						staged.set("doc", "peer-first", "a"),
						staged.set("doc", "peer-second", "b"),
					],
					"peer",
				),
			)
			let original = yield* accept(replica, {
				...proposal,
				changes: [second, first, last],
			})
			expect(replica.fields("doc").mode).toBe("teleprompter")
			let undo = yield* undoAction(replica, original)
			expect(
				undo.changes.filter(change => change.field === "mode"),
			).toHaveLength(1)
			yield* accept(replica, undo, original)
			expect(replica.fields("doc").mode).toBe("")
		}),
	))

test("undo never restores permissions from beforeimages", () =>
	run(
		Effect.gen(function* () {
			let { replica } = yield* setup()
			let original = yield* accept(
				replica,
				yield* buildAction(replica, "doc", "Revoke and edit", staged => [
					staged.set("doc", "access:guest", "none"),
					staged.edit("doc", "Changed"),
				]),
			)
			let undo = yield* undoAction(replica, original)
			expect(
				undo.changes.every(change => !change.field.startsWith("access:")),
			).toBe(true)
			yield* accept(replica, undo, original)
			expect(replica.fields("doc")["access:guest"]).toBe("none")
			expect(replica.text("doc")).toBe("Base")
		}),
	))

test("birth and migrated text reject complete undo without leaking partial register changes", () =>
	run(
		Effect.gen(function* () {
			let { replica, birth } = yield* setup()
			let rejectedBirth = yield* undoAction(replica, birth).pipe(Effect.result)
			expect(rejectedBirth._tag).toBe("Failure")
			if (rejectedBirth._tag === "Failure")
				expect(rejectedBirth.failure).toMatchObject({
					_tag: "UndoUnavailable",
					reason: "BirthRoot",
				})
			let original = yield* accept(
				replica,
				yield* buildAction(replica, "doc", "Mixed", staged => [
					staged.edit("doc", "Changed"),
					staged.set("doc", "mode", "slideshow"),
				]),
			)
			let checkpoint = replica.checkpoint()
			let legacy = parseCheckpoint({
				...checkpoint,
				format: "alkalye-state-v1",
				targets: checkpoint.targets.map(target => ({
					id: target.id,
					created: target.created,
					updated: target.updated,
					atoms: target.atoms,
					fields: target.fields,
					removed: target.visibility.removals.flatMap(([, runs]) =>
						expandDeletions(runs),
					),
				})),
			})
			let cold = new Replica("legacy")
			cold.restore(legacy)
			let before = cold.checkpoint()
			let rejected = yield* undoAction(cold, original).pipe(Effect.result)
			expect(rejected._tag).toBe("Failure")
			if (rejected._tag === "Failure")
				expect(rejected.failure).toMatchObject({
					_tag: "UndoUnavailable",
					reason: "BelowFloor",
				})
			expect(cold.checkpoint()).toEqual(before)
		}),
	))

test("a peer-owned type protects every field of created comments and referenced assets", () =>
	run(
		Effect.gen(function* () {
			let { replica } = yield* setup()
			let original = yield* accept(
				replica,
				yield* buildAction(replica, "doc", "Compose", staged => [
					...newComment(
						staged,
						"comment",
						"doc",
						"Base",
						"Original note",
						"Owner",
					),
					...setFields(staged, "photo", {
						type: "asset",
						document: "doc",
						data: "image-bytes",
						name: "Photo.png",
					}),
					staged.edit("doc", "Base\n![Own](asset:photo)"),
				]),
			)
			let deletion = yield* accept(
				replica,
				yield* buildAction(
					replica,
					"doc",
					"Peer deletes records",
					staged => [
						staged.set("comment", "type", "deleted"),
						staged.set("photo", "type", "deleted"),
					],
					"peer",
				),
			)
			yield* accept(
				replica,
				yield* undoAction(replica, deletion, "peer-restoration"),
				deletion,
			)
			yield* accept(
				replica,
				yield* buildAction(
					replica,
					"doc",
					"Peer reference",
					staged => [
						staged.edit("doc", staged.text("doc") + "\n![Peer](asset:photo)"),
					],
					"peer-reference",
				),
			)
			let compensation = yield* undoAction(replica, original)
			expect(compensation.changes).toHaveLength(1)
			yield* accept(replica, compensation, original)
			expect(replica.fields("comment")).toMatchObject({
				type: "comment",
				body: "Original note",
			})
			expect(replica.fields("photo")).toMatchObject({
				type: "asset",
				data: "image-bytes",
				name: "Photo.png",
			})
			expect(replica.text("doc")).toBe("Base\n![Peer](asset:photo)")
		}),
	))

test("metadata compensation follows frontmatter while preserving the canonical source marker", () =>
	run(
		Effect.gen(function* () {
			let { replica } = yield* setup("---\ntitle: Before\n---\nBody")
			let original = yield* accept(
				replica,
				yield* buildAction(replica, "doc", "Migrate and rename", staged => [
					staged.set("doc", "metadata", "frontmatter-v1"),
					staged.edit("doc", "---\ntitle: After\n---\nBody"),
				]),
			)
			let compensation = yield* undoAction(replica, original)
			expect(compensation.changes).toHaveLength(1)
			yield* accept(replica, compensation, original)
			expect(replica.metadata("doc").title).toBe("Before")
			expect(replica.fields("doc").metadata).toBe("frontmatter-v1")
		}),
	))

test("explicit permission-only compensation retains exact observed guards while mixed content undo keeps current access", () =>
	run(
		Effect.gen(function* () {
			let { replica } = yield* setup()
			let grant = yield* accept(
				replica,
				yield* buildAction(replica, "doc", "Grant reader", staged => [
					staged.set("doc", "access:guest", "reader"),
				]),
			)
			let revoke = yield* undoAction(replica, grant)
			expect(revoke.changes[0]?.value).toBe("")
			expect(revoke.accessGuards).toEqual([
				{ field: "access:guest", observed: grant.changes[0]?.id },
			])
			let undone = yield* accept(replica, revoke, grant)
			expect(replica.fields("doc")["access:guest"]).toBe("")
			let redo = yield* undoAction(replica, undone)
			yield* accept(replica, redo, undone)
			expect(replica.fields("doc")["access:guest"]).toBe("reader")
		}),
	))

test("legacy undo guards remain valid when matching and return typed stale failures after independent changes", () =>
	run(
		Effect.gen(function* () {
			let { replica } = yield* setup()
			let action = yield* accept(
				replica,
				yield* buildAction(replica, "doc", "Mode", staged => [
					staged.set("doc", "mode", "slideshow"),
				]),
			)
			let undo = yield* undoAction(replica, action),
				crypto = yield* Crypto.Crypto
			let state = encode(
				yield* crypto.digest(
					"SHA-256",
					new TextEncoder().encode(replica.revision("doc")),
				),
			)
			let guarded = { ...undo, guards: [{ target: "doc", state }] }
			expect(
				(yield* committedAction(replica, guarded, "owner", action)).undoOf,
			).toBe(action.id)
			yield* accept(
				replica,
				yield* buildAction(
					replica,
					"doc",
					"Unrelated peer setting",
					staged => [staged.set("doc", "other", "peer")],
					"peer",
				),
			)
			let result = yield* accept(replica, guarded, action).pipe(Effect.result)
			expect(result._tag).toBe("Failure")
			if (result._tag === "Failure")
				expect(result.failure).toMatchObject({
					_tag: "UndoUnavailable",
					reason: "Stale",
				})
			yield* accept(replica, undo, action)
			expect(replica.fields("doc").mode).toBe("")
			expect(replica.fields("doc").other).toBe("peer")
		}),
	))

test("plain record deletion supports cold undo and redo without mistaking inherited fields for peer changes", () =>
	run(
		Effect.gen(function* () {
			let { replica } = yield* setup()
			yield* accept(
				replica,
				yield* buildAction(replica, "doc", "Records", staged => [
					...newComment(
						staged,
						"comment",
						"doc",
						"Base",
						"Original note",
						"Owner",
					),
					...setFields(staged, "photo", {
						type: "asset",
						document: "doc",
						data: "image-bytes",
					}),
				]),
			)
			let deletion = yield* accept(
				replica,
				yield* buildAction(replica, "doc", "Delete records", staged => [
					staged.set("comment", "type", "deleted"),
					staged.set("photo", "type", "deleted"),
				]),
			)
			let undo = yield* accept(
				replica,
				yield* undoAction(replica, deletion),
				deletion,
			)
			expect(
				undo.retained?.some(
					field => field.target === "comment" && field.field === "body",
				),
			).toBe(true)
			let cold = reopen(replica)
			let redo = yield* undoAction(cold, undo)
			expect(redo.changes).toHaveLength(2)
			yield* accept(cold, redo, undo)
			for (let target of ["comment", "photo"])
				expect(cold.fields(target).type).toBe("deleted")
		}),
	))

test("redo of record deletion preserves peer edits regardless of the peer's clock relative to the restoration", () =>
	run(
		Effect.gen(function* () {
			let { replica } = yield* setup()
			yield* accept(
				replica,
				yield* buildAction(replica, "doc", "Records", staged => [
					...newComment(
						staged,
						"comment",
						"doc",
						"Base",
						"Original note",
						"Owner",
					),
					...setFields(staged, "photo", {
						type: "asset",
						document: "doc",
						data: "image-bytes",
					}),
				]),
			)
			let deletion = yield* accept(
				replica,
				yield* buildAction(replica, "doc", "Delete", staged => [
					staged.set("comment", "type", "deleted"),
					staged.set("photo", "type", "deleted"),
				]),
			)
			let peer = yield* buildAction(
				replica,
				"doc",
				"Concurrent peer",
				staged => [
					staged.set("comment", "body", "Peer note"),
					staged.set("photo", "data", "peer-bytes"),
				],
				"aaa-peer",
			)
			yield* accept(
				replica,
				yield* buildAction(
					replica,
					"doc",
					"Advance unrelated frontier",
					staged => [
						staged.set("doc", "other", "value"),
						staged.set("doc", "another", "value"),
					],
				),
			)
			let undo = yield* accept(
				replica,
				yield* undoAction(replica, deletion),
				deletion,
			)
			expect(peer.changes.every(change => change.id < undo.id)).toBe(true)
			yield* accept(replica, peer)
			let before = replica.checkpoint()
			let blocked = yield* undoAction(replica, undo).pipe(Effect.result)
			expect(blocked._tag).toBe("Failure")
			if (blocked._tag === "Failure")
				expect(blocked.failure).toMatchObject({
					_tag: "UndoUnavailable",
					reason: "Exhausted",
				})
			expect(replica.checkpoint()).toEqual(before)
			expect(replica.fields("comment")).toMatchObject({
				type: "comment",
				body: "Peer note",
			})
			expect(replica.fields("photo")).toMatchObject({
				type: "asset",
				data: "peer-bytes",
			})
		}),
	))

test("legacy restoration without record provenance refuses whole mixed compensation", () =>
	run(
		Effect.gen(function* () {
			let { replica } = yield* setup()
			yield* accept(
				replica,
				yield* buildAction(replica, "doc", "Comment", staged =>
					newComment(staged, "comment", "doc", "Base", "Note", "Owner"),
				),
			)
			let deletion = yield* accept(
				replica,
				yield* buildAction(replica, "doc", "Delete", staged => [
					staged.set("comment", "type", "deleted"),
				]),
			)
			let restoration = yield* accept(
				replica,
				yield* buildAction(replica, "doc", "Restore and type", staged => [
					staged.set("comment", "type", "comment"),
					staged.edit("doc", "Base own"),
				]),
			)
			let legacy = Schema.decodeUnknownSync(CommittedActionSchema)({
				...restoration,
				retained: undefined,
			})
			let before = replica.checkpoint()
			let unavailable = yield* undoAction(replica, legacy).pipe(Effect.result)
			expect(unavailable._tag).toBe("Failure")
			if (unavailable._tag === "Failure")
				expect(unavailable.failure).toMatchObject({
					_tag: "UndoUnavailable",
					reason: "BelowFloor",
				})
			expect(replica.checkpoint()).toEqual(before)
			expect(deletion.changes).toHaveLength(1)
		}),
	))

test("a peer-owned type protects an old restoration without preventing eligible source compensation", () =>
	run(
		Effect.gen(function* () {
			let { replica } = yield* setup()
			yield* accept(
				replica,
				yield* buildAction(replica, "doc", "Comment", staged =>
					newComment(staged, "comment", "doc", "Base", "Note", "Owner"),
				),
			)
			yield* accept(
				replica,
				yield* buildAction(replica, "doc", "Delete", staged => [
					staged.set("comment", "type", "deleted"),
				]),
			)
			let restoration = yield* accept(
				replica,
				yield* buildAction(replica, "doc", "Restore and type", staged => [
					staged.set("comment", "type", "comment"),
					staged.set("comment", "body", "Restored note"),
					staged.edit("doc", "Base own"),
				]),
			)
			yield* accept(
				replica,
				yield* buildAction(
					replica,
					"doc",
					"Peer type",
					staged => [staged.set("comment", "type", "comment")],
					"peer",
				),
			)
			let legacy = Schema.decodeUnknownSync(CommittedActionSchema)({
				...restoration,
				retained: undefined,
			})
			let compensation = yield* undoAction(replica, legacy)
			expect(compensation.changes).toHaveLength(1)
			let accepted = yield* committedAction(
				replica,
				compensation,
				"owner",
				restoration,
			)
			yield* applyAction(replica, accepted)
			expect(replica.text("doc")).toBe("Base")
			expect(replica.fields("comment")).toMatchObject({
				type: "comment",
				body: "Restored note",
			})
		}),
	))

test("prepared offline actions retain whole-document provenance through encoding and cold restore", () =>
	run(
		Effect.gen(function* () {
			let replica = new Replica("owner")
			yield* accept(
				replica,
				yield* buildAction(replica, "doc", "Create", staged =>
					newDocument(staged, "doc", "Untitled", "Base"),
				),
			)
			let before = replica.checkpoint()
			let proposal = yield* buildAction(
				replica,
				"doc",
				"Discuss and attach",
				staged => [
					...setFields(staged, "comment", {
						document: "doc",
						type: "comment",
						body: "Note",
					}),
					...setFields(staged, "photo", {
						document: "doc",
						type: "asset",
						name: "Photo",
						blob: "reference",
					}),
					staged.set("doc", "mode", "slideshow"),
					staged.edit("doc", "Base\n![Photo](asset:photo)"),
				],
			)
			let prepared = yield* prepareAction(replica, proposal, "owner")
			expect(replica.checkpoint()).toEqual(before)
			let encoded = Schema.encodeSync(PreparedActionSchema)(prepared)
			let restored = Schema.decodeUnknownSync(PreparedActionSchema)(
				structuredClone(encoded),
			)
			replica.apply(proposal.changes.map(parseOperation))
			let cold = new Replica("undo-device")
			cold.restore(parseCheckpoint(structuredClone(replica.checkpoint())))
			let undo = yield* undoAction(cold, restored)
			let acceptedOriginal = yield* committedAction(
				yield* restoreBefore(before),
				proposal,
				"owner",
			)
			let canonicalUndo = yield* committedAction(
				cold,
				undo,
				"owner",
				acceptedOriginal,
			)
			yield* applyAction(cold, canonicalUndo)
			expect(cold.text("doc")).toBe("Base")
			expect(cold.fields("comment").type).toBe("deleted")
			expect(cold.fields("photo").type).toBe("deleted")
			expect(cold.fields("doc").mode).toBe("")
			let redo = yield* undoAction(cold, canonicalUndo)
			let canonicalRedo = yield* committedAction(
				cold,
				redo,
				"owner",
				canonicalUndo,
			)
			yield* applyAction(cold, canonicalRedo)
			expect(cold.text("doc")).toBe("Base\n![Photo](asset:photo)")
			expect(cold.fields("comment").body).toBe("Note")
			expect(cold.fields("photo").name).toBe("Photo")
			expect(cold.fields("doc").mode).toBe("slideshow")
		}),
	))

function restoreBefore(checkpoint: ReturnType<Replica["checkpoint"]>) {
	return Effect.sync(() => {
		let replica = new Replica("canonical")
		replica.restore(checkpoint)
		return replica
	})
}

test("canonical before-images replace local preparation when a peer changes a register before acceptance", () =>
	run(
		Effect.gen(function* () {
			let replica = new Replica("owner")
			yield* accept(
				replica,
				yield* buildAction(replica, "doc", "Create", staged => [
					...newDocument(staged, "doc", "Untitled", "Base"),
					staged.set("doc", "mode", "preview"),
				]),
			)
			let proposal = yield* buildAction(
				replica,
				"doc",
				"Local settings",
				staged => [
					staged.set("doc", "note", "Clock step"),
					staged.set("doc", "mode", "slideshow"),
				],
			)
			let prepared = yield* prepareAction(replica, proposal, "owner")
			yield* accept(
				replica,
				yield* buildAction(
					replica,
					"doc",
					"Peer settings",
					staged => [staged.set("doc", "mode", "teleprompter")],
					"peer",
				),
			)
			let canonical = yield* accept(replica, proposal)
			expect(prepared.before.find(field => field.field === "mode")?.value).toBe(
				"preview",
			)
			expect(
				canonical.before.find(field => field.field === "mode")?.value,
			).toBe("teleprompter")
			let provisionalUndo = yield* undoAction(replica, prepared, "undo-device")
			let refused = yield* committedAction(
				replica,
				provisionalUndo,
				"owner",
				canonical,
			).pipe(Effect.result)
			expect(refused._tag).toBe("Failure")
			if (refused._tag === "Failure")
				expect(refused.failure).toMatchObject({
					_tag: "UndoUnavailable",
					reason: "Stale",
				})
			let undo = yield* undoAction(replica, canonical, "undo-device")
			yield* accept(replica, undo, canonical)
			expect(replica.fields("doc").mode).toBe("teleprompter")
			expect(replica.text("doc")).toBe("Base")
		}),
	))

test("theme text undo and redo retain the document and peer edits", () =>
	run(
		Effect.gen(function* () {
			let { replica } = yield* setup("Document body")
			yield* accept(
				replica,
				yield* buildAction(replica, "doc", "Create theme", staged => [
					...setFields(staged, "theme", { type: "theme", document: "doc" }),
					staged.edit("theme", "Base"),
				]),
			)
			let typed = yield* accept(
				replica,
				yield* buildAction(replica, "doc", "Type theme", staged => [
					staged.edit("theme", "Base mine"),
				]),
			)
			yield* accept(
				replica,
				yield* buildAction(
					replica,
					"doc",
					"Peer theme",
					staged => [staged.edit("theme", "Base mine peer")],
					"peer",
				),
			)
			let undo = yield* accept(
				replica,
				yield* undoAction(replica, typed),
				typed,
			)
			expect(replica.text("theme")).toBe("Base peer")
			expect(replica.text("doc")).toBe("Document body")
			yield* accept(replica, yield* undoAction(replica, undo), undo)
			expect(replica.text("theme")).toBe("Base mine peer")
			expect(replica.text("doc")).toBe("Document body")
		}),
	))

test("child text cancellation rejects unowned and foreign document records", () =>
	run(
		Effect.gen(function* () {
			for (let owner of ["", "other-document"]) {
				let { replica } = yield* setup()
				if (owner) replica.set("child", "document", owner)
				let text = replica.edit("child", "Foreign text")
				if (!text) throw new Error("Missing text operation")
				let cancel = replica.cancel("child", text.id)
				let result = yield* validateAction(replica, {
					id: cancel.id,
					document: "doc",
					actor: cancel.actor,
					undoOf: text.id,
					changes: [cancel],
				}).pipe(Effect.result)
				expect(result._tag).toBe("Failure")
				expect(replica.text("doc")).toBe("Base")
			}
		}),
	))
