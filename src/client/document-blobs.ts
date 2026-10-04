import * as Context from "effect/Context"
import * as Crypto from "effect/Crypto"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { webCryptoLayer } from "../platform/web-crypto"
import { transferBudget } from "../platform/transfer-budget"
import {
	BlobChunkSchema,
	blobDigest,
	blobReference,
	maximumDocumentBlobBytes,
	maximumBlobChunkBytes,
	parseBlobReference,
	requiredBlobChunks,
	verifyBlobChunk,
} from "../shared/document-blobs"
import type { BlobManifest } from "../shared/document-blobs"
import {
	BlobBytesMissing,
	BlobCorrupt,
	DocumentConflict,
} from "../shared/document-errors"
import type { DocumentAction } from "../shared/document-actions"
import * as Schema from "effect/Schema"
import { BrowserAccount } from "./browser-account"
import { BrowserStorage } from "./storage"

export class DocumentBlobs extends Context.Service<
	DocumentBlobs,
	Effect.Success<ReturnType<typeof makeBlobs>>
>()("alkalye/DocumentBlobs") {
	static layer(document: string) {
		return Layer.effect(DocumentBlobs, makeBlobs(document)).pipe(
			Layer.provide(webCryptoLayer),
		)
	}
}

function makeBlobs(document: string) {
	return Effect.gen(function* () {
		let storage = yield* BrowserStorage
		let account = yield* BrowserAccount
		let crypto = yield* Crypto.Crypto
		return Object.freeze({
			restore(reference: string, blob: Blob) {
				return Effect.gen(function* () {
					let manifest = yield* parseBlobReference(reference)
					if (blob.size !== manifest.size)
						return yield* Effect.fail(
							new DocumentConflict({
								message: "Choose the original attachment; its size must match",
							}),
						)
					let offset = 0
					for (let chunk of manifest.chunks) {
						let bytes = new Uint8Array(
							yield* Effect.tryPromise(() =>
								blob.slice(offset, offset + chunk.size).arrayBuffer(),
							),
						)
						yield* storeChunk(chunk.digest, bytes)
						offset += chunk.size
					}
				})
			},
			store(blob: Blob) {
				return Effect.gen(function* () {
					if (blob.size > maximumDocumentBlobBytes)
						return yield* Effect.fail(
							new DocumentConflict({
								message: "This attachment exceeds the document storage limit",
							}),
						)
					let chunks: BlobManifest["chunks"][number][] = []
					for (
						let start = 0;
						start < blob.size;
						start += maximumBlobChunkBytes
					) {
						let bytes = new Uint8Array(
							yield* Effect.tryPromise(() =>
								blob.slice(start, start + maximumBlobChunkBytes).arrayBuffer(),
							),
						)
						let digest = yield* blobDigest(bytes).pipe(
							Effect.provideService(Crypto.Crypto, crypto),
						)
						yield* storeChunk(digest, bytes)
						chunks.push({ digest, size: bytes.length })
					}
					return yield* blobReference({
						version: 1,
						type:
							blob.type.length <= 256 ? blob.type : "application/octet-stream",
						size: blob.size,
						chunks,
					})
				})
			},
			read(reference: string) {
				return Effect.gen(function* () {
					let manifest = yield* parseBlobReference(reference)
					let parts = yield* Effect.forEach(
						manifest.chunks,
						chunk =>
							readChunk(chunk.digest, chunk.size).pipe(
								Effect.flatMap(value =>
									value.blob.size === chunk.size
										? Effect.succeed(value.blob)
										: Effect.fail(
												new DocumentConflict({
													message:
														"Attachment chunk size does not match its manifest",
												}),
											),
								),
							),
						{ concurrency: 4 },
					)
					return new Blob(parts, { type: manifest.type })
				})
			},
			upload(action: DocumentAction) {
				return Effect.gen(function* () {
					if (action.document !== document)
						return yield* Effect.fail(
							new DocumentConflict({
								message: "Attachment action belongs to another document",
							}),
						)
					let chunks = yield* requiredBlobChunks(action)
					if (!chunks.length) return
					let missing = yield* account.request(
						account.api.documents.missingBlobs({
							params: { document },
							payload: chunks,
						}),
					)
					let expected = new Map(
						chunks.map(chunk => [chunk.digest, chunk.size]),
					)
					for (let digest of missing)
						if (!expected.has(digest))
							return yield* Effect.fail(
								new DocumentConflict({
									message:
										"Server requested a chunk outside this attachment action",
								}),
							)
					yield* Effect.forEach(
						[...new Set(missing)],
						digest =>
							Effect.gen(function* () {
								let local = yield* localChunk(digest)
								if (!local || local.bytes.length !== expected.get(digest))
									return yield* Effect.fail(
										new BlobBytesMissing({
											document,
											digest,
											message:
												"Attachment bytes are unavailable on this device; the document remains queued",
										}),
									)
								yield* account.request(
									account.api.documents.putBlob({
										params: { document, digest },
										payload: local.bytes,
									}),
									transferBudget(local.bytes.length * 2),
								)
							}),
						{ concurrency: 2, discard: true },
					)
				})
			},
		})
		function key(digest: string) {
			return (
				"document-blob-v1:" +
				JSON.stringify([account.subject, document, digest])
			)
		}
		function verify(digest: string, value: unknown) {
			return Effect.gen(function* () {
				let blob =
					value instanceof Blob
						? value
						: new Blob([
								new Uint8Array(
									yield* Schema.decodeUnknownEffect(BlobChunkSchema)(value),
								),
							])
				if (!blob.size || blob.size > maximumBlobChunkBytes)
					return yield* Effect.fail(
						new BlobCorrupt({ digest, message: "Invalid cached blob chunk" }),
					)
				let bytes = new Uint8Array(
					yield* Effect.tryPromise(() => blob.arrayBuffer()),
				)
				yield* verifyBlobChunk(digest, bytes)
				return { blob, bytes }
			}).pipe(
				Effect.provideService(Crypto.Crypto, crypto),
				Effect.catchTag("SchemaError", () =>
					Effect.fail(
						new BlobCorrupt({ digest, message: "Invalid cached blob chunk" }),
					),
				),
			)
		}
		function localChunk(digest: string) {
			return storage
				.get(key(digest))
				.pipe(
					Effect.flatMap(stored =>
						stored === undefined
							? Effect.succeed(undefined)
							: verify(digest, stored),
					),
				)
		}
		function storeChunk(digest: string, bytes: Uint8Array) {
			return verify(digest, bytes).pipe(
				Effect.tap(value => storage.modify(key(digest), () => value.blob)),
			)
		}
		function readChunk(digest: string, size: number) {
			return Effect.gen(function* () {
				let local = yield* localChunk(digest).pipe(
					Effect.catchTag("BlobCorrupt", () => Effect.succeed(undefined)),
				)
				if (local) return local
				let downloaded = yield* account.request(
					account.api.documents.getBlob({ params: { document, digest } }),
					transferBudget(size * 4),
				)
				yield* storeChunk(digest, downloaded)
				let stored = yield* localChunk(digest)
				if (!stored)
					return yield* Effect.fail(
						new BlobBytesMissing({
							document,
							digest,
							message: "Attachment cache disappeared after saving",
						}),
					)
				return stored
			})
		}
	})
}
