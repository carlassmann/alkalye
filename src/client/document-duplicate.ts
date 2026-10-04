import * as Effect from "effect/Effect"
import * as Crypto from "effect/Crypto"
import type * as Context from "effect/Context"
import * as Ref from "effect/Ref"
import { duplicateDocument, snapshotTargets } from "../shared/documents"
import { Replica } from "../shared/crdt"
import type { BrowserLibrary } from "./browser-library"
import type { DocumentBlobs } from "./document-blobs"

export function duplicateDocumentVersion(
	library: Context.Service.Shape<typeof BrowserLibrary>,
	blobs: Pick<Context.Service.Shape<typeof DocumentBlobs>, "read">,
	input: Pick<Replica, "checkpoint">,
	document: string,
	title: string,
	workspace?: string,
	documents: ReadonlyMap<string, string> = new Map(),
) {
	let source = new Replica("document-copy")
	source.restore(input.checkpoint())
	let copied = Ref.makeUnsafe<string | undefined>(undefined)
	let targetIds = Ref.makeUnsafe<Map<string, string> | undefined>(undefined)
	let create = library.create("", workspace, documents.get(document))
	return Effect.gen(function* () {
		let random = yield* Crypto.Crypto
		let targets = snapshotTargets(source, document)
		let media = yield* Effect.forEach([...targets], target => {
			let fields = source.fields(target)
			let reference = fields.data
			return fields.type === "asset" && reference?.startsWith("chunks:")
				? blobs.read(reference).pipe(Effect.map(blob => ({ reference, blob })))
				: Effect.succeed(undefined)
		})
		let id = yield* Ref.get(copied)
		if (!id) {
			id = yield* create
			yield* Ref.set(copied, id)
		}
		let opened = yield* library.open(id)
		let identities = yield* Ref.get(targetIds)
		if (!identities) {
			identities = new Map([...documents, [document, id]])
			for (let target of targets)
				if (target !== document)
					identities.set(target, yield* random.randomUUIDv4)
			yield* Ref.set(targetIds, identities)
		}
		for (let value of media)
			if (value) yield* opened.blobs.restore(value.reference, value.blob)
		let mapping = identities
		yield* opened.session.change("Copy document version", staged =>
			duplicateDocument(
				source,
				staged,
				document,
				id,
				title,
				mapping,
			).operations.filter(
				operation => !operation || !operation.field.startsWith("access:"),
			),
		)
		return id
	}).pipe(Effect.scoped)
}
