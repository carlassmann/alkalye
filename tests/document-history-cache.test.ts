import { expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import { Replica } from "../src/shared/crdt"
import { buildAction, committedAction } from "../src/shared/document-actions"
import { newDocument } from "../src/shared/documents"
import { downloadDocumentHistory } from "../src/client/document-history"
import { webCryptoLayer } from "../src/platform/web-crypto"
import { StorageError } from "../src/platform/errors"

test("optional history uses its verified cached moments offline and during a server outage", async () => {
	let action = await creation()
	let calls = 0
	for (let online of [false, true]) {
		let history = await Effect.runPromise(
			downloadDocumentHistory({
				document: "doc",
				subject: "owner",
				online: () => online,
				storage: {
					get: () => Effect.succeed([{ position: 7, action }]),
					set: () => Effect.void,
				},
				session: {
					historyCursor: () => ({ log: "epoch", position: 14 }),
					historyPage: () =>
						Effect.sync(() => calls++).pipe(
							Effect.andThen(Effect.fail(new Error("Server unavailable"))),
						),
				},
			}),
		)
		expect(history.complete).toBe(false)
		expect((await Effect.runPromise(history.at(7))).text("doc")).toBe(
			"Cached source",
		)
	}
	expect(calls).toBe(1)
})

test("optional history remains readable when its cache is damaged or cannot be written", async () => {
	let action = await creation()
	let cached: unknown = { broken: true }
	let writes = 0
	let history = await Effect.runPromise(
		downloadDocumentHistory({
			document: "doc",
			subject: "owner",
			online: () => true,
			storage: {
				get: () => Effect.succeed(cached),
				set: () =>
					Effect.sync(() => writes++).pipe(
						Effect.andThen(
							Effect.fail(
								new StorageError({
									operation: "cache history",
									cause: new Error("Quota exceeded"),
								}),
							),
						),
					),
			},
			session: {
				historyCursor: () => ({ log: "epoch", position: 7 }),
				historyPage: () => Effect.succeed([{ position: 7, action }]),
			},
		}),
	)
	expect(history.complete).toBe(true)
	expect((await Effect.runPromise(history.at(7))).text("doc")).toBe(
		"Cached source",
	)
	expect(writes).toBe(1)
})

test("optional history reports an unavailable server when no moment has been downloaded", async () => {
	let failure = new Error("Server unavailable")
	let result = await Effect.runPromise(
		downloadDocumentHistory({
			document: "doc",
			subject: "owner",
			online: () => true,
			storage: { get: () => Effect.succeed(undefined), set: () => Effect.void },
			session: {
				historyCursor: () => ({ log: "epoch", position: 7 }),
				historyPage: () => Effect.fail(failure),
			},
		}).pipe(Effect.result),
	)
	expect(result._tag).toBe("Failure")
	if (result._tag === "Failure") expect(result.failure).toBe(failure)
})

function creation() {
	return Effect.runPromise(
		Effect.gen(function* () {
			let replica = new Replica("history-cache")
			let action = yield* buildAction(replica, "doc", "Create", staged =>
				newDocument(staged, "doc", "Untitled", "Cached source"),
			)
			return yield* committedAction(replica, action, "owner")
		}).pipe(Effect.provide(webCryptoLayer)),
	)
}
