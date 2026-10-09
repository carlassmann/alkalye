import { expect, test } from "bun:test"
import * as ConfigProvider from "effect/ConfigProvider"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { sqliteLayer } from "../src/platform/sqlite"
import { webCryptoLayer } from "../src/platform/web-crypto"
import { CloudflareBlobBudget } from "../src/cloudflare/blob-budget"
import { blobDigest } from "../src/shared/document-blobs"

test("global attachment budgets count pending outcomes, isolate receipts and import durable usage", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			let budget = yield* CloudflareBlobBudget
			let digest = yield* blobDigest(new Uint8Array([1, 2, 3, 4]))
			let first = yield* budget.reserve({
				document: "workspace-one-doc",
				owner: "owner",
				digest,
				size: 4,
			})
			expect(
				(yield* budget.reserve({
					document: first.document,
					owner: first.owner,
					digest,
					size: 4,
				})).receipt,
			).toBe(first.receipt)
			let second = yield* budget.reserve({
				document: "workspace-two-doc",
				owner: "owner",
				digest,
				size: 4,
			})
			expect(
				yield* budget
					.reserve({
						document: "account-overflow",
						owner: "owner",
						digest,
						size: 1,
					})
					.pipe(
						Effect.catchTag("BlobQuotaExceeded", error =>
							Effect.succeed(error.scope),
						),
					),
			).toBe("account")
			let other = yield* budget.reserve({
				document: "other-owner-doc",
				owner: "other",
				digest,
				size: 4,
			})
			expect(
				yield* budget
					.reserve({
						document: "server-overflow",
						owner: "third",
						digest,
						size: 1,
					})
					.pipe(
						Effect.catchTag("BlobQuotaExceeded", error =>
							Effect.succeed(error.scope),
						),
					),
			).toBe("server")
			expect(
				yield* budget.release(
					{ ...second, receipt: first.receipt },
					"notCommitted",
				),
			).toBe(false)
			// An unknown request keeps its reservation until an authoritative refusal arrives.
			expect(
				(yield* budget.reserve({
					document: second.document,
					owner: second.owner,
					digest,
					size: 4,
				})).receipt,
			).toBe(second.receipt)
			yield* budget.confirm(first)
			expect(yield* budget.release(first, "invalidBytes")).toBe(false)
			expect(yield* budget.release(second, "notCommitted")).toBe(false)
			expect(yield* budget.release(second, "notCommitted")).toBe(false)
			expect(yield* budget.release(other, "notCommitted")).toBe(true)
			let retry = yield* budget.reserve({
				document: other.document,
				owner: other.owner,
				digest,
				size: 4,
			})
			expect(retry.receipt).not.toBe(other.receipt)
			expect((yield* budget.confirm(other).pipe(Effect.exit))._tag).toBe(
				"Failure",
			)
			expect(yield* budget.release(retry, "invalidBytes")).toBe(true)
			let results = yield* Effect.all(
				[
					budget
						.reserve({ document: "race-one", owner: "other", digest, size: 4 })
						.pipe(Effect.exit),
					budget
						.reserve({ document: "race-two", owner: "other", digest, size: 4 })
						.pipe(Effect.exit),
				],
				{ concurrency: "unbounded" },
			)
			expect(results.filter(result => result._tag === "Success")).toHaveLength(
				1,
			)
			let imported = yield* budget.importUsage({
				document: "legacy-doc",
				owner: "legacy",
				digest,
				size: 5,
			})
			expect(imported.state).toBe("confirmed")
			expect(
				(yield* budget.importUsage({
					document: "legacy-doc",
					owner: "legacy",
					digest,
					size: 5,
				})).receipt,
			).toBe(imported.receipt)
			expect(
				yield* budget
					.reserve({ document: "after-import", owner: "new", digest, size: 1 })
					.pipe(
						Effect.catchTag("BlobQuotaExceeded", error =>
							Effect.succeed(error.scope),
						),
					),
			).toBe("server")
			expect(
				(yield* budget
					.importUsage({
						document: "legacy-doc",
						owner: "wrong",
						digest,
						size: 5,
					})
					.pipe(Effect.exit))._tag,
			).toBe("Failure")
		}).pipe(
			Effect.provide(
				CloudflareBlobBudget.live.pipe(
					Layer.provide(sqliteLayer(":memory:")),
					Layer.provide(webCryptoLayer),
					Layer.provide(
						ConfigProvider.layer(
							ConfigProvider.fromUnknown({
								ALKALYE_ACCOUNT_BLOB_BYTES: 8,
								ALKALYE_SERVER_BLOB_BYTES: 12,
							}),
						),
					),
				),
			),
			Effect.provide(webCryptoLayer),
		),
	)
})

test("attachment ownership moves preserve receipts and refuse destination account overflow atomically", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			let budget = yield* CloudflareBlobBudget
			let digest = yield* blobDigest(new Uint8Array([7, 8, 9]))
			let original = yield* budget.importUsage({
				document: "moving",
				digest,
				owner: "source",
				size: 3,
			})
			yield* budget.importUsage({
				document: "existing",
				digest,
				owner: "destination",
				size: 6,
			})
			let refused = yield* budget
				.reassignDocument("moving", "source", "destination")
				.pipe(
					Effect.catchTag("BlobQuotaExceeded", error =>
						Effect.succeed(error.scope),
					),
				)
			expect(refused).toBe("account")
			expect(
				(yield* budget.reserve({
					document: "moving",
					digest,
					owner: "source",
					size: 3,
				})).receipt,
			).toBe(original.receipt)
			yield* budget.reassignDocument("moving", "source", "third")
			yield* budget.reassignDocument("moving", "source", "third")
			let moved = yield* budget.reserve({
				document: "moving",
				digest,
				owner: "third",
				size: 3,
			})
			expect(moved.receipt).toBe(original.receipt)
			expect(moved.state).toBe("confirmed")
			yield* budget.confirm(original)
			let movingPending = yield* budget.reserve({
				document: "pending-move",
				digest,
				owner: "pending-source",
				size: 1,
			})
			yield* budget.reassignDocument(
				"pending-move",
				"pending-source",
				"pending-target",
			)
			expect(yield* budget.release(movingPending, "notCommitted")).toBe(true)
			yield* budget.importUsage({
				document: "source-refilled",
				digest,
				owner: "source",
				size: 8,
			})
			yield* budget.restoreDocumentOwner("moving", "third", "source")
			yield* budget.restoreDocumentOwner("moving", "third", "source")
			expect(
				(yield* budget.reserve({
					document: "moving",
					digest,
					owner: "source",
					size: 3,
				})).receipt,
			).toBe(original.receipt)
			expect(
				yield* budget
					.reserve({ document: "new-source", digest, owner: "source", size: 1 })
					.pipe(
						Effect.catchTag("BlobQuotaExceeded", error =>
							Effect.succeed(error.scope),
						),
					),
			).toBe("account")
			expect(
				(yield* budget
					.reassignDocument("moving", "wrong", "fourth")
					.pipe(Effect.exit))._tag,
			).toBe("Failure")
		}).pipe(
			Effect.provide(
				CloudflareBlobBudget.live.pipe(
					Layer.provide(sqliteLayer(":memory:")),
					Layer.provide(webCryptoLayer),
					Layer.provide(
						ConfigProvider.layer(
							ConfigProvider.fromUnknown({
								ALKALYE_ACCOUNT_BLOB_BYTES: 8,
								ALKALYE_SERVER_BLOB_BYTES: 12,
							}),
						),
					),
				),
			),
			Effect.provide(webCryptoLayer),
		),
	)
})
