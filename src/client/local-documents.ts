import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import { StorageError } from "../platform/errors"
import { Replica } from "../shared/crdt"
import { LocalDocumentCreationSchema } from "../shared/document-actions"
import type { LocalDocumentCreation } from "../shared/document-actions"
import { documentMetadata } from "../shared/document-metadata"
import { frontmatter, documentExcerpt } from "../shared/markdown"
import { parseOperation } from "../shared/model"
import { LibraryDocumentSchema } from "../shared/workspace"
import { wikiTargets } from "../shared/portable-links"
import type { LibrarySnapshot } from "../shared/workspace"
import type {
	DocumentActivity,
	DocumentProjectionState,
} from "./document-session"
import { BrowserStorage } from "./storage"

export let CatalogueDocumentSchema = Schema.Struct({
	document: LibraryDocumentSchema.fields.document,
	workspace: LibraryDocumentSchema.fields.workspace,
	owner: LibraryDocumentSchema.fields.owner,
	role: LibraryDocumentSchema.fields.role,
	deleted: LibraryDocumentSchema.fields.deleted,
	metadata: LibraryDocumentSchema.fields.metadata,
	kind: LibraryDocumentSchema.fields.kind,
	excerpt: LibraryDocumentSchema.fields.excerpt,
	links: LibraryDocumentSchema.fields.links,
	updated: LibraryDocumentSchema.fields.updated,
	created: LibraryDocumentSchema.fields.created,
})
export type CatalogueDocument = typeof CatalogueDocumentSchema.Type
let summarySchema = Schema.Struct({
	subject: Schema.String,
	summary: CatalogueDocumentSchema,
	localPosition: Schema.Natural,
	remoteLog: Schema.String,
	remotePosition: Schema.Natural,
})
let dirtySchema = Schema.Struct({ document: Schema.String })
export interface LocalDocumentRow extends SummaryRow {
	readonly creation?: LocalDocumentCreation
	readonly dirty: boolean
}
type SummaryRow = typeof summarySchema.Type

export class LocalDocuments extends Context.Service<
	LocalDocuments,
	Effect.Success<ReturnType<typeof makeDocuments>>
>()("alkalye/LocalDocuments") {
	static layer(subject: string) {
		return Layer.effect(LocalDocuments, makeDocuments(subject))
	}
}

