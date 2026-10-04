import * as Crypto from "effect/Crypto"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Option from "effect/Option"
import { encode } from "./base64"
import { BlobCorrupt, DocumentConflict } from "./document-errors"
import type { Operation } from "./model"

export let maximumBlobChunkBytes = 2_000_000
export let maximumDocumentBlobBytes = 4096 * maximumBlobChunkBytes
export let BlobDigestSchema = Schema.String.check(
	Schema.isPattern(/^[\w-]{42}[AEIMQUYcgkosw048]$/),
)
export let BlobChunkSchema = Schema.Uint8Array.check(
	Schema.isMinLength(1),
	Schema.isMaxLength(maximumBlobChunkBytes),
)
export let BlobChunkDescriptorSchema = Schema.Struct({
	digest: BlobDigestSchema,
	size: Schema.Int.check(
		Schema.isBetween({ minimum: 1, maximum: maximumBlobChunkBytes }),
	),
})
export type BlobChunkDescriptor = typeof BlobChunkDescriptorSchema.Type
export let BlobManifestSchema = Schema.Struct({
	version: Schema.Literal(1),
	type: Schema.String.check(Schema.isMaxLength(256)),
	size: Schema.Natural.check(
		Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
	),
	chunks: Schema.Array(BlobChunkDescriptorSchema).check(
		Schema.isMaxLength(4096),
	),
}).check(
	Schema.makeFilter(
		manifest =>
			manifest.chunks.reduce((size, chunk) => size + chunk.size, 0) ===
			manifest.size,
		{ message: "Blob chunks must cover the declared size" },
	),
)
export type BlobManifest = typeof BlobManifestSchema.Type
let manifestJson = Schema.fromJsonString(BlobManifestSchema)

export function blobDigest(bytes: Uint8Array) {
	return Crypto.Crypto.pipe(
		Effect.flatMap(crypto => crypto.digest("SHA-256", bytes)),
		Effect.map(encode),
	)
}
export function verifyBlobChunk(digest: string, value: unknown) {
	return Effect.gen(function* () {
		yield* Schema.decodeUnknownEffect(BlobDigestSchema)(digest)
		let bytes = yield* Schema.decodeUnknownEffect(BlobChunkSchema)(value)
		if ((yield* blobDigest(bytes)) !== digest)
			return yield* Effect.fail(
				new BlobCorrupt({
					digest,
					message: "Blob bytes do not match their digest",
				}),
			)
		return bytes
	}).pipe(
		Effect.catchTag("SchemaError", () =>
			Effect.fail(new BlobCorrupt({ digest, message: "Invalid blob chunk" })),
		),
	)
}
export function blobReference(manifest: BlobManifest) {
	return Schema.encodeEffect(manifestJson)(manifest).pipe(
		Effect.map(json => "chunks:" + json),
	)
}
export function parseBlobReference(reference: string) {
	if (!reference.startsWith("chunks:"))
		return Effect.fail(
			new DocumentConflict({ message: "Unknown blob reference" }),
		)
	return Schema.decodeUnknownEffect(manifestJson)(
		reference.slice("chunks:".length),
	).pipe(
		Effect.mapError(
			() => new DocumentConflict({ message: "Invalid blob manifest" }),
		),
	)
}
export function blobContentType(reference: string) {
	if (!reference.startsWith("chunks:")) return undefined
	let manifest = Option.getOrUndefined(
		Schema.decodeUnknownOption(manifestJson)(reference.slice("chunks:".length)),
	)
	if (!manifest || !/^[\x20-\x7e]+$/.test(manifest.type)) return undefined
	return manifest.type.split(";")[0]?.trim().toLowerCase()
}

type BlobAction = {
	readonly changes: ReadonlyArray<Pick<Operation, "kind" | "field" | "value">>
}
export function hasBlobReferences(action: BlobAction) {
	return action.changes.some(
		change =>
			change.kind === "set" &&
			change.field === "data" &&
			change.value.startsWith("chunks:"),
	)
}
export function requiredBlobChunks(action: BlobAction) {
	return Effect.gen(function* () {
		let chunks = new Map<string, number>()
		for (let change of action.changes) {
			if (
				change.kind !== "set" ||
				change.field !== "data" ||
				!change.value.startsWith("chunks:")
			)
				continue
			let manifest = yield* parseBlobReference(change.value)
			for (let chunk of manifest.chunks) {
				let size = chunks.get(chunk.digest)
				if (size !== undefined && size !== chunk.size)
					return yield* Effect.fail(
						new DocumentConflict({
							message: "One blob digest cannot have different sizes",
						}),
					)
				chunks.set(chunk.digest, chunk.size)
				if (chunks.size > 4096)
					return yield* Effect.fail(
						new DocumentConflict({
							message: "Split attachment changes into smaller actions",
						}),
					)
			}
		}
		return [...chunks].map(([digest, size]) => ({ digest, size }))
	})
}
