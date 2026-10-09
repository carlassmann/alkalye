import { documentStoreLayer } from "../../src/server/bun-databases"
import * as Effect from "effect/Effect"
import { buildAction, restoreSnapshot } from "./document"
import { commit, Principal, readSnapshot } from "./journal"

let [filename, document, suffix] = Bun.argv.slice(2)
if (!filename || !document || suffix === undefined)
	throw new Error("Expected filename, document and suffix")
await Effect.runPromise(
	Effect.gen(function* () {
		let snapshot = yield* readSnapshot(document)
		if (!snapshot) return yield* Effect.die("Missing document")
		let replica = yield* restoreSnapshot(snapshot, "other-process")
		let action = yield* buildAction(
			replica,
			document,
			"Other process edit",
			staged => [staged.edit(document, staged.text(document) + suffix)],
		)
		let position = yield* commit(action)
		console.log(JSON.stringify({ position }))
		if (Bun.env.HOLD_AFTER_COMMIT === "1") yield* Effect.sleep("1 minute")
	}).pipe(
		Effect.provide(documentStoreLayer(filename)),
		Effect.provideService(Principal, {
			subject: "peer",
			actors: ["other-process"],
			role: "writer",
		}),
	),
)
