import * as Config from "effect/Config"
import * as Context from "effect/Context"
import * as Crypto from "effect/Crypto"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as SqlClient from "effect/sql/SqlClient"
import * as SqlError from "effect/sql/SqlError"
import {
	BlobDigestSchema,
	maximumBlobChunkBytes,
	maximumDocumentBlobBytes,
} from "../shared/document-blobs"
import { BlobQuotaExceeded } from "../shared/document-errors"
import { IdentifierSchema } from "../shared/model"

export let BlobAllocationSchema = Schema.Struct({
	document: IdentifierSchema,
	digest: BlobDigestSchema,
	owner: IdentifierSchema,
	size: Schema.Int.check(
		Schema.isBetween({ minimum: 1, maximum: maximumBlobChunkBytes }),
	),
})
export type BlobAllocation = typeof BlobAllocationSchema.Type
export interface BlobReservation extends BlobAllocation {
	receipt: string
	state: "pending" | "confirmed"
}
export type UploadRefusal = "notCommitted" | "invalidBytes"

export class CloudflareBlobBudget extends Context.Service<
	CloudflareBlobBudget,
	Effect.Success<ReturnType<typeof makeBudget>>
>()("CloudflareBlobBudget") {
	static get live() {
		return Layer.effect(CloudflareBlobBudget, makeBudget())
	}
}
function makeBudget() {
	return Effect.gen(function* () {
		let sql = yield* SqlClient.SqlClient
		let crypto = yield* Crypto.Crypto
		let accountLimit = yield* Config.schema(
			Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
			"ALKALYE_ACCOUNT_BLOB_BYTES",
		).pipe(Config.withDefault(maximumDocumentBlobBytes * 4))
		let serverLimit = yield* Config.schema(
			Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
			"ALKALYE_SERVER_BLOB_BYTES",
		).pipe(Config.withDefault(maximumDocumentBlobBytes * 16))
		yield* sql`CREATE TABLE IF NOT EXISTS cloudflare_blob_budget(document TEXT NOT NULL,digest TEXT NOT NULL,owner TEXT NOT NULL,size INTEGER NOT NULL CHECK(size>0),receipt TEXT NOT NULL,shared INTEGER NOT NULL DEFAULT 0 CHECK(shared IN (0,1)),state TEXT NOT NULL CHECK(state IN ('pending','confirmed')),PRIMARY KEY(document,digest))`
		yield* sql`CREATE INDEX IF NOT EXISTS cloudflare_blob_budget_owner ON cloudflare_blob_budget(owner)`
		yield* sql.withTransaction(
			Effect.gen(function* () {
				yield* sql`CREATE TABLE IF NOT EXISTS cloudflare_blob_account_usage(owner TEXT PRIMARY KEY,size INTEGER NOT NULL CHECK(size>=0))`
				yield* sql`CREATE TABLE IF NOT EXISTS cloudflare_blob_server_usage(singleton INTEGER PRIMARY KEY CHECK(singleton=1),size INTEGER NOT NULL CHECK(size>=0))`
				let initialized =
					yield* sql`SELECT singleton FROM cloudflare_blob_server_usage WHERE singleton=1`
				if (!initialized.length) {
					yield* sql`INSERT INTO cloudflare_blob_account_usage(owner,size) SELECT owner,SUM(size) FROM cloudflare_blob_budget GROUP BY owner`
					yield* sql`INSERT INTO cloudflare_blob_server_usage(singleton,size) SELECT 1,COALESCE(SUM(size),0) FROM cloudflare_blob_budget`
				}
				yield* sql`CREATE TRIGGER IF NOT EXISTS cloudflare_blob_budget_insert AFTER INSERT ON cloudflare_blob_budget BEGIN INSERT INTO cloudflare_blob_account_usage(owner,size) VALUES(NEW.owner,NEW.size) ON CONFLICT(owner) DO UPDATE SET size=size+NEW.size; UPDATE cloudflare_blob_server_usage SET size=size+NEW.size WHERE singleton=1; END`
				yield* sql`CREATE TRIGGER IF NOT EXISTS cloudflare_blob_budget_delete AFTER DELETE ON cloudflare_blob_budget BEGIN UPDATE cloudflare_blob_account_usage SET size=size-OLD.size WHERE owner=OLD.owner; UPDATE cloudflare_blob_server_usage SET size=size-OLD.size WHERE singleton=1; END`
				yield* sql`CREATE TRIGGER IF NOT EXISTS cloudflare_blob_budget_owner_change AFTER UPDATE OF owner ON cloudflare_blob_budget WHEN OLD.owner<>NEW.owner BEGIN UPDATE cloudflare_blob_account_usage SET size=size-OLD.size WHERE owner=OLD.owner; INSERT INTO cloudflare_blob_account_usage(owner,size) VALUES(NEW.owner,NEW.size) ON CONFLICT(owner) DO UPDATE SET size=size+NEW.size; END`
			}),
		)
		function allocate(input: BlobAllocation, imported: boolean) {
			return sql.withTransaction(
				Effect.gen(function* () {
					let allocation = yield* Schema.decodeUnknownEffect(
						BlobAllocationSchema,
					)(input).pipe(Effect.mapError(storageFailure))
					let rows =
						yield* sql<BlobReservation>`SELECT document,digest,owner,size,receipt,state FROM cloudflare_blob_budget WHERE document=${allocation.document} AND digest=${allocation.digest}`
					let existing = rows[0]
					if (existing) {
						if (
							existing.owner !== allocation.owner ||
							existing.size !== allocation.size
						)
							return yield* Effect.fail(
								storageFailure(
									new Error("Attachment allocation identity conflicts"),
								),
							)
						if (imported && existing.state === "pending") {
							yield* sql`UPDATE cloudflare_blob_budget SET state='confirmed' WHERE document=${existing.document} AND digest=${existing.digest} AND receipt=${existing.receipt}`
							return {
								...existing,
								state: "confirmed",
							} satisfies BlobReservation
						}
						if (existing.state === "pending")
							yield* sql`UPDATE cloudflare_blob_budget SET shared=1 WHERE document=${existing.document} AND digest=${existing.digest} AND receipt=${existing.receipt}`
						return existing
					}
					if (!imported) {
						let account = yield* sql<{
							size: number
						}>`SELECT size FROM cloudflare_blob_account_usage WHERE owner=${allocation.owner}`
						let server = yield* sql<{
							size: number
						}>`SELECT size FROM cloudflare_blob_server_usage WHERE singleton=1`
						if ((account[0]?.size ?? 0) + allocation.size > accountLimit)
							return yield* Effect.fail(
								new BlobQuotaExceeded({
									scope: "account",
									limit: accountLimit,
									message:
										"This account's retained attachments exceed its storage limit",
								}),
							)
						if ((server[0]?.size ?? 0) + allocation.size > serverLimit)
							return yield* Effect.fail(
								new BlobQuotaExceeded({
									scope: "server",
									limit: serverLimit,
									message:
										"The server's retained attachments exceed its storage limit",
								}),
							)
					}
					let receipt = yield* crypto.randomUUIDv4.pipe(
						Effect.mapError(storageFailure),
					)
					let state: BlobReservation["state"] = imported
						? "confirmed"
						: "pending"
					yield* sql`INSERT INTO cloudflare_blob_budget(document,digest,owner,size,receipt,state) VALUES(${allocation.document},${allocation.digest},${allocation.owner},${allocation.size},${receipt},${state})`
					return { ...allocation, receipt, state }
				}),
			)
		}
		return {
			restoreDocumentOwner: (
				document: string,
				expectedOwner: string,
				originalOwner: string,
			) =>
				sql.withTransaction(
					Effect.gen(function* () {
						let rows = yield* sql<{
							owner: string
						}>`SELECT owner FROM cloudflare_blob_budget WHERE document=${document}`
						if (rows.every(row => row.owner === originalOwner)) return
						if (rows.some(row => row.owner !== expectedOwner))
							return yield* Effect.fail(
								storageFailure(
									new Error("Attachment rollback ownership changed"),
								),
							)
						// Certified import refusal restores preexisting durable ownership, even after source quota was reused.
						yield* sql`UPDATE cloudflare_blob_budget SET owner=${originalOwner} WHERE document=${document} AND owner=${expectedOwner}`
					}),
				),
			reassignDocument: (
				document: string,
				expectedOwner: string,
				nextOwner: string,
			) =>
				sql.withTransaction(
					Effect.gen(function* () {
						if (expectedOwner === nextOwner) return
						let rows = yield* sql<{
							owner: string
							size: number
						}>`SELECT owner,size FROM cloudflare_blob_budget WHERE document=${document}`
						if (rows.every(row => row.owner === nextOwner)) return
						if (rows.some(row => row.owner !== expectedOwner))
							return yield* Effect.fail(
								storageFailure(new Error("Attachment owner changed")),
							)
						let usage = yield* sql<{
							size: number
						}>`SELECT size FROM cloudflare_blob_account_usage WHERE owner=${nextOwner}`
						if (
							(usage[0]?.size ?? 0) +
								rows.reduce((size, row) => size + row.size, 0) >
							accountLimit
						)
							return yield* Effect.fail(
								new BlobQuotaExceeded({
									scope: "account",
									limit: accountLimit,
									message:
										"The destination owner's retained attachments exceed its storage limit",
								}),
							)
						yield* sql`UPDATE cloudflare_blob_budget SET owner=${nextOwner} WHERE document=${document} AND owner=${expectedOwner}`
					}),
				),
			reserve: (allocation: BlobAllocation) => allocate(allocation, false),
			// Imported usage is already durable, including when configured quotas were lowered.
			importUsage: (allocation: BlobAllocation) => allocate(allocation, true),
			confirm: (reservation: BlobReservation) =>
				sql.withTransaction(
					Effect.gen(function* () {
						let rows = yield* sql<{
							document: string
						}>`UPDATE cloudflare_blob_budget SET state='confirmed' WHERE document=${reservation.document} AND digest=${reservation.digest} AND size=${reservation.size} AND receipt=${reservation.receipt} RETURNING document`
						if (!rows.length)
							return yield* Effect.fail(
								storageFailure(
									new Error("Attachment reservation receipt changed"),
								),
							)
					}),
				),
			release: (reservation: BlobReservation, refusal: UploadRefusal) => {
				if (refusal !== "notCommitted" && refusal !== "invalidBytes")
					return Effect.fail(
						storageFailure(
							new Error("Attachment outcome is not a certified refusal"),
						),
					)
				return sql.withTransaction(
					sql<{
						document: string
					}>`DELETE FROM cloudflare_blob_budget WHERE document=${reservation.document} AND digest=${reservation.digest} AND size=${reservation.size} AND receipt=${reservation.receipt} AND state='pending' AND shared=0 RETURNING document`.pipe(
						Effect.map(rows => rows.length === 1),
					),
				)
			},
		}
	})
}
function storageFailure(cause: unknown) {
	return new SqlError.SqlError({
		reason: new SqlError.UnknownError({
			cause,
			message: "Attachment budget unavailable",
		}),
	})
}
