import { expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { webCryptoLayer } from "../src/platform/web-crypto"
import { encode } from "../src/shared/base64"
import type { BlobManifest } from "../src/shared/document-blobs"
import {
	BlobManifestSchema,
	blobDigest,
	blobReference,
	maximumBlobChunkBytes,
	parseBlobReference,
	verifyBlobChunk,
	requiredBlobChunks,
} from "../src/shared/document-blobs"

test("blob digests verify bytes and reject noncanonical identity, empty and oversized chunks", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			let bytes = new TextEncoder().encode("hello")
			let digest = yield* blobDigest(bytes)
			expect(digest).toBe("LPJNul-wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ")
			expect(yield* verifyBlobChunk(digest, bytes)).toEqual(bytes)
			for (let [id, content] of [
				[digest + "=", bytes],
				[digest, new Uint8Array()],
				[digest, new Uint8Array(maximumBlobChunkBytes + 1)],
				[digest, new Uint8Array([0])],
			]) {
				if (typeof id !== "string" || !(content instanceof Uint8Array))
					throw new Error("Invalid test input")
				let rejected = yield* verifyBlobChunk(id, content).pipe(Effect.result)
				expect(rejected._tag).toBe("Failure")
				if (rejected._tag === "Failure")
					expect(rejected.failure._tag).toBe("BlobCorrupt")
			}
		}).pipe(Effect.provide(webCryptoLayer)),
	)
})

test("one action bounds its total distinct chunks and rejects contradictory sizes across manifests", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			let chunks = Array.from({ length: 4097 }, (_, index) => {
				let bytes = new Uint8Array(32)
				bytes[0] = index % 256
				bytes[1] = Math.floor(index / 256)
				return { digest: encode(bytes), size: 1 }
			})
			let first = yield* blobReference({
				version: 1,
				type: "",
				size: 4096,
				chunks: chunks.slice(0, 4096),
			})
			let second = yield* blobReference({
				version: 1,
				type: "",
				size: 1,
				chunks: chunks.slice(4096),
			})
			expect(
				(yield* requiredBlobChunks({
					changes: [{ kind: "set", field: "data", value: first }],
				})).length,
			).toBe(4096)
			expect(
				(yield* requiredBlobChunks({
					changes: [
						{ kind: "set", field: "data", value: first },
						{ kind: "set", field: "data", value: second },
					],
				}).pipe(Effect.result))._tag,
			).toBe("Failure")
			let digest = chunks[0]?.digest
			if (!digest) throw new Error("Missing chunk")
			let contradictory = yield* blobReference({
				version: 1,
				type: "",
				size: 2,
				chunks: [{ digest, size: 2 }],
			})
			expect(
				(yield* requiredBlobChunks({
					changes: [
						{ kind: "set", field: "data", value: first },
						{ kind: "set", field: "data", value: contradictory },
					],
				}).pipe(Effect.result))._tag,
			).toBe("Failure")
		}),
	)
})
test("manifest decoding covers exactly the bytes and preserves order and repeated content", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			let digest = yield* blobDigest(new Uint8Array([1, 2]))
			let manifest: BlobManifest = {
				version: 1,
				type: "image/png",
				size: 4,
				chunks: [
					{ digest, size: 2 },
					{ digest, size: 2 },
				],
			}
			let reference = yield* blobReference(manifest)
			expect(yield* parseBlobReference(reference)).toEqual(manifest)
			let empty: BlobManifest = {
				version: 1,
				type: "application/octet-stream",
				size: 0,
				chunks: [],
			}
			expect(yield* parseBlobReference(yield* blobReference(empty))).toEqual(
				empty,
			)
			for (let change of [
				{ size: 5 },
				{ version: 2 },
				{ size: -1 },
				{ chunks: [{ digest, size: maximumBlobChunkBytes + 1 }] },
				{ chunks: [{ digest: "wrong", size: 4 }] },
			])
				expect(
					Schema.decodeUnknownResult(BlobManifestSchema)({
						...manifest,
						...change,
					})._tag,
				).toBe("Failure")
			for (let reference of ["blob:{}", "chunks:{", "chunks:null", "chunks:{}"])
				expect(
					(yield* parseBlobReference(reference).pipe(Effect.result))._tag,
				).toBe("Failure")
		}).pipe(Effect.provide(webCryptoLayer)),
	)
})
