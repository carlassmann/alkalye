import * as Context from "effect/Context"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Scope from "effect/Scope"
import { DocumentMedia } from "../src/client/document-media"
import { DocumentAssets } from "../src/client/document-assets"
import { DocumentBlobs } from "../src/client/document-blobs"
import { DocumentSession } from "../src/client/document-session"
import { BrowserStorage } from "../src/client/storage"
import { parseBlobReference, blobReference } from "../src/shared/document-blobs"
import { setFields } from "../src/shared/documents"

type Check = (value: unknown, message: string) => void
export function verifyDocumentMedia(
	document: string,
	session: Context.Service.Shape<typeof DocumentSession>,
	blobs: Context.Service.Shape<typeof DocumentBlobs>,
	assets: Context.Service.Shape<typeof DocumentAssets>,
	storage: Context.Service.Shape<typeof BrowserStorage>,
	subject: string,
	check: Check,
) {
	return Effect.gen(function* () {
		let parent = yield* Scope.Scope
		let owner = yield* Scope.fork(parent, "sequential")
		let services = yield* Layer.build(
			DocumentMedia.layer(document).pipe(
				Layer.provide(
					Layer.merge(
						Layer.succeed(DocumentSession, session),
						Layer.succeed(DocumentBlobs, blobs),
					),
				),
			),
		).pipe(Effect.provideService(Scope.Scope, owner))
		let media = Context.get(services, DocumentMedia)
		let first = yield* Scope.fork(owner, "sequential")
		let second = yield* Scope.fork(owner, "sequential")
		let source = session.replica.text(document)
		let results = yield* Effect.forEach(
			[first, second],
			scope =>
				media.resolve(source).pipe(Effect.provideService(Scope.Scope, scope)),
			{ concurrency: 2 },
		)
		let asset = assets
			.current()
			.find(value => value.fields.name === "Diagram[final].png")
		if (!asset) throw new Error("Missing preview attachment")
		let url = results[0]?.urls.get(asset.id)
		if (!url) throw new Error("Missing preview URL")
		check(
			url === results[1]?.urls.get(asset.id) &&
				url.endsWith("#type=image%2Fpng"),
			"concurrent native media renders share one content-addressed preview URL",
		)
		yield* Scope.close(first, Exit.void)
		let alive = yield* Effect.tryPromise(() =>
			fetch(url).then(response => response.blob()),
		)
		check(
			alive.size > 2_000_000,
			"releasing one media render cannot revoke a URL held by another render",
		)
		yield* assets.rename(asset.id, "Renamed preview")
		let renamed = yield* media
			.resolve(source)
			.pipe(Effect.provideService(Scope.Scope, second))
		check(
			renamed.urls.get(asset.id) === url,
			"attachment renaming preserves the acquired preview URL",
		)
		let unsupported = yield* assets.attach(
			new Blob(["<script>window.assetExecuted=true</script>"], {
				type: "text/html",
			}),
			"Page.html",
		)
		let unsafeId =
			unsupported.changes.find(change => change.field === "type")?.target ?? ""
		let excluded = yield* media
			.resolve(`![Unsafe](asset:${unsafeId}) ![Root](asset:${document})`)
			.pipe(Effect.provideService(Scope.Scope, second))
		check(
			excluded.urls.size === 0 && excluded.failures.size === 0,
			"native media never exposes executable HTML or a non-asset record as a preview URL",
		)
		let repairFile = new Blob([new Uint8Array([91, 92, 93])], {
			type: "image/png",
		})
		let repair = yield* assets.attach(repairFile, "Repair.png")
		let repairId =
			repair.changes.find(change => change.field === "type")?.target ?? ""
		let repairManifest = yield* parseBlobReference(
			session.replica.fields(repairId).data ?? "",
		)
		for (let chunk of repairManifest.chunks)
			yield* storage.delete(
				"document-blob-v1:" + JSON.stringify([subject, document, chunk.digest]),
			)
		let failed = yield* media
			.resolve(`![Repair](asset:${repairId}) ![Healthy](asset:${asset.id})`)
			.pipe(Effect.provideService(Scope.Scope, second))
		check(
			failed.failures.has(repairId) && failed.urls.get(asset.id) === url,
			"a missing native attachment reports its own failure while healthy preview resources remain usable",
		)
		yield* assets.restore(repairId, repairFile)
		let recovered = yield* media
			.resolve(`![Repair](asset:${repairId})`)
			.pipe(Effect.provideService(Scope.Scope, second))
		check(
			recovered.urls.has(repairId) && recovered.failures.size === 0,
			"restoring native attachment bytes retries a failed resource immediately without reopening the document",
		)
		let svg = new Blob(
			[
				'<svg xmlns="http://www.w3.org/2000/svg" width="16" height="8"><script>window.assetExecuted=true</script><rect width="16" height="8" fill="#ef4412"/></svg>',
			],
			{ type: "image/svg+xml" },
		)
		let vector = yield* assets.attach(svg, "Vector.svg")
		let vectorId =
			vector.changes.find(change => change.field === "type")?.target ?? ""
		let vectorResult = yield* media
			.resolve(`![Vector](asset:${vectorId})`)
			.pipe(Effect.provideService(Scope.Scope, second))
		let vectorUrl = vectorResult.urls.get(vectorId)
		if (!vectorUrl)
			throw new Error(
				"Missing rasterized SVG URL: " +
					[...vectorResult.failures.values()]
						.map(value => value.message)
						.join(","),
			)
		let vectorBlob = yield* Effect.tryPromise(() =>
			fetch(vectorUrl).then(response => response.blob()),
		)
		check(
			vectorBlob.type === "image/png" &&
				vectorUrl.endsWith("#type=image%2Fpng"),
			"SVG previews expose rasterized PNG bytes while preserving the original document attachment",
		)
		let decoded = yield* Effect.tryPromise(() => createImageBitmap(vectorBlob))
		check(
			decoded.width === 16 &&
				decoded.height === 8 &&
				Reflect.get(window, "assetExecuted") !== true,
			"native SVG rasterization preserves the visible image dimensions",
		)
		decoded.close()
		check(
			session.replica.fields(vectorId).data?.includes('"type":"image/svg+xml"'),
			"safe SVG preview does not rewrite the attachment manifest or its original MIME type",
		)
		let manifest = yield* parseBlobReference(
			session.replica.fields(vectorId).data ?? "",
		)
		let craftedIds: string[] = []
		for (let [index, type] of [
			"image/svg+xml\t",
			"image/png;\u0080",
		].entries()) {
			let id = "crafted-mime-" + index
			let data = yield* blobReference({ ...manifest, type })
			yield* session.change("Crafted MIME fixture", staged =>
				setFields(staged, id, {
					type: "asset",
					document,
					name: "Untrusted",
					data,
				}),
			)
			craftedIds.push(id)
		}
		let crafted = yield* media
			.resolve(craftedIds.map(id => `![Untrusted](asset:${id})`).join("\n"))
			.pipe(Effect.provideService(Scope.Scope, second))
		check(
			crafted.urls.size === 0,
			"control and non-ASCII MIME characters cannot produce an untyped executable preview URL",
		)
		let codec = yield* blobReference({
			...manifest,
			type: 'VIDEO/WEBM; codecs="vp9"',
		})
		yield* session.change("Codec MIME fixture", staged =>
			setFields(staged, "codec-mime", {
				type: "asset",
				document,
				name: "Codec",
				data: codec,
			}),
		)
		let normalized = yield* media
			.resolve("![Codec](asset:codec-mime)")
			.pipe(Effect.provideService(Scope.Scope, second))
		let normalizedUrl = normalized.urls.get("codec-mime")
		if (!normalizedUrl) throw new Error("Missing normalized media type")
		check(
			normalizedUrl.endsWith("#type=video%2Fwebm") &&
				(yield* Effect.tryPromise(() =>
					fetch(normalizedUrl).then(response => response.blob()),
				)).type === "video/webm",
			"preview MIME normalization retains codec-bearing media while exposing a known inert content type",
		)
		let beforeMute = session.pending().length
		let imageMute = yield* assets.mute(asset.id, true).pipe(Effect.result)
		check(
			imageMute._tag === "Failure" && session.pending().length === beforeMute,
			"native image mute fails without appending an unrelated register action",
		)
		let muting = assets.mute("codec-mime", true)
		let muted = yield* muting
		check(
			(yield* muting).id === muted.id &&
				session.replica.fields("codec-mime").muted === "true",
			"native video mute retries its exact whole-document action identity",
		)
		let reader = Context.get(
			yield* Layer.build(
				DocumentAssets.layer({ document, canWrite: () => false }).pipe(
					Layer.provide(
						Layer.merge(
							Layer.succeed(DocumentSession, session),
							Layer.succeed(DocumentBlobs, blobs),
						),
					),
				),
			),
			DocumentAssets,
		)
		let beforeReader = JSON.stringify(session.replica.checkpoint())
		let forbidden = yield* Effect.forEach(
			[
				reader.insert(asset.id),
				reader.delete(asset.id),
				reader.mute("codec-mime", false),
			],
			command => command.pipe(Effect.result),
		)
		check(
			forbidden.every(
				result =>
					result._tag === "Failure" &&
					result.failure._tag === "PermissionDenied",
			) && JSON.stringify(session.replica.checkpoint()) === beforeReader,
			"native reader attachment commands fail at the producer without altering document state",
		)
		let observedSource = session.replica.text(document)
		let inserting = assets.insert(asset.id, {
			atoms: session.replica.visible(document),
			start: observedSource.length,
			end: observedSource.length,
		})
		yield* session.edit("Peer: " + observedSource).saved
		let inserted = yield* inserting
		check(
			session.replica.text(document).startsWith("Peer: ") &&
				session.replica
					.text(document)
					.includes("![Renamed preview](asset:" + asset.id + ")"),
			"native insertion uses captured atoms and preserves source written after selection",
		)
		check(
			(yield* inserting).id === inserted.id,
			"native insertion retries one exact journal action without duplicating its source reference",
		)
		let batchFiles = [
			{
				blob: new Blob(["First batch file"], { type: "text/plain" }),
				name: "First.txt",
			},
			{
				blob: new Blob(["Second batch file"], { type: "text/plain" }),
				name: "Second.txt",
			},
		]
		let beforeBatch = session.replica.text(document)
		let batch = assets.attachFiles(batchFiles, {
			atoms: session.replica.visible(document),
			start: beforeBatch.length,
			end: beforeBatch.length,
		})
		let attachedBatch = yield* batch
		let batchSource = session.replica.text(document)
		check(
			attachedBatch.changes.filter(change => change.field === "data").length ===
				2 &&
				batchSource.indexOf("![First.txt]") <
					batchSource.indexOf("![Second.txt]"),
			"native multi-file attachment commits both manifests and chosen source order in one action",
		)
		check(
			(yield* batch).id === attachedBatch.id,
			"native attachment batch retries the same action and asset identities",
		)
		let faulting = new Error("Injected second-file storage failure")
		let failingAssets = Context.get(
			yield* Layer.build(
				DocumentAssets.layer({ document, canWrite: () => true }).pipe(
					Layer.provide(
						Layer.merge(
							Layer.succeed(DocumentSession, session),
							Layer.succeed(DocumentBlobs, {
								...blobs,
								store: blob =>
									blob === batchFiles[1]?.blob
										? Effect.die(faulting)
										: blobs.store(blob),
							}),
						),
					),
				),
			),
			DocumentAssets,
		)
		let beforeFailedBatch = JSON.stringify(session.replica.checkpoint())
		let failedBatch = yield* failingAssets
			.attachFiles(batchFiles)
			.pipe(Effect.exit)
		check(
			Exit.isFailure(failedBatch) &&
				Cause.squash(failedBatch.cause) === faulting &&
				JSON.stringify(session.replica.checkpoint()) === beforeFailedBatch,
			"failure storing a batch's later file cannot append partial manifests or source references",
		)
		let fault = new Error("Injected attachment decoder defect")
		let defective = Context.get(
			yield* Layer.build(
				DocumentMedia.layer(document).pipe(
					Layer.provide(
						Layer.merge(
							Layer.succeed(DocumentSession, session),
							Layer.succeed(DocumentBlobs, {
								...blobs,
								read: reference =>
									reference === session.replica.fields(vectorId).data
										? Effect.die(fault)
										: blobs.read(reference),
							}),
						),
					),
				),
			).pipe(Effect.provideService(Scope.Scope, owner)),
			DocumentMedia,
		)
		let defects = yield* defective
			.resolve(`![Broken](asset:${vectorId}) ![Healthy](asset:${asset.id})`)
			.pipe(Effect.provideService(Scope.Scope, second))
		check(
			defects.urls.has(asset.id) &&
				defects.failures.get(vectorId)?.message === fault.message,
			"a defective media lookup releases its lease and reports only that asset without hiding healthy previews",
		)
		yield* Scope.close(owner, Exit.void)
		let revoked = yield* Effect.tryPromise(() => fetch(url)).pipe(Effect.result)
		check(
			revoked._tag === "Failure",
			"closing a document's media scope revokes its acquired object URLs",
		)
	})
}
