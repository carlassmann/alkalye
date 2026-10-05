import * as Schema from "effect/Schema"
import * as Context from "effect/Context"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Queue from "effect/Queue"
import * as Base64 from "effect/encoding/Base64"
import * as RcMap from "effect/RcMap"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import { parseBlobReference } from "../shared/document-blobs"
import { assetReferences } from "../shared/authoring"
import {
	darkPreviewField,
	freshPreview,
	previewField,
} from "../shared/whiteboard"
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
						let drawing = yield* Schema.decodeUnknownEffect(
							Schema.fromJsonString(DrawingReference),
						)(reference.slice(8))
						let svg = yield* boardSvg(
							drawing.preview,
							drawing.fields,
							drawing.dark,
						)
						let blob = yield* previewBlob(
							new Blob([svg], { type: "image/svg+xml" }),
							2,
						)
						return yield* Effect.acquireRelease(
							Effect.sync(() => URL.createObjectURL(blob)),
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
				Stream.merge(appearanceChanges),
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
					references.push([id, drawingReference(fields, darkAppearance())])
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

function previewBlob(blob: Blob, density = 1) {
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
				density,
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

let DrawingReference = Schema.Struct({
	dark: Schema.Boolean,
	preview: Schema.optionalKey(Schema.String),
	fields: Schema.Record(Schema.String, Schema.String),
})

function darkAppearance() {
	return document.documentElement.dataset.appearance === "dark"
}

let appearanceChanges = Stream.callback<void>(queue =>
	Effect.acquireRelease(
		Effect.sync(() => {
			let observer = new MutationObserver(() => {
				Queue.offerUnsafe(queue, undefined)
			})
			observer.observe(document.documentElement, {
				attributes: true,
				attributeFilter: ["data-appearance"],
			})
			return observer
		}),
		observer => Effect.sync(() => observer.disconnect()),
	),
)

// A cached preview of the current records is enough to identify what is
// shown; any other board is keyed by its records and drawn by tldraw, loaded
// only then.
export function drawingReference(
	fields: Record<string, string>,
	dark: boolean,
) {
	let preview = freshPreview(fields, dark ? darkPreviewField : previewField)
	return (
		"drawing:" +
		JSON.stringify(
			preview === undefined ? { dark, fields } : { dark, preview, fields: {} },
		)
	)
}

export function drawingSvg(fields: Record<string, string>, dark = false) {
	return boardSvg(
		freshPreview(fields, dark ? darkPreviewField : previewField),
		fields,
		dark,
	)
}

function boardSvg(
	preview: string | undefined,
	fields: Record<string, string>,
	dark: boolean,
) {
	return (
		preview === undefined
			? Effect.tryPromise(() =>
					import("./whiteboard-preview").then(module =>
						module.renderBoardPreview(fields, dark),
					),
				)
			: Effect.succeed(preview)
	).pipe(Effect.flatMap(withFonts))
}

// Previews are cached without fonts; the standalone image gets the Geist
// faces the board was drawn with, under the names tldraw gives them.
let fontFiles = Effect.runSync(
	Effect.cached(
		Effect.forEach(
			[
				{ mono: false, url: "/fonts/geist-latin.woff2", range: basicLatin() },
				{
					mono: false,
					url: "/fonts/geist-latin-ext.woff2",
					range: extendedLatin(),
				},
				{
					mono: true,
					url: "/fonts/geist-mono-latin.woff2",
					range: basicLatin(),
				},
				{
					mono: true,
					url: "/fonts/geist-mono-latin-ext.woff2",
					range: extendedLatin(),
				},
			],
			({ mono, url, range }) =>
				Effect.tryPromise(async () => {
					let response = await fetch(url)
					if (!response.ok) throw new Error("The drawing font could not load")
					let bytes = new Uint8Array(await response.arrayBuffer())
					return {
						families: mono
							? ["tldraw_mono"]
							: ["tldraw_draw", "tldraw_sans", "tldraw_serif"],
						data: "data:font/woff2;base64," + Base64.encode(bytes),
						range,
					}
				}),
			{ concurrency: "unbounded" },
		),
	),
)

function basicLatin() {
	return "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD"
}
function extendedLatin() {
	return "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF"
}

function withFonts(svg: string) {
	if (!/tldraw_(draw|sans|serif|mono)/.test(svg)) return Effect.succeed(svg)
	return fontFiles.pipe(
		Effect.map(fonts => {
			let faces = fonts.flatMap(font =>
				font.families.map(
					family =>
						`@font-face{font-family:"${family}";font-weight:100 900;src:url("${font.data}") format("woff2");unicode-range:${font.range}}`,
				),
			)
			return svg.replace(
				/<svg\b[^>]*>/,
				tag => tag + "<style>" + faces.join("") + "</style>",
			)
		}),
	)
}
