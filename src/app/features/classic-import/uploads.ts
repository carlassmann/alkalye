import { z } from "zod"
import { app } from "@/jazz/schema"
import { jazz } from "@/jazz/server"
import { classicIdSchema } from "./contract"
import { stableId, unpackBytes } from "./conversion"
import { verifiedIdentity, authorizeSnapshot } from "./authorization"
export { uploadChunk, readBytes, cleanupUploads, discardChunks }

async function uploadChunk(accountId: string, input: unknown) {
	return serializeUpload(accountId, async () => {
		let chunk = z
			.object({
				challengeId: z.uuid(),
				classicId: classicIdSchema,
				kind: z.enum(["account", "document", "space", "theme"]),
				uploadId: z.string().regex(/^[0-9a-f]{64}$/),
				byteLength: z.number().int().positive().max(MAX_UPLOAD_BYTES),
				part: z.number().int().min(0),
				base64: z.string().max(CHUNK_BASE64_SIZE),
			})
			.parse(input)
		let identity = await verifiedIdentity(accountId, chunk.challengeId)
		await authorizeSnapshot(identity.classicId, chunk)
		await cleanupUploads()
		let parts = Math.ceil(chunk.byteLength / CHUNK_BYTES)
		if (chunk.part >= parts)
			throw new Error("Classic chunk exceeds declared upload size")
		let data = Uint8Array.from(atob(chunk.base64), char => char.charCodeAt(0))
		let expected = Math.min(
			CHUNK_BYTES,
			chunk.byteLength - chunk.part * CHUNK_BYTES,
		)
		if (data.length !== expected) throw new Error("Classic chunk size mismatch")
		let uploadRowId = await stableId(`upload:${accountId}:${chunk.uploadId}`)
		let upload = await jazz.db.one(
			app.classicUploads
				.where({ id: uploadRowId })
				.includeDeleted()
				.select("*", "$deletedAt"),
		)
		if (
			upload &&
			!upload.$deletedAt &&
			(upload.byteLength !== chunk.byteLength ||
				upload.classicId !== chunk.classicId ||
				upload.kind !== chunk.kind)
		)
			throw new Error("Classic upload scope mismatch")
		if (!upload || upload.$deletedAt) {
			let uploads = await jazz.db.all(
				app.classicUploads.where({ ownerId: accountId }),
			)
			if (
				uploads.length >= 32 ||
				uploads.reduce((sum, row) => sum + row.byteLength, 0) +
					chunk.byteLength >
					MAX_ACCOUNT_UPLOAD_BYTES
			)
				throw new Error("Classic account upload quota exceeded")
			let values = {
				ownerId: accountId,
				uploadId: chunk.uploadId,
				classicId: chunk.classicId,
				kind: chunk.kind,
				byteLength: chunk.byteLength,
				expiresAt: new Date(Date.now() + UPLOAD_TTL),
			}
			let slots = await reserveUploadSlots(accountId, chunk.byteLength)
			let write = await jazz.db.transaction(tx => {
				if (upload) tx.restore(app.classicUploads, uploadRowId, values)
				else tx.insert(app.classicUploads, values, { id: uploadRowId })
				for (let slot of slots) {
					let values = { ownerId: accountId, uploadId: chunk.uploadId }
					if (slot.deleted) tx.restore(app.classicUploadSlots, slot.id, values)
					else tx.insert(app.classicUploadSlots, values, { id: slot.id })
				}
			})
			await write.wait({ tier: "global" })
		}
		let id = await stableId(
			`chunk:${accountId}:${chunk.uploadId}:${chunk.part}`,
		)
		let existing = await jazz.db.one(
			app.classicImportChunks
				.where({ id })
				.includeDeleted()
				.select("*", "$deletedAt"),
		)
		let values = {
			ownerId: accountId,
			uploadId: chunk.uploadId,
			part: chunk.part,
			data,
			createdAt: new Date(),
		}
		if (existing?.$deletedAt)
			await jazz.db
				.restore(app.classicImportChunks, id, values)
				.wait({ tier: "global" })
		else if (!existing)
			await jazz.db
				.insert(app.classicImportChunks, values, { id })
				.wait({ tier: "global" })
		return { id }
	})
}
async function readBytes(
	accountId: string,
	value: { base64?: string; uploadId?: string; sha256: string },
) {
	if (value.base64 !== undefined) {
		if (value.base64.length > CHUNK_BASE64_SIZE)
			throw new Error("Use chunks for large Classic assets")
		return unpackBytes({ base64: value.base64, sha256: value.sha256 })
	}
	if (value.uploadId !== value.sha256)
		throw new Error("Invalid Classic upload reference")
	let upload = await jazz.db.one(
		app.classicUploads.where({ ownerId: accountId, uploadId: value.uploadId }),
	)
	if (
		!upload ||
		upload.expiresAt.getTime() <= Date.now() ||
		upload.byteLength > MAX_UPLOAD_BYTES
	)
		throw new Error("Classic upload expired or oversized")
	let chunks = await jazz.db.all(
		app.classicImportChunks.where({
			ownerId: accountId,
			uploadId: value.uploadId,
		}),
	)
	chunks.sort((a, b) => a.part - b.part)
	if (
		chunks.length !== Math.ceil(upload.byteLength / CHUNK_BYTES) ||
		chunks.some(
			(chunk, index) =>
				chunk.part !== index ||
				chunk.data.length !==
					Math.min(CHUNK_BYTES, upload.byteLength - index * CHUNK_BYTES),
		)
	)
		throw new Error("Classic upload incomplete")
	let data = new Uint8Array(upload.byteLength)
	for (let chunk of chunks) data.set(chunk.data, chunk.part * CHUNK_BYTES)
	let digest = Array.from(
		new Uint8Array(await crypto.subtle.digest("SHA-256", data)),
		byte => byte.toString(16).padStart(2, "0"),
	).join("")
	if (digest !== value.sha256)
		throw new Error("Classic asset checksum mismatch")
	return data
}

