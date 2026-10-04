import { expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import { Replica } from "../src/shared/crdt"
import {
	applyAction,
	buildAction,
	committedAction,
	undoAction,
} from "../src/shared/document-actions"
import {
	historicalDocument,
	restoreDocumentState,
} from "../src/shared/document-history"
import type { DocumentMoment } from "../src/shared/document-history"
import { commentRange, newDocument } from "../src/shared/documents"
import { webCryptoLayer } from "../src/platform/web-crypto"
import type { Operation } from "../src/shared/model"

test("whole-document moments replay source, discussion and drawings in accepted order", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			let replica = new Replica("history-test")
			let moments: DocumentMoment[] = []
			function record(
				label: string,
				build: (staged: Replica) => (Operation | null)[],
			) {
				return buildAction(replica, "doc", label, build).pipe(
					Effect.flatMap(proposal =>
						committedAction(replica, proposal, "owner"),
					),
					Effect.tap(action => applyAction(replica, action)),
					Effect.tap(action =>
						Effect.sync(() =>
							moments.push({ position: (moments.length + 1) * 7, action }),
						),
					),
				)
			}
			yield* record("Create", staged =>
				newDocument(staged, "doc", "History", "# Hello\n\nAnchored words."),
			)
			yield* record("Add records", staged => [
				staged.set("discussion", "type", "comment"),
				staged.set("discussion", "document", "doc"),
				staged.set("discussion", "body", "Before"),
				staged.set(
					"discussion",
					"anchor",
					JSON.stringify(
						staged
							.visible("doc")
							.slice(9)
							.map(atom => atom.id),
					),
				),
				staged.set("drawing", "type", "whiteboard"),
				staged.set("drawing", "document", "doc"),
				staged.set("drawing", "name", "Before drawing"),
				staged.set("drawing", "shape:one", "original"),
			])
			let historical = yield* historicalDocument("doc", moments, 14)
			let oldRange = commentRange(
				historical,
				"doc",
				historical.fields("discussion"),
			)
			yield* record("Later", staged => [
				staged.edit("doc", "# Later\n\nDifferent words."),
				staged.set("discussion", "body", "After"),
				staged.set("drawing", "type", "deleted"),
				staged.set("new-record", "type", "whiteboard"),
				staged.set("new-record", "document", "doc"),
				staged.set("doc", "access:guest", "reader"),
			])
			let later = replica.checkpoint()
			let restore = yield* record("Restore", staged =>
				restoreDocumentState(staged, historical, "doc"),
			)
			expect(replica.text("doc")).toBe(historical.text("doc"))
			expect(replica.fields("discussion").body).toBe("Before")
			expect(
				commentRange(replica, "doc", replica.fields("discussion")),
			).toEqual(oldRange)
			expect(replica.fields("drawing").type).toBe("whiteboard")
			expect(replica.fields("drawing")["shape:one"]).toBe("original")
			expect(replica.fields("new-record").type).toBe("deleted")
			expect(replica.fields("doc")["access:guest"]).toBe("reader")
			let undo = yield* undoAction(replica, restore)
			let accepted = yield* committedAction(replica, undo, "owner", restore)
			yield* applyAction(replica, accepted)
			let beforeUndo = new Replica("comparison")
			beforeUndo.restore(later)
			expect(replica.text("doc")).toBe(beforeUndo.text("doc"))
			expect(replica.fields("discussion").body).toBe("After")
			expect(replica.fields("drawing").type).toBe("deleted")
			expect(replica.fields("new-record").type).toBe("whiteboard")
			expect(moments).toHaveLength(4)
		}).pipe(Effect.provide(webCryptoLayer)),
	))

test("time machine rejects incomplete or foreign document histories", async () => {
	let replica = new Replica("history-test")
	let proposal = await Effect.runPromise(
		buildAction(replica, "doc", "Create", staged =>
			newDocument(staged, "doc", "History", "Source"),
		),
	)
	let action = await Effect.runPromise(
		committedAction(replica, proposal, "owner").pipe(
			Effect.provide(webCryptoLayer),
		),
	)
	for (let moments of [[{ position: 3, action }], [{ position: 1, action }]]) {
		let result = await Effect.runPromise(
			historicalDocument("doc", moments, 14).pipe(Effect.result),
		)
		expect(result._tag).toBe("Failure")
	}
	let result = await Effect.runPromise(
		historicalDocument("other", [{ position: 1, action }], 1).pipe(
			Effect.result,
		),
	)
	expect(result._tag).toBe("Failure")
})
