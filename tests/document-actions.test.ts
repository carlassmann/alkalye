import { expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import { Replica } from "../src/shared/crdt"
import { buildAction, DocumentConflict } from "../src/shared/document-actions"
import { newDocument } from "../src/shared/documents"

test("isolated action actors preserve observed permissions without reserving live clocks", async () => {
	let replica = new Replica("source-writer")
	newDocument(replica, "document", "Untitled", "Source")
	let permission = replica.set("document", "access:guest", "reader")
	let before = replica.checkpoint()
	let actions = await Effect.runPromise(
		Effect.all(
			["first-action", "second-action"].map(actor =>
				buildAction(
					replica,
					"document",
					"Grant writer",
					staged => [staged.set("document", "access:guest", "writer")],
					actor,
				),
			),
			{ concurrency: "unbounded" },
		),
	)
	expect(actions[0]?.id).not.toBe(actions[1]?.id)
	for (let action of actions) {
		expect(action.changes[0]?.actor).toBe(action.actor)
		expect(action.changes[0]?.clock).toBe(before.clock + 1)
		expect(action.accessGuards).toEqual([
			{ field: "access:guest", observed: permission.id },
		])
	}
	expect(replica.checkpoint()).toEqual(before)
})

test("a rejected action builder cannot leak staged source or metadata into its input", async () => {
	let replica = new Replica("source-writer")
	newDocument(replica, "document", "Untitled", "Source")
	let before = replica.checkpoint()
	let result = await Effect.runPromise(
		buildAction(
			replica,
			"document",
			"Interrupted command",
			staged => {
				staged.edit("document", "Changed source")
				staged.set("document", "mode", "slideshow")
				throw new Error("Command failed")
			},
			"isolated-action",
		).pipe(Effect.result),
	)
	expect(result._tag).toBe("Failure")
	if (result._tag === "Failure")
		expect(result.failure).toBeInstanceOf(DocumentConflict)
	expect(replica.checkpoint()).toEqual(before)
})
