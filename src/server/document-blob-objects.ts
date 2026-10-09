import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import type { ApplicationError } from "../platform/errors"

export interface BlobObjects {
	put(
		document: string,
		digest: string,
		bytes: Uint8Array,
	): Effect.Effect<string, ApplicationError>
	get(
		document: string,
		digest: string,
		key: string,
	): Effect.Effect<Uint8Array | undefined, ApplicationError>
}
export class DocumentBlobObjects extends Context.Reference<
	BlobObjects | undefined
>("alkalye/DocumentBlobObjects", { defaultValue: () => undefined }) {}