async function cleanupUploads() {
	for (let upload of await jazz.db.all(app.classicUploads))
		if (upload.expiresAt.getTime() <= Date.now())
			await discardChunks(upload.ownerId, { uploadId: upload.uploadId })
	// Also retire chunks written by an older backend without upload reservations.
	for (let chunk of await jazz.db.all(
		app.classicImportChunks.select("id", "createdAt"),
	))
		if (chunk.createdAt.getTime() <= Date.now() - UPLOAD_TTL)
			await jazz.db
				.delete(app.classicImportChunks, chunk.id)
				.wait({ tier: "global" })
}
async function discardChunks(accountId: string, value: unknown): Promise<void> {
	if (!value || typeof value !== "object") return
	if ("uploadId" in value && typeof value.uploadId === "string") {
		for (let chunk of await jazz.db.all(
			app.classicImportChunks.where({
				ownerId: accountId,
				uploadId: value.uploadId,
			}),
		)) {
			await jazz.db
				.update(app.classicImportChunks, chunk.id, { data: new Uint8Array() })
				.wait({ tier: "global" })
			await jazz.db
				.delete(app.classicImportChunks, chunk.id)
				.wait({ tier: "global" })
		}
		for (let slot of await jazz.db.all(
			app.classicUploadSlots.where({
				ownerId: accountId,
				uploadId: value.uploadId,
			}),
		))
			await jazz.db
				.delete(app.classicUploadSlots, slot.id)
				.wait({ tier: "global" })
		let upload = await jazz.db.one(
			app.classicUploads.where({
				ownerId: accountId,
				uploadId: value.uploadId,
			}),
		)
		if (upload)
			await jazz.db
				.delete(app.classicUploads, upload.id)
				.wait({ tier: "global" })
		return
	}
	for (let child of Object.values(value)) await discardChunks(accountId, child)
}

let CHUNK_BASE64_SIZE = 65536
let CHUNK_BYTES = (CHUNK_BASE64_SIZE / 4) * 3
let MAX_UPLOAD_BYTES = 512 * 1024 * 1024
let MAX_ACCOUNT_UPLOAD_BYTES = 1024 * 1024 * 1024
let UPLOAD_TTL = 30 * 60_000
let uploadLocks = new Map<string, Promise<unknown>>()
async function reserveUploadSlots(accountId: string, byteLength: number) {
	let slots = []
	let needed = Math.ceil(byteLength / (32 * 1024 * 1024))
	for (let index = 0; index < 32 && slots.length < needed; index++) {
		let id = await stableId(`upload-slot:${accountId}:${index}`)
		let row = await jazz.db.one(
			app.classicUploadSlots
				.where({ id })
				.includeDeleted()
				.select("$deletedAt"),
		)
		if (!row || row.$deletedAt) slots.push({ id, deleted: !!row })
	}
	if (slots.length < needed)
		throw new Error("Classic account upload quota exceeded")
	return slots
}
async function serializeUpload<T>(accountId: string, run: () => Promise<T>) {
	let previous = uploadLocks.get(accountId) ?? Promise.resolve()
	let next = previous.catch(() => {}).then(run)
	uploadLocks.set(accountId, next)
	try {
		return await next
	} finally {
		if (uploadLocks.get(accountId) === next) uploadLocks.delete(accountId)
	}
}
