import { afterAll, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { WorkspaceStore } from "../src/server/document-store"
import { Replica } from "../src/shared/crdt"
import { buildAction, restoreSnapshot } from "../src/shared/document-actions"
import { newDocument } from "../src/shared/documents"
import { Identity } from "../src/shared/workspace"
import { webCryptoLayer } from "../src/platform/web-crypto"

let directory = await mkdtemp(join(tmpdir(), "alkalye-revisions-"))
afterAll(() => rm(directory, { recursive: true, force: true }))

test("exact revisions serialize competing writers and include child changes", async () => {
	let filename = join(directory, "competing.sqlite")
	await Effect.runPromise(
		Effect.gen(function* () {
			let store = yield* WorkspaceStore
			yield* store.create("space", "Workspace", "create-space")
			let creation = yield* buildAction(
				new Replica("owner"),
				"doc",
				"Create",
				staged => newDocument(staged, "doc", "Untitled", "Original"),
			)
			yield* store.createDocument("space", creation)
			let snapshot = yield* store.snapshot("doc")
			if (!snapshot) return yield* Effect.die("Missing snapshot")
			let replica = yield* restoreSnapshot(snapshot, "owner")
			let first = yield* buildAction(
				replica,
				"doc",
				"First",
				staged => [staged.set("doc", "note", "First")],
				"owner-first",
			)
			let second = yield* buildAction(
				replica,
				"doc",
				"Second",
				staged => [staged.set("doc", "note", "Second")],
				"owner-second",
			)
			let results = yield* Effect.all(
				[
					store.commit(first, snapshot).pipe(Effect.result),
					store.commit(second, snapshot).pipe(Effect.result),
				],
				{ concurrency: 2 },
			)
			expect(results.filter(result => result._tag === "Success")).toHaveLength(
				1,
			)
			let rejected = results.find(result => result._tag === "Failure")
			expect(rejected?._tag === "Failure" && rejected.failure._tag).toBe(
				"StaleRevision",
			)
			let winner = results[0]?._tag === "Success" ? first : second
			let accepted = yield* store.commit(winner, snapshot)
			let head = yield* store.snapshot("doc")
			expect(head?.position).toBe(accepted)
			expect(yield* store.commit(winner, snapshot)).toBe(accepted)
			let old = yield* restoreSnapshot(snapshot, "owner")
			let comment = yield* buildAction(old, "doc", "Comment", staged => [
				staged.set("comment", "type", "comment"),
				staged.set("comment", "document", "doc"),
				staged.set("comment", "body", "Discuss"),
			])
			yield* store.commit(comment)
			let another = yield* buildAction(
				old,
				"doc",
				"Stale",
				staged => [staged.set("doc", "note", "Stale")],
				"owner-stale",
			)
			let result = yield* store.commit(another, head).pipe(Effect.result)
			expect(result._tag === "Failure" && result.failure._tag).toBe(
				"StaleRevision",
			)
			expect(
				(yield* store.history("doc")).map(moment => moment.action.label),
			).toEqual(["Create", winner.label, "Comment"])
		}).pipe(
			Effect.provideService(Identity, {
				subject: "owner",
				actors: ["owner", "owner-first", "owner-second", "owner-stale"],
			}),
			Effect.provide(
				Layer.merge(WorkspaceStore.layer(filename), webCryptoLayer),
			),
		),
	)
})
