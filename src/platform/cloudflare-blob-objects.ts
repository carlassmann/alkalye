import type { R2Bucket } from "@cloudflare/workers-types"
import * as Layer from "effect/Layer"
import { promise } from "./effects"
import { DocumentBlobObjects } from "../server/document-blob-objects"

export function cloudflareBlobObjectsLayer(bucket: R2Bucket) {
	return Layer.succeed(DocumentBlobObjects, {
		put(document, digest, bytes) {
			return promise("r2.put", async () => {
				let key = objectKey(document, digest, globalThis.crypto.randomUUID())
				await bucket.put(key, bytes)
				return key
			})
		},
		get(document, digest, key) {
			return promise("r2.get", async () => {
				if (!key.startsWith(objectKey(document, digest, "")))
					throw new Error("Invalid attachment object key")
				let object = await bucket.get(key)
				return object ? new Uint8Array(await object.arrayBuffer()) : undefined
			})
		},
	})
}
function objectKey(document: string, digest: string, version: string) {
	return `documents/${encodeURIComponent(document)}/chunks/${digest}/${version}`
}