function makeDocuments(subject: string) {
	return Effect.gen(function* () {
		let storage = yield* BrowserStorage
		let revision = yield* SubscriptionRef.make(0)
		let channel = yield* Effect.acquireRelease(
			Effect.sync(
				() => new BroadcastChannel("alkalye-document-index:" + subject),
			),
			channel => Effect.sync(() => channel.close()),
		)
		let summaryPrefix = "document-summary:" + subject + ":"
		let creationPrefix = "document-creation:" + subject + ":"
		let dirtyPrefix = "document-dirty:" + subject + ":"
		let notify = SubscriptionRef.update(
			revision,
			revision => revision + 1,
		).pipe(Effect.andThen(Effect.sync(() => channel.postMessage(null))))
		let readRows = Effect.gen(function* () {
			let [summaries, creations, dirty] = yield* Effect.all(
				[
					storage
						.getPrefix(summaryPrefix)
						.pipe(
							Effect.flatMap(
								Schema.decodeUnknownEffect(Schema.Array(summarySchema)),
							),
						),
					storage
						.getPrefix(creationPrefix)
						.pipe(
							Effect.flatMap(
								Schema.decodeUnknownEffect(
									Schema.Array(LocalDocumentCreationSchema),
								),
							),
						),
					storage
						.getPrefix(dirtyPrefix)
						.pipe(
							Effect.flatMap(
								Schema.decodeUnknownEffect(Schema.Array(dirtySchema)),
							),
						),
				],
				{ concurrency: 3 },
			)
			if (
				summaries.some(row => row.subject !== subject) ||
				creations.some(row => row.subject !== subject)
			)
				return yield* Effect.fail(
					new StorageError({
						operation: "document index",
						cause: "Document index belongs to another account",
					}),
				)
			let repaired = [...summaries]
			for (let creation of creations) {
				if (
					repaired.some(
						row => row.summary.document === creation.action.document,
					)
				)
					continue
				let candidate = yield* Effect.try(() => initialSummary(creation))
				let saved = yield* storage
					.getOrCreate(summaryPrefix + creation.action.document, candidate)
					.pipe(Effect.flatMap(Schema.decodeUnknownEffect(summarySchema)))
				repaired.push(saved)
			}
			let pending = new Map(creations.map(row => [row.action.document, row]))
			let marked = new Set(dirty.map(row => row.document))
			return repaired.map(row => ({
				...row,
				creation: pending.get(row.summary.document),
				dirty: marked.has(row.summary.document),
			}))
		})
		return Object.freeze({
			rows: readRows,
			changes: SubscriptionRef.changes(revision).pipe(
				Stream.merge(Stream.fromEventListener(channel, "message")),
				Stream.map(() => undefined),
			),
			create: (creation: LocalDocumentCreation) =>
				Effect.gen(function* () {
					let decoded = yield* Schema.decodeUnknownEffect(
						LocalDocumentCreationSchema,
					)(creation)
					if (decoded.subject !== subject)
						return yield* Effect.fail(
							new Error("Creation belongs to another account"),
						)
					let candidate = yield* Effect.try(() => initialSummary(decoded))
					let document = decoded.action.document
					let saved = yield* storage
						.getOrCreate(creationPrefix + document, decoded)
						.pipe(
							Effect.flatMap(
								Schema.decodeUnknownEffect(LocalDocumentCreationSchema),
							),
						)
					if (
						!Schema.toEquivalence(LocalDocumentCreationSchema)(saved, decoded)
					)
						return yield* Effect.fail(
							new Error("Creation identity reused with different content"),
						)
					yield* storage.getOrCreate(summaryPrefix + document, candidate)
					yield* storage.set(dirtyPrefix + document, { document })
					yield* notify
				}),
			creation: (document: string) =>
				storage
					.get(creationPrefix + document)
					.pipe(
						Effect.flatMap(
							Schema.decodeUnknownEffect(
								Schema.UndefinedOr(LocalDocumentCreationSchema),
							),
						),
					),
			activity: (
				document: string,
				baseline: () => CatalogueDocument | undefined,
			): DocumentActivity => ({
				proposing: Effect.gen(function* () {
					let known = yield* storage.get(summaryPrefix + document)
					if (known === undefined) {
						let summary = baseline()
						if (!summary)
							return yield* Effect.fail(
								new Error("Document workspace is unknown"),
							)
						yield* storage.getOrCreate(summaryPrefix + document, {
							subject,
							summary,
							localPosition: 0,
							remoteLog: "",
							remotePosition: 0,
						})
					}
					yield* storage.set(dirtyPrefix + document, { document })
					yield* notify
				}),
				projected: (state: DocumentProjectionState) =>
					storage
						.modify(summaryPrefix + document, value => {
							if (value === undefined) return value
							let row = Schema.decodeUnknownSync(summarySchema)(value)
							if (row.subject !== subject || row.summary.document !== document)
								throw new Error("Document index identity mismatch")
							if (state.localPosition <= row.localPosition) return value
							let record = state.record
							return {
								...row,
								localPosition: state.localPosition,
								remoteLog: state.remoteLog,
								remotePosition: state.remotePosition,
								summary: record
									? {
											...row.summary,
											metadata: documentMetadata(record.content),
											kind: record.kind ?? "document",
											excerpt: documentExcerpt(record.content),
											links: wikiTargets(frontmatter(record.content).body),
											created: record.created ?? 0,
											updated: record.updated,
											deleted: false,
										}
									: { ...row.summary, deleted: true },
							}
						})
						.pipe(Effect.flatMap(changed => (changed ? notify : Effect.void))),
				settled: storage
					.get(dirtyPrefix + document)
					.pipe(
						Effect.flatMap(value =>
							value === undefined
								? Effect.void
								: storage
										.delete(dirtyPrefix + document)
										.pipe(Effect.andThen(notify)),
						),
					),
			}),
			acknowledge: (library: LibrarySnapshot) =>
				readRows.pipe(
					Effect.flatMap(rows =>
						Effect.forEach(
							rows.filter(
								row =>
									row.creation &&
									row.remoteLog &&
									library.documents.some(
										doc =>
											doc.document === row.summary.document &&
											doc.log === row.remoteLog,
									),
							),
							row => storage.delete(creationPrefix + row.summary.document),
							{ discard: true },
						),
					),
				),
		})
	})
}
function initialSummary(creation: LocalDocumentCreation): SummaryRow {
	if (
		creation.workspace !== "personal-" + creation.subject &&
		!creation.workspaceOwner
	)
		throw new Error("Workspace ownership is not cached on this device")
	let replica = new Replica("initial-summary")
	replica.apply(creation.action.changes.map(parseOperation))
	let record = replica
		.documents(creation.workspace)
		.find(doc => doc.id === creation.action.document)
	if (!record) throw new Error("Creation has no document root")
	return {
		subject: creation.subject,
		localPosition: 0,
		remoteLog: "",
		remotePosition: 0,
		summary: {
			document: record.id,
			workspace: creation.workspace,
			owner: creation.workspaceOwner ?? creation.subject,
			role:
				creation.workspaceOwner && creation.workspaceOwner !== creation.subject
					? "writer"
					: "owner",
			deleted: false,
			metadata: documentMetadata(record.content),
			kind: record.kind ?? "document",
			excerpt: documentExcerpt(record.content),
			links: wikiTargets(frontmatter(record.content).body),
			created: record.created ?? 0,
			updated: record.updated,
		},
	}
}
