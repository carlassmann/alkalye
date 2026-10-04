import * as Schema from "effect/Schema"
import { drawingPreview } from "./drawing-svg"
import * as Context from "effect/Context"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as RcMap from "effect/RcMap"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import { parseBlobReference } from "../shared/document-blobs"
import { assetReferences } from "../shared/authoring"
import { documentFailure } from "./document-failures"
import type { DocumentFailure } from "./document-failures"
import { DocumentBlobs } from "./document-blobs"
import { DocumentSession } from "./document-session"

export interface ResolvedDocumentMedia {
	urls: Map<string, string>
	failures: Map<string, DocumentFailure>
}
export class DocumentMedia extends Context.Service<
	DocumentMedia,
	Effect.Success<ReturnType<typeof makeMedia>>
>()("alkalye/DocumentMedia") {
	static layer(document: string) {
		return Layer.effect(DocumentMedia, makeMedia(document))
	}
}
function makeMedia(document: string) {
	return Effect.gen(function* () {
		let session = yield* DocumentSession
		let blobs = yield* DocumentBlobs
		let resources = yield* RcMap.make({
			idleTimeToLive: 0,
			lookup: (reference: string) =>
				Effect.gen(function* () {
					if (reference.startsWith("drawing:")) {
						let fields = yield* Schema.decodeUnknownEffect(
							Schema.fromJsonString(
								Schema.Record(Schema.String, Schema.String),
							),
						)(reference.slice(8))
						return yield* Effect.acquireRelease(
							Effect.sync(() => URL.createObjectURL(drawingPreview(fields))),
							url => Effect.sync(() => URL.revokeObjectURL(url)),
						)
					}
					let manifest = yield* parseBlobReference(reference)
					let type = previewType(manifest.type)
					if (!type) return undefined
					let blob = yield* blobs
						.read(reference)
						.pipe(Effect.map(value => new Blob([value], { type })))
						.pipe(Effect.flatMap(previewBlob))
					if (blob.type !== (type === "image/svg+xml" ? "image/png" : type))
						return yield* Effect.fail(
							new Error("This attachment has no safe preview type"),
						)
					return yield* Effect.acquireRelease(
						Effect.sync(
							() =>
								URL.createObjectURL(blob) +
								"#type=" +
								encodeURIComponent(blob.type),
						),
						url =>
							Effect.sync(() => URL.revokeObjectURL(url.split("#")[0] ?? url)),
					)
				}),
		})
		return Object.freeze({
			references,
			acquire: (reference: string) => RcMap.get(resources, reference),
			changes: Stream.make(undefined).pipe(
				Stream.merge(session.changes),
				Stream.map(() =>
					JSON.stringify(references(session.replica.text(document))),
				),
				Stream.changes,
			),
			resolve(source: string) {
				return Effect.gen(function* () {
					let parent = yield* Scope.Scope
					let results = yield* Effect.forEach(
						references(source),
						([id, reference]) =>
							Effect.gen(function* () {
								let scope = yield* Scope.fork(parent, "sequential")
								let result = yield* RcMap.get(resources, reference).pipe(
									Effect.provideService(Scope.Scope, scope),
									Effect.onExit(exit =>
										Exit.isFailure(exit)
											? Scope.close(scope, exit)
											: Effect.void,
									),
									Effect.exit,
								)
								if (
									Exit.isFailure(result) &&
									!Cause.hasFails(result.cause) &&
									!Cause.hasDies(result.cause)
								)
									return yield* Effect.failCause(result.cause)
								return { id, result }
							}),
						{ concurrency: 4 },
					)
					let resolved: ResolvedDocumentMedia = {
						urls: new Map(),
						failures: new Map(),
					}
					for (let { id, result } of results) {
						if (Exit.isSuccess(result) && result.value)
							resolved.urls.set(id, result.value)
						else if (Exit.isFailure(result))
							resolved.failures.set(
								id,
								documentFailure("load attachment", Cause.squash(result.cause)),
							)
					}
					return resolved
				})
			},
		})
		function references(source: string): [string, string][] {
			let ids = assetReferences(source)
			let references: [string, string][] = []
			for (let id of ids) {
				let fields = session.replica.fields(id)
				if (
					fields.type === "asset" &&
					fields.document === document &&
					fields.data
				)
					references.push([id, fields.data])
				else if (fields.type === "whiteboard" && fields.document === document)
					references.push([id, "drawing:" + JSON.stringify(fields)])
			}
			return references
		}
	})
}

function previewType(declared: string) {
	if (!/^[\x20-\x7e]+$/.test(declared)) return undefined
	let type = declared.split(";")[0]?.trim().toLowerCase() ?? ""
	return /^(image|audio|video)\/[a-z0-9.+-]+$/.test(type) ? type : undefined
}

function previewBlob(blob: Blob) {
	if (blob.type.split(";")[0]?.trim() !== "image/svg+xml")
		return Effect.succeed(blob)
	return Effect.scoped(
		Effect.gen(function* () {
			let image = new Image()
			let url = yield* Effect.acquireRelease(
				Effect.sync(() => URL.createObjectURL(blob)),
				url =>
					Effect.sync(() => {
						image.src = ""
						URL.revokeObjectURL(url)
					}),
			)
			image.src = url
			yield* Effect.tryPromise(() => image.decode())
			let canvas = document.createElement("canvas")
			let scale = Math.min(
				1,
				2048 / Math.max(image.naturalWidth, image.naturalHeight),
			)
			canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
			canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
			let context = canvas.getContext("2d")
			if (!context)
				return yield* Effect.fail(new Error("Could not render this image"))
			context.drawImage(image, 0, 0, canvas.width, canvas.height)
			return yield* Effect.tryPromise(
				() =>
					new Promise<Blob>((resolve, reject) =>
						canvas.toBlob(
							value =>
								value
									? resolve(value)
									: reject(new Error("Could not render this image")),
							"image/png",
						),
					),
			)
		}),
	)
}
