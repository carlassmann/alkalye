import * as Context from "effect/Context"
import * as Crypto from "effect/Crypto"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Ref from "effect/Ref"
import * as Semaphore from "effect/Semaphore"
import { webCryptoLayer } from "../platform/web-crypto"
import { removeAsset } from "../shared/authoring"
import { DocumentConflict, PermissionDenied } from "../shared/document-errors"
import { setFields } from "../shared/documents"
import type { Atom, Operation } from "../shared/model"
import type { Replica } from "../shared/crdt"
import { blobContentType, parseBlobReference } from "../shared/document-blobs"
import { DocumentBlobs } from "./document-blobs"
import { DocumentSession } from "./document-session"

export interface AttachmentSelection {
	atoms: Atom[]
	start: number
	end: number
	inline?: boolean
}
interface AttachmentFile {
	blob: Blob
	name: string
}
interface AssetOptions {
	document: string
	canWrite(): boolean
}
type SessionCommand = ReturnType<
	Context.Service.Shape<typeof DocumentSession>["change"]
>

export class DocumentAssets extends Context.Service<
	DocumentAssets,
	Effect.Success<ReturnType<typeof makeAssets>>
>()("alkalye/DocumentAssets") {
	static layer(options: AssetOptions) {
		return Layer.effect(DocumentAssets, makeAssets(options)).pipe(
			Layer.provide(webCryptoLayer),
		)
	}
}
function makeAssets(options: AssetOptions) {
	return Effect.gen(function* () {
		let session = yield* DocumentSession
		let blobs = yield* DocumentBlobs
		let crypto = yield* Crypto.Crypto
		let document = options.document
		let writable = Effect.suspend(() =>
			options.canWrite()
				? Effect.void
				: Effect.fail(
						new PermissionDenied({ message: "This document is read-only" }),
					),
		)
		return Object.freeze({
			current: () =>
				session.replica
					.records("asset")
					.filter(asset => asset.fields.document === document)
					.map(asset => ({
						...asset,
						audible: audible(asset.fields.data ?? ""),
					})),
			restore(id: string, blob: Blob) {
				return Effect.gen(function* () {
					yield* writable
					let reference = yield* restorationReference(id)
					yield* blobs.restore(reference, blob)
					yield* writable
					if ((yield* restorationReference(id)) !== reference)
						return yield* Effect.fail(
							new DocumentConflict({
								message: "This attachment changed while restoring its file",
							}),
						)
				})
			},
			attach(blob: Blob, name: string, selection?: AttachmentSelection) {
				return attachFiles([{ blob, name }], selection)
			},
			attachFiles,
			rename(id: string, name: string) {
				return change("Rename attachment", staged => {
					requireAsset(staged, id)
					if (!name.trim())
						throw new DocumentConflict({
							message: "Give the attachment a name",
						})
					return [staged.set(id, "name", name.trim())]
				})
			},
			// Files saved beside a local document are linked by their relative path.
			link(
				files: readonly { source: string; name: string }[],
				selection?: AttachmentSelection,
			) {
				let captured = captureSelection(selection)
				return change(
					files.length === 1 ? "Attach file" : "Attach files",
					staged => [insertReferences(staged, files, captured)],
				)
			},
			insert(id: string, selection?: AttachmentSelection) {
				let captured = captureSelection(selection)
				return change("Insert attachment", staged => {
					let asset = requireAsset(staged, id)
					return [
						insertReferences(
							staged,
							[{ source: "asset:" + id, name: asset.name ?? "Asset" }],
							captured,
						),
					]
				})
			},
			mute(id: string, muted: boolean) {
				return change(
					muted ? "Mute attachment" : "Unmute attachment",
					staged => {
						let asset = requireAsset(staged, id)
						if (!audible(asset.data ?? ""))
							throw new DocumentConflict({
								message: "Only audio and video attachments can be muted",
							})
						return [staged.set(id, "muted", String(muted))]
					},
				)
			},
			delete(id: string) {
				return change("Delete attachment", staged => {
					requireAsset(staged, id)
					return [
						staged.set(id, "type", "deleted"),
						staged.edit(document, removeAsset(staged.text(document), id)),
					]
				})
			},
		})
		function attachFiles(
			files: readonly AttachmentFile[],
			selection?: AttachmentSelection,
		) {
			let capturedFiles = files.map(file => ({ ...file }))
			let identities = Ref.makeUnsafe<string[]>([])
			let prepared = Ref.makeUnsafe<SessionCommand | undefined>(undefined)
			let preparing = Semaphore.makeUnsafe(1)
			let captured = captureSelection(selection)
			return preparing.withPermit(
				Effect.gen(function* () {
					yield* writable
					if (!capturedFiles.length)
						return yield* Effect.fail(
							new DocumentConflict({ message: "Choose a file to attach" }),
						)
					let command = yield* Ref.get(prepared)
					if (!command) {
						let ids = yield* Ref.get(identities)
						while (ids.length < capturedFiles.length) {
							ids = [...ids, yield* crypto.randomUUIDv4]
							yield* Ref.set(identities, ids)
						}
						let attachments = yield* Effect.forEach(
							capturedFiles,
							(file, index) =>
								Effect.gen(function* () {
									let id = ids[index]
									if (!id)
										return yield* Effect.die("Missing attachment identity")
									return {
										id,
										name: file.name,
										data: yield* blobs.store(file.blob),
									}
								}),
						)
						command = session.change(
							capturedFiles.length === 1 ? "Attach file" : "Attach files",
							staged => {
								assertWritable()
								return [
									...attachments.flatMap(asset =>
										setFields(staged, asset.id, {
											type: "asset",
											document,
											name: asset.name,
											data: asset.data,
										}),
									),
									insertReferences(
										staged,
										attachments.map(({ id, name }) => ({
											source: "asset:" + id,
											name,
										})),
										captured,
									),
								]
							},
						)
						yield* Ref.set(prepared, command)
					}
					return yield* command
				}),
			)
		}
		function assertWritable() {
			if (!options.canWrite())
				throw new PermissionDenied({ message: "This document is read-only" })
		}
		function insertReferences(
			staged: Replica,
			assets: readonly { source: string; name: string }[],
			selection?: AttachmentSelection,
		) {
			let source = selection
				? selection.atoms.map(atom => atom.value).join("")
				: staged.text(document)
			let start = selection?.start ?? source.length
			let end = selection?.end ?? start
			if (
				!Number.isSafeInteger(start) ||
				!Number.isSafeInteger(end) ||
				start < 0 ||
				end < start ||
				end > source.length
			)
				throw new DocumentConflict({
					message: "The attachment selection is invalid",
				})
			let references = assets
				.map(({ source, name }) => {
					let label = name
						.replace(/[\\\[\]]/g, character => "\\" + character)
						.replace(/[\r\n]/g, " ")
					return `![${label}](${source})`
				})
				.join("\n")
			return staged.edit(
				document,
				source.slice(0, start) +
					(selection?.inline ? references : `\n${references}\n`) +
					source.slice(end),
				selection?.atoms,
			)
		}
		function change(
			label: string,
			build: (staged: Replica) => (Operation | null)[],
		) {
			let command = session.change(label, staged => {
				assertWritable()
				return build(staged)
			})
			return writable.pipe(Effect.andThen(command))
		}
		function restorationReference(id: string) {
			return Effect.gen(function* () {
				let fields = session.replica.fields(id)
				let pending = session
					.pending()
					.filter(action =>
						action.changes.some(
							change =>
								change.target === id &&
								change.kind === "set" &&
								change.field === "data" &&
								change.value.startsWith("chunks:"),
						),
					)
				let created = pending.some(action =>
					action.changes.some(
						change =>
							change.target === id &&
							change.kind === "set" &&
							change.field === "type" &&
							change.value === "asset",
					),
				)
				if (
					id === document ||
					fields.document !== document ||
					(fields.type !== "asset" && !(fields.type === "deleted" && created))
				)
					return yield* Effect.fail(
						new DocumentConflict({ message: "This attachment is unavailable" }),
					)
				let failure = session.failures.current().synchronization
				for (let action of pending) {
					for (let change of action.changes) {
						if (
							change.target !== id ||
							change.kind !== "set" ||
							change.field !== "data" ||
							!change.value.startsWith("chunks:")
						)
							continue
						let manifest = yield* parseBlobReference(change.value)
						if (
							fields.type === "deleted" ||
							(failure &&
								failure._tag !== "BlobQuotaExceeded" &&
								manifest.chunks.some(chunk => chunk.digest === failure.digest))
						)
							return change.value
					}
				}
				if (fields.type !== "asset" || !fields.data)
					return yield* Effect.fail(
						new DocumentConflict({ message: "This attachment is unavailable" }),
					)
				return fields.data
			})
		}
		function requireAsset(staged: Pick<Replica, "fields">, id: string) {
			let fields = staged.fields(id)
			if (
				id === document ||
				(fields.type !== "asset" && fields.type !== "whiteboard") ||
				fields.document !== document
			)
				throw new DocumentConflict({
					message: "This attachment is unavailable",
				})
			return fields
		}
	})
}
function audible(reference: string) {
	return /^(audio|video)\/[a-z0-9.+-]+$/.test(blobContentType(reference) ?? "")
}
function captureSelection(selection?: AttachmentSelection) {
	return (
		selection && {
			...selection,
			atoms: selection.atoms.map(atom => ({ ...atom })),
		}
	)
}
