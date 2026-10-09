import type { R2Bucket } from "@cloudflare/workers-types"
import * as Crypto from "effect/Crypto"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { promise } from "./effects"
import { ApplicationError } from "./errors"
import { DocumentBlobObjects } from "../server/document-blob-objects"

export function cloudflareBlobObjectsLayer(bucket: R2Bucket) {
	return Layer.effect(
		DocumentBlobObjects,
		Effect.gen(function* () {
			let crypto = yield* Crypto.Crypto
			return {
				put(document: string, digest: string, bytes: Uint8Array) {
					return Effect.gen(function* () {
						let key = objectKey(document, digest)
						let receipt = yield* crypto.randomUUIDv4.pipe(
							Effect.mapError(
								cause =>
									new ApplicationError({ operation: "r2.receipt", cause }),
							),
						)
						yield* promise("r2.put", () => bucket.put(key, bytes))
						return { key, receipt }
					})
				},
				get(document: string, digest: string, key: string) {
					return promise("r2.get", async () => {
						let expected = objectKey(document, digest)
						if (key !== expected && !key.startsWith(expected + "/"))
							throw new Error("Invalid attachment object key")
						let object = await bucket.get(key)
						return object
							? new Uint8Array(await object.arrayBuffer())
							: undefined
					})
				},
			}
		}),
	)
}
function objectKey(document: string, digest: string) {
	return `documents/${encodeURIComponent(document)}/chunks/${digest}`
}
