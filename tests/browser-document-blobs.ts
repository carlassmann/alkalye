import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Deferred from "effect/Deferred"
import * as Fiber from "effect/Fiber"
import * as TestClock from "effect/testing/TestClock"
import { BrowserAccount } from "../src/client/browser-account"
import { DocumentBlobs } from "../src/client/document-blobs"
import { DocumentAssets } from "../src/client/document-assets"
import {
	browserDocumentSessionLayer,
	DocumentSession,
} from "../src/client/document-session"
import { BrowserStorage } from "../src/client/storage"
import { makeDocumentTransport } from "../src/client/document-transport"
import { buildAction, restoreSnapshot } from "../src/shared/document-actions"
import {
	maximumBlobChunkBytes,
	parseBlobReference,
} from "../src/shared/document-blobs"
import { newDocument } from "../src/shared/documents"
import { Replica } from "../src/shared/crdt"
import { verifyDocumentMedia } from "./browser-document-media"

type Check = (value: unknown, message: string) => void
export function verifyDocumentBlobs(
	account: Context.Service.Shape<typeof BrowserAccount>,
	check: Check,
) {
	return Effect.scoped(
		Effect.gen(function* () {
			let document = "native-byte-assets"
			let context = yield* Layer.build(
				DocumentBlobs.layer(document).pipe(
					Layer.provideMerge(BrowserStorage.layer),
					Layer.provide(Layer.succeed(BrowserAccount, account)),
				),
			)
			let blobs = Context.get(context, DocumentBlobs)
			let storage = Context.get(context, BrowserStorage)
			let remote = yield* makeDocumentTransport(
				location.origin,
				account.subject,
			)
			let creation = {
				subject: account.subject,
				workspace: "personal-" + account.subject,
				action: yield* buildAction(
					new Replica(account.subject + "-byte-birth"),
					document,
					"Create",
					staged => newDocument(staged, document, "Untitled", "Alpha Beta"),
				),
			}
			let session = Context.get(
				yield* Layer.build(
					browserDocumentSessionLayer({
						document,
						subject: account.subject,
						initialCreation: creation,
						transport: {
							...remote,
							commit: action =>
								blobs
									.upload(action)
									.pipe(Effect.andThen(remote.commit(action))),
						},
					}),
				),
				DocumentSession,
			)
			let writable = true
			let assets = Context.get(
				yield* Layer.build(
					DocumentAssets.layer({ document, canWrite: () => writable }).pipe(
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
			let bytes = Uint8Array.from(
				{ length: maximumBlobChunkBytes + 13 },
				(_, index) => index % 251,
			)
			let file = new Blob([bytes], { type: "image/png" })
			let attaching = assets.attach(file, "Diagram[final].png", {
				atoms: session.replica.visible(document),
				start: 6,
				end: 10,
			})
			yield* session.edit("Peer: Alpha Beta").saved
			let fetching = window.fetch
			let requests = 0
			window.fetch = Object.assign(
				() => {
					requests++
					return Promise.reject(new TypeError("Offline attachment test"))
				},
				{ preconnect: fetching.preconnect },
			)
			let accepted = yield* attaching.pipe(
				Effect.ensuring(
					Effect.sync(() => {
						window.fetch = fetching
					}),
				),
			)
			let asset = assets.current()[0]
			if (!asset) throw new Error("Missing native attachment")
			let reference = asset.fields.data ?? ""
			let manifest = yield* parseBlobReference(reference)
			check(
				requests === 0 &&
					manifest.chunks.length === 2 &&
					manifest.chunks[0]?.size === maximumBlobChunkBytes &&
					manifest.chunks[1]?.size === 13,
				"offline attachments chunk and persist bytes before appending without making HTTP requests",
			)
			check(
				accepted.changes.some(change => change.kind === "text") &&
					accepted.changes.some(change => change.field === "data") &&
					session.replica.text(document).startsWith("Peer: Alpha") &&
					!session.replica.text(document).includes("Beta"),
				"one attachment action commits its manifest and anchored source insertion while preserving intervening source edits",
			)
			check(
				(yield* attaching).id === accepted.id && assets.current().length === 1,
				"retrying an attachment Effect preserves its asset and exact action identity",
			)
			let prefix =
				"document-blob-v1:" +
				JSON.stringify([account.subject, document]).slice(0, -1)
			check(
				(yield* storage.getPrefix(prefix)).length === 2 &&
					(yield* storage.getPrefix(prefix)).every(
						value => value instanceof Blob,
					),
				"identical attachment retry does not duplicate durable byte chunks",
			)
			window.fetch = Object.assign(
				() => {
					requests++
					return Promise.reject(new TypeError("Offline attachment read"))
				},
				{ preconnect: fetching.preconnect },
			)
			let offline = yield* blobs.read(reference).pipe(
				Effect.ensuring(
					Effect.sync(() => {
						window.fetch = fetching
					}),
				),
			)
			let restored = new Uint8Array(
				yield* Effect.tryPromise(() => offline.arrayBuffer()),
			)
			check(
				offline.type === "image/png" &&
					restored.every((byte, index) => byte === bytes[index]) &&
					requests === 0,
				"cached multi-chunk attachment bytes restore exactly without network access",
			)
			let originalPut = IDBObjectStore.prototype.put
			IDBObjectStore.prototype.put = function (...args) {
				if (
					this.name === "settings" &&
					typeof args[1] === "string" &&
					args[1].startsWith("document-blob-v1:")
				)
					throw new DOMException("Attachment quota", "QuotaExceededError")
				return Reflect.apply(originalPut, this, args)
			}
			let count = session.pending().length
			let failed = yield* assets
				.attach(new Blob([new Uint8Array([77])]), "Failed.bin")
				.pipe(
					Effect.result,
					Effect.ensuring(
						Effect.sync(() => {
							IDBObjectStore.prototype.put = originalPut
						}),
					),
				)
			check(
				failed._tag === "Failure" &&
					failed.failure instanceof Error &&
					failed.failure.message === "Attachment quota" &&
					session.pending().length === count &&
					assets.current().length === 1,
				"a synchronous IndexedDB quota failure retains its cause and appends neither attachment nor source changes",
			)
			writable = false
			let denied = yield* assets.attach(file, "Reader.bin").pipe(Effect.result)
			check(
				denied._tag === "Failure" &&
					denied.failure._tag === "PermissionDenied" &&
					session.pending().length === count,
				"native attachment producers refuse reader changes before any byte or document append",
			)
			writable = true
			yield* session.sync
			yield* Effect.gen(function* () {
				let entered = yield* Deferred.make<void>()
				let waiting = yield* account
					.request(
						Deferred.succeed(entered, undefined).pipe(
							Effect.andThen(Effect.never),
						),
						"30 seconds",
					)
					.pipe(Effect.result, Effect.forkChild)
				yield* Deferred.await(entered)
				yield* TestClock.adjust("20 seconds")
				check(
					!waiting.pollUnsafe(),
					"native transfer requests can exceed the ordinary document deadline while remaining interruptible",
				)
				yield* TestClock.adjust("10 seconds")
				let timedOut = yield* Fiber.join(waiting)
				check(
					timedOut._tag === "Failure" &&
						timedOut.failure instanceof Error &&
						timedOut.failure.name === "TimeoutError",
					"the supplied native transfer deadline still bounds a stalled request",
				)
			}).pipe(Effect.provide(TestClock.layer()))
			check(
				session.pending().length === 0,
				"offline creation publishes before its attachment bytes and action synchronize",
			)
			let snapshot = yield* remote.snapshot(document)
			let cold = yield* restoreSnapshot(snapshot, "byte-reader")
			check(
				cold.fields(asset.id).data === reference &&
					cold.text(document).includes("asset:" + asset.id),
				"a current native snapshot restores the attachment and source without history or binary payloads",
			)
			let wrong = yield* assets
				.rename(document, "Wrong target")
				.pipe(Effect.result)
			check(
				wrong._tag === "Failure" && session.pending().length === 0,
				"attachment mutation rejects a non-asset target without appending",
			)
			let chunkKey = (digest: string) =>
				"document-blob-v1:" +
				JSON.stringify([account.subject, document, digest])
			for (let chunk of manifest.chunks)
				yield* storage.delete(chunkKey(chunk.digest))
			let downloaded = yield* blobs.read(reference)
			check(
				downloaded.size === bytes.length &&
					(yield* storage.getPrefix(prefix)).length === 2,
				"native binary download verifies and caches missing chunks for future offline opening",
			)
			let damaged = manifest.chunks[0]
			if (!damaged) throw new Error("Missing first chunk")
			yield* storage.set(chunkKey(damaged.digest), new Uint8Array([0]))
			let repaired = yield* blobs.read(reference)
			check(
				repaired.size === bytes.length &&
					(yield* storage.get(chunkKey(damaged.digest))) instanceof Blob,
				"corrupt local attachment copies are repaired from verified server bytes",
			)
			yield* storage.delete(chunkKey(damaged.digest))
			yield* blobs.read(reference)
			let queuedFile = new Blob([new Uint8Array([123, 124])])
			let queued = yield* assets.attach(queuedFile, "Queued.bin")
			let queuedAsset = assets
				.current()
				.find(value => value.fields.name === "Queued.bin")
			if (!queuedAsset) throw new Error("Missing queued attachment")
			let queuedManifest = yield* parseBlobReference(
				queuedAsset.fields.data ?? "",
			)
			for (let chunk of queuedManifest.chunks)
				yield* storage.delete(chunkKey(chunk.digest))
			let unavailable = yield* session.sync.pipe(Effect.result)
			check(
				unavailable._tag === "Failure" &&
					unavailable.failure instanceof Error &&
					unavailable.failure.name === "BlobBytesMissing" &&
					session.failures.current().synchronization?._tag ===
						"BlobBytesMissing" &&
					session.pending().some(action => action.id === queued.id),
				"missing local attachment bytes keep the exact action pending rather than publishing a dangling manifest",
			)
			let awaiting = session.pending().length
			let wrongSize = yield* assets
				.restore(queuedAsset.id, new Blob([new Uint8Array([123])]))
				.pipe(Effect.result)
			check(
				wrongSize._tag === "Failure" && session.pending().length === awaiting,
				"restoring an attachment refuses a different file size without changing the queued journal",
			)
			let wrongBytes = yield* assets
				.restore(queuedAsset.id, new Blob([new Uint8Array([123, 99])]))
				.pipe(Effect.result)
			check(
				wrongBytes._tag === "Failure" &&
					wrongBytes.failure._tag === "BlobCorrupt" &&
					(yield* storage.get(
						chunkKey(queuedManifest.chunks[0]?.digest ?? ""),
					)) === undefined,
				"restoring an attachment refuses different content and cannot replace missing chunks with wrong bytes",
			)
			writable = false
			let readerRepair = yield* assets
				.restore(queuedAsset.id, queuedFile)
				.pipe(Effect.result)
			writable = true
			check(
				readerRepair._tag === "Failure" &&
					readerRepair.failure._tag === "PermissionDenied" &&
					session.pending().length === awaiting,
				"attachment recovery checks the current writer role before saving bytes",
			)
			let otherTarget = yield* assets
				.restore(document, queuedFile)
				.pipe(Effect.result)
			check(
				otherTarget._tag === "Failure" && session.pending().length === awaiting,
				"attachment recovery refuses a document root as an asset target",
			)
			yield* assets.restore(queuedAsset.id, queuedFile)
			yield* session.sync
			check(
				!session.pending().length &&
					!session.failures.current().synchronization &&
					session.replica.fields(queuedAsset.id).data ===
						queuedAsset.fields.data,
				"restoring original attachment bytes allows the retained action to synchronize unchanged",
			)
			let deletedFile = new Blob([new Uint8Array([17, 18, 19])], {
				type: "image/png",
			})
			let deleting = yield* assets.attach(
				deletedFile,
				"Deleted before sync.png",
			)
			let deletedId =
				deleting.changes.find(change => change.field === "type")?.target ?? ""
			let deletedManifest = yield* parseBlobReference(
				session.replica.fields(deletedId).data ?? "",
			)
			for (let chunk of deletedManifest.chunks)
				yield* storage.delete(chunkKey(chunk.digest))
			yield* assets.delete(deletedId)
			let blockedDeletion = yield* session.sync.pipe(Effect.result)
			check(
				blockedDeletion._tag === "Failure" &&
					session.replica.fields(deletedId).type === "deleted" &&
					session.pending().some(action => action.id === deleting.id),
				"deleting an unsynchronized attachment retains its blocked manifest action rather than falsely settling it",
			)
			yield* assets.restore(deletedId, deletedFile)
			yield* session.sync
			check(
				session.pending().length === 0 &&
					session.replica.fields(deletedId).type === "deleted" &&
					!session.replica.text(document).includes("asset:" + deletedId),
				"original bytes can recover a deleted pending attachment so its attach and delete synchronize in order",
			)
			let sourceBefore = session.replica.text(document)
			let invalid = yield* session
				.change("Invalid stale source", staged => {
					let note = staged.set(
						document,
						"invalidCausalNote",
						"Must not append",
					)
					let text = staged.prepareEdit(document, staged.text(document) + "!")
					if (!text?.insert[0]) throw new Error("Missing stale insertion")
					text.insert[0].after = "0000000000000001:unaccepted:00000000"
					return [note, text]
				})
				.pipe(Effect.result)
			check(
				invalid._tag === "Failure" &&
					invalid.failure._tag === "CausalDependencyMissing" &&
					session.pending().length === 0 &&
					session.replica.text(document) === sourceBefore &&
					!session.replica.fields(document).invalidCausalNote,
				"local causal validation refuses stale source before it can enter the durable document queue",
			)
			yield* verifyDocumentMedia(
				document,
				session,
				blobs,
				assets,
				storage,
				account.subject,
				check,
			)
			yield* assets.rename(asset.id, "Renamed diagram")
			check(
				assets
					.current()
					.some(
						value =>
							value.id === asset.id && value.fields.name === "Renamed diagram",
					),
				"native attachment rename changes its document register without changing blob identity",
			)
			yield* assets.delete(asset.id)
			yield* session.sync
			check(
				!assets.current().some(value => value.id === asset.id) &&
					!session.replica.text(document).includes("asset:" + asset.id) &&
					(yield* account.request(
						account.api.documents.getBlob({
							params: { document, digest: damaged.digest },
						}),
					)).length === maximumBlobChunkBytes,
				"attachment deletion removes its manifest and source reference together while retaining historical bytes",
			)
			yield* session.edit("Before selected After").saved
			yield* session.sync
			let captured = {
				atoms: session.replica.visible(document).map(atom => ({ ...atom })),
				start: 7,
				end: 15,
				inline: true,
			}
			let peer = Context.get(
				yield* Layer.build(
					browserDocumentSessionLayer({
						document,
						subject: account.subject,
						transport: remote,
					}),
				),
				DocumentSession,
			)
			yield* peer.edit("Peer: Before selected After").saved
			yield* peer.sync
			yield* session.sync
			yield* assets.link(
				[{ source: "https://example.com/media.png", name: "Picture" }],
				captured,
			)
			check(
				session.replica.text(document) ===
					"Peer: Before ![Picture](https://example.com/media.png) After",
				"inline media insertion preserves concurrent peer text and replaces only the remembered Atom selection",
			)
			yield* session.change("Create whiteboard", staged => [
				staged.set("picker-board", "type", "whiteboard"),
				staged.set("picker-board", "document", document),
				staged.set("picker-board", "name", "Board"),
			])
			yield* session.edit("Before selected After").saved
			yield* assets.insert("picker-board", {
				atoms: session.replica.visible(document),
				start: 7,
				end: 15,
				inline: true,
			})
			check(
				session.replica.text(document) ===
					"Before ![Board](asset:picker-board) After",
				"the asset module reuses a same-document whiteboard inline without splitting surrounding paragraphs",
			)
			let unchanged = session.replica.text(document)
			let invalidRange = yield* assets
				.insert("picker-board", {
					atoms: session.replica.visible(document),
					start: -1,
					end: 0,
					inline: true,
				})
				.pipe(Effect.result)
			check(
				invalidRange._tag === "Failure" &&
					invalidRange.failure._tag === "DocumentConflict" &&
					session.replica.text(document) === unchanged,
				"a media picker with an invalid saved range cannot append an attachment action",
			)
			writable = false
			let revoked = yield* assets
				.insert("picker-board", captured)
				.pipe(Effect.result)
			check(
				revoked._tag === "Failure" &&
					revoked.failure._tag === "PermissionDenied" &&
					session.replica.text(document) === unchanged,
				"revoking write access after a media picker opens prevents its saved insertion",
			)
			writable = true
		}),
	)
}
