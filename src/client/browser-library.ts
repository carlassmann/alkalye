import * as Context from "effect/Context"
import * as Crypto from "effect/Crypto"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as RcMap from "effect/RcMap"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import * as Semaphore from "effect/Semaphore"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import { webCryptoLayer } from "../platform/web-crypto"
import { AccountChanged } from "../shared/authentication"
import { Replica } from "../shared/crdt"
import {
	buildAction,
	PermissionDenied,
	ResourceUnavailable,
} from "../shared/document-actions"
import { newDocument } from "../shared/documents"
import { documentMetadata } from "../shared/document-metadata"
import { maximumActionText, DocumentConflict } from "../shared/document-actions"
import type { LocalDocumentCreation } from "../shared/document-actions"
import { LibrarySnapshotSchema } from "../shared/workspace"
import type { LibrarySnapshot } from "../shared/workspace"
import { DocumentLive } from "./document-live"
import { BrowserAccount } from "./browser-account"
import {
	browserDocumentSessionLayer,
	DocumentSession,
} from "./document-session"
import { DocumentDiscussion } from "./document-discussion"
import { DocumentBlobs } from "./document-blobs"
import { DocumentAssets } from "./document-assets"
import { DocumentMedia } from "./document-media"
import { makeDocumentTransport } from "./document-transport"
import { LocalDocuments } from "./local-documents"
import {
	isLocalWorkspace,
	LocalDirectories,
	LocalFileUnavailable,
} from "./local-directories"
import type { LocalDirectory } from "./local-directories"
import { syncLocalFile } from "./local-file-sync"
import type { LocalFileSync } from "./local-file-sync"
import { makeLocalMedia } from "./local-media"
import type { CatalogueDocument, LocalDocumentRow } from "./local-documents"
import { BrowserStorage } from "./storage"

export interface BrowserLibraryState {
	readonly library: BrowserCatalogue
	readonly refresh: "idle" | "refreshing" | "failed"
	readonly message?: string
	readonly cacheFailure?: string
}
export interface BrowserCatalogue {
	readonly workspaces: LibrarySnapshot["workspaces"]
	readonly documents: ReadonlyArray<CatalogueDocument>
}
export interface DocumentConnectionState {
	readonly status: "offline" | "syncing" | "synced" | "unavailable" | "failed"
	readonly message?: string
}
export class BrowserLibrary extends Context.Service<
	BrowserLibrary,
	Effect.Success<ReturnType<typeof makeLibrary>>
>()("alkalye/BrowserLibrary") {
	static layer = Layer.effect(BrowserLibrary, makeLibrary()).pipe(
		Layer.provide(webCryptoLayer),
	)
}
let cachedLibrary = Schema.Struct({
	subject: Schema.String,
	library: LibrarySnapshotSchema,
})

function makeLibrary() {
	return Effect.gen(function* () {
		let account = yield* BrowserAccount
		let live = yield* DocumentLive
		let wakeups = live.changes.pipe(
			Stream.filter(
				message => message.type === "advanced" || message.type === "connected",
			),
		)
		let storage = yield* BrowserStorage
		let randomness = yield* Crypto.Crypto
		let folders = yield* LocalDirectories
		let transport = yield* makeDocumentTransport(
			account.origin,
			account.subject,
		)
		let local = Context.get(
			yield* Layer.build(LocalDocuments.layer(account.subject)),
			LocalDocuments,
		)
		let key = "document-library:" + account.subject
		let stored = yield* storage.get(key)
		let decoded = Schema.decodeUnknownResult(cachedLibrary)(stored)
		let cached =
			decoded._tag === "Success" && decoded.success.subject === account.subject
				? decoded.success.library
				: { workspaces: [], documents: [] }
		let remote = yield* Ref.make<LibrarySnapshot>(cached)
		let assembling = yield* Semaphore.make(1)
		let state = yield* SubscriptionRef.make<BrowserLibraryState>(
			Object.freeze({
				library: mergeCatalogue(
					cached,
					yield* local.rows,
					folders.current(),
					account.subject,
				),
				refresh: "idle",
			}),
		)
		let fetching = yield* Semaphore.make(1)
		let refresh = refreshLibrary()
		let documents = yield* RcMap.make({
			lookup: openDocument,
			idleTimeToLive: 0,
		})
		yield* local.changes.pipe(
			Stream.merge(folders.changes),
			Stream.runForEach(() =>
				compose().pipe(
					Effect.catch(error =>
						publish({ refresh: "idle", cacheFailure: message(error) }),
					),
				),
			),
			Effect.forkScoped({ startImmediately: true }),
		)
		yield* local.changes.pipe(
			Stream.merge(Stream.fromEventListener(window, "online")),
			Stream.merge(Stream.fromEventListener(window, "focus")),
			Stream.merge(wakeups),
			Stream.buffer({ capacity: 1, strategy: "sliding" }),
			Stream.runForEach(() => drain()),
			Effect.forkScoped({ startImmediately: true }),
		)
		yield* Stream.make(undefined).pipe(
			Stream.merge(Stream.fromEventListener(window, "online")),
			Stream.merge(Stream.fromEventListener(window, "focus")),
			Stream.merge(wakeups),
			Stream.buffer({ capacity: 1, strategy: "sliding" }),
			Stream.runForEach(() => refresh),
			Effect.forkScoped({ startImmediately: true }),
		)
		return Object.freeze({
			live,
			folders,
			state: Object.freeze({
				current: () => SubscriptionRef.getUnsafe(state),
				changes: SubscriptionRef.changes(state),
			}),
			refresh,
			open: (document: string) => RcMap.get(documents, document),
			create: (
				source: string,
				workspace = "personal-" + account.subject,
				identity?: string,
			) => {
				if (isLocalWorkspace(workspace)) return createFile(source, workspace)
				let prepared = Ref.makeUnsafe<LocalDocumentCreation | undefined>(
					undefined,
				)
				return Effect.gen(function* () {
					let intent = yield* Ref.get(prepared)
					if (!intent) {
						let space = SubscriptionRef.getUnsafe(
							state,
						).library.workspaces.find(space => space.workspace === workspace)
						if (
							workspace !== "personal-" + account.subject &&
							(!space || space.role === "reader")
						)
							return yield* Effect.fail(
								new PermissionDenied({
									message: "This workspace is read-only",
								}),
							)
						let document = identity ?? (yield* randomness.randomUUIDv4)
						let actor = account.subject + "-" + (yield* randomness.randomUUIDv4)
						let action = yield* buildAction(
							new Replica(actor),
							document,
							"Create document",
							staged => newDocument(staged, document, "Untitled", source),
						)
						intent = {
							workspace,
							workspaceOwner: space?.owner ?? account.subject,
							subject: account.subject,
							action,
						}
						yield* Ref.set(prepared, intent)
					}
					yield* local.create(intent)
					yield* compose()
					return intent.action.document
				})
			},
		})
		function refreshLibrary() {
			return fetching.withPermit(
				Effect.gen(function* () {
					yield* publish({ refresh: "refreshing" })
					let library = yield* account.request(account.api.workspaces.library())
					yield* Ref.set(remote, library)
					yield* compose()
					yield* publish({ refresh: "idle" })
					yield* storage.set(key, { subject: account.subject, library }).pipe(
						Effect.andThen(local.acknowledge(library)),
						Effect.andThen(
							publish({
								refresh: "idle",
								cacheFailure: undefined,
								message: undefined,
							}),
						),
						Effect.catch(error =>
							publish({ refresh: "idle", cacheFailure: message(error) }),
						),
					)
					yield* compose()
				}).pipe(
					Effect.catch(error =>
						publish({ refresh: "failed", message: message(error) }),
					),
				),
			)
		}
		function publish(value: Omit<BrowserLibraryState, "library">) {
			return SubscriptionRef.update(state, current =>
				Object.freeze({ ...current, ...value }),
			)
		}
		function compose() {
			return assembling.withPermit(
				local.rows.pipe(
					Effect.flatMap(rows =>
						SubscriptionRef.update(state, current =>
							Object.freeze({
								...current,
								library: mergeCatalogue(
									Ref.getUnsafe(remote),
									rows,
									folders.current(),
									account.subject,
								),
							}),
						),
					),
				),
			)
		}
		function drain() {
			return Effect.gen(function* () {
				let rows = yield* local.rows
				let updated = false
				for (let row of rows.filter(row => row.dirty || row.creation)) {
					yield* Effect.scoped(
						Effect.gen(function* () {
							let opened = yield* RcMap.get(documents, row.summary.document)
							if (navigator.onLine) {
								yield* opened.session.sync
								updated = true
							}
							yield* opened.session.save
						}),
					).pipe(
						Effect.catch(error =>
							Effect.logWarning("Document remains on this device", error),
						),
					)
				}
				if (updated) yield* refreshLibrary()
			}).pipe(
				Effect.catch(error =>
					Effect.logWarning("Could not drain local documents", error),
				),
			)
		}
		function createFile(source: string, workspace: string) {
			return Effect.gen(function* () {
				let title = documentMetadata(source).title
				let name = title === "Untitled" ? "Untitled" : title
				let document = yield* folders.create(
					workspace,
					"",
					name + ".md",
					source,
				)
				yield* compose()
				return document
			})
		}
		function openDocument(document: string) {
			return folders.locate(document)
				? openLocalDocument(document)
				: openSharedDocument(document)
		}
		// A file in a chosen folder uses the same session as a synchronized
		// document. Its journal keeps drafts and undo on this device; the disk,
		// not the server, receives its source.
		function openLocalDocument(document: string) {
			return Effect.gen(function* () {
				let located = folders.locate(document)
				let disk = yield* folders.read(document).pipe(Effect.option)
				let initialCreation: LocalDocumentCreation | undefined
				if (located && disk._tag === "Some") {
					if (disk.value.content.length > maximumActionText)
						return yield* new LocalFileUnavailable({
							message:
								"Files larger than 200,000 characters cannot be edited yet",
							reconnect: false,
						})
					initialCreation = {
						workspace: located.directory.id,
						workspaceOwner: account.subject,
						subject: account.subject,
						action: yield* buildAction(
							new Replica(
								account.subject + "-" + (yield* randomness.randomUUIDv4),
							),
							document,
							"Open file",
							staged =>
								newDocument(staged, document, "Untitled", disk.value.content),
						),
					}
				}
				let blobs = Context.get(
					yield* Layer.build(DocumentBlobs.layer(document)),
					DocumentBlobs,
				)
				let session = Context.get(
					yield* Layer.build(
						browserDocumentSessionLayer({
							document,
							subject: account.subject,
							initialCreation,
							transport: {
								snapshot: () =>
									Effect.fail(
										new LocalFileUnavailable({
											message: "Allow access to this folder to open the file",
											reconnect: true,
										}),
									),
								commit: () =>
									Effect.fail(
										new DocumentConflict({
											message: "Files in a folder are saved to disk",
										}),
									),
								history: () => Effect.succeed([]),
							},
						}),
					),
					DocumentSession,
				)
				let file = yield* syncLocalFile({
					document,
					session,
					folders,
					storage,
				})
				let media = yield* makeLocalMedia({ document, session, folders })
				let connection = yield* SubscriptionRef.make<DocumentConnectionState>(
					connectionOf(file.current()),
				)
				yield* file.changes.pipe(
					Stream.runForEach(value =>
						SubscriptionRef.set(connection, connectionOf(value)),
					),
					Effect.forkScoped({ startImmediately: true }),
				)
				let canWrite = () =>
					Boolean(folders.locate(document)) &&
					file.current().status !== "reconnect"
				let discussion = Context.get(
					yield* Layer.build(
						DocumentDiscussion.layer({
							document,
							author: "Writer",
							canWrite: () => false,
						}).pipe(
							Layer.provide(Layer.succeed(DocumentSession, session)),
							Layer.provide(webCryptoLayer),
						),
					),
					DocumentDiscussion,
				)
				let capabilities = yield* Layer.build(
					Layer.merge(
						DocumentAssets.layer({ document, canWrite }),
						DocumentMedia.layer(document),
					).pipe(
						Layer.provide(
							Layer.merge(
								Layer.succeed(DocumentSession, session),
								Layer.succeed(DocumentBlobs, blobs),
							),
						),
					),
				)
				return Object.freeze({
					session,
					blobs,
					assets: Context.get(capabilities, DocumentAssets),
					media: Context.get(capabilities, DocumentMedia),
					canWrite,
					discussion,
					connection: Object.freeze({
						current: () => SubscriptionRef.getUnsafe(connection),
						changes: SubscriptionRef.changes(connection),
					}),
					file: localFile(file),
					localMedia: localMediaOf(media),
				})
			})
		}
		function openSharedDocument(document: string) {
			return Effect.gen(function* () {
				yield* live.watch(document)
				let blobs = Context.get(
					yield* Layer.build(DocumentBlobs.layer(document)),
					DocumentBlobs,
				)
				let initialCreation = yield* local.creation(document)
				let context = yield* Layer.build(
					browserDocumentSessionLayer({
						document,
						subject: account.subject,
						initialCreation,
						activity: local.activity(document, () =>
							SubscriptionRef.getUnsafe(state).library.documents.find(
								doc => doc.document === document,
							),
						),
						transport: {
							create: creation => account.request(transport.create(creation)),
							snapshot: document =>
								account.request(
									account.api.documents.snapshot({ params: { document } }),
								),
							commit: action =>
								blobs.upload(action).pipe(
									Effect.andThen(
										account.request(
											account.api.documents.commit({
												params: { document: action.document },
												payload: action,
											}),
										),
									),
								),
							history: (document, after, log, limit) =>
								account.request(
									account.api.documents.history({
										params: { document },
										query: { after, log, limit },
									}),
								),
						},
					}),
				)
				let session = Context.get(context, DocumentSession)
				let connection = yield* SubscriptionRef.make<DocumentConnectionState>(
					Object.freeze({ status: "offline" }),
				)
				yield* session.changes.pipe(
					Stream.debounce("500 millis"),
					Stream.merge(Stream.fromEventListener(window, "online")),
					Stream.merge(Stream.fromEventListener(window, "focus")),
					Stream.merge(wakeups),
					Stream.merge(
						SubscriptionRef.changes(state).pipe(
							Stream.map(
								state =>
									state.library.documents.find(
										entry => entry.document === document,
									)?.role,
							),
							Stream.changes,
						),
					),
					Stream.buffer({ capacity: 1, strategy: "sliding" }),
					Stream.runForEach(() => synchronize()),
					Effect.forkScoped({ startImmediately: true }),
				)
				let discussion = Context.get(
					yield* Layer.build(
						DocumentDiscussion.layer({
							document,
							author: "Writer",
							canWrite,
						}).pipe(
							Layer.provide(Layer.succeed(DocumentSession, session)),
							Layer.provide(webCryptoLayer),
						),
					),
					DocumentDiscussion,
				)
				let capabilities = yield* Layer.build(
					Layer.merge(
						DocumentAssets.layer({ document, canWrite }),
						DocumentMedia.layer(document),
					).pipe(
						Layer.provide(
							Layer.merge(
								Layer.succeed(DocumentSession, session),
								Layer.succeed(DocumentBlobs, blobs),
							),
						),
					),
				)
				return Object.freeze({
					session,
					blobs,
					assets: Context.get(capabilities, DocumentAssets),
					media: Context.get(capabilities, DocumentMedia),
					canWrite,
					discussion,
					connection: Object.freeze({
						current: () => SubscriptionRef.getUnsafe(connection),
						changes: SubscriptionRef.changes(connection),
					}),
					file: localFile(undefined),
					localMedia: localMediaOf(undefined),
				})
				function canWrite() {
					let entry = SubscriptionRef.getUnsafe(state).library.documents.find(
						value => value.document === document,
					)
					let accountStatus = account.state.current().status
					return Boolean(
						entry &&
						!entry.deleted &&
						entry.role !== "reader" &&
						accountStatus !== "signedOut" &&
						accountStatus !== "accountChanged" &&
						SubscriptionRef.getUnsafe(connection).status !== "unavailable",
					)
				}
				function synchronize() {
					if (
						SubscriptionRef.getUnsafe(connection).status === "unavailable" &&
						!SubscriptionRef.getUnsafe(state).library.documents.some(
							entry => entry.document === document,
						)
					)
						return Effect.void
					if (!navigator.onLine)
						return SubscriptionRef.set(
							connection,
							Object.freeze({ status: "offline" }),
						)
					return SubscriptionRef.set(
						connection,
						Object.freeze({ status: "syncing" }),
					).pipe(
						Effect.andThen(session.sync),
						Effect.andThen(session.save),
						Effect.andThen(
							Effect.suspend(() =>
								SubscriptionRef.set(
									connection,
									Object.freeze({
										status:
											session.unsaved() || session.pending().length
												? "syncing"
												: "synced",
									}),
								),
							),
						),
						Effect.catch(error =>
							SubscriptionRef.set(
								connection,
								Object.freeze({
									status:
										error instanceof PermissionDenied ||
										error instanceof ResourceUnavailable ||
										error instanceof AccountChanged
											? "unavailable"
											: "failed",
									message: message(error),
								}),
							),
						),
					)
				}
			})
		}
	})
}
function mergeCatalogue(
	remote: LibrarySnapshot,
	local: ReadonlyArray<LocalDocumentRow>,
	directories: ReadonlyArray<LocalDirectory>,
	subject: string,
): BrowserCatalogue {
	let workspaces = [...remote.workspaces]
	let copies = new Map(local.map(row => [row.summary.document, row]))
	let documents: CatalogueDocument[] = remote.documents.map(document => {
		let row = copies.get(document.document)
		if (
			!row ||
			(!row.dirty &&
				(row.remoteLog !== document.log ||
					row.remotePosition < document.position))
		)
			return document
		return {
			...document,
			metadata: row.summary.metadata,
			kind: row.summary.kind,
			excerpt: row.summary.excerpt,
			created: row.summary.created,
			updated: row.summary.updated,
		}
	})
	let known = new Set(documents.map(document => document.document))
	for (let row of local) {
		if (known.has(row.summary.document) || (!row.creation && !row.dirty))
			continue
		documents.push({ ...row.summary, role: row.creation ? "owner" : "reader" })
		if (
			row.creation &&
			!workspaces.some(
				workspace => workspace.workspace === row.summary.workspace,
			)
		)
			workspaces.push({
				workspace: row.summary.workspace,
				name: "Personal",
				owner: row.subject,
				role: "owner",
				position: 0,
			})
	}
	for (let directory of directories) {
		workspaces.push({
			workspace: directory.id,
			name: directory.name,
			owner: subject,
			role: "owner",
			position: 0,
		})
		for (let file of directory.files) {
			let parts = file.path.split("/")
			let name = parts.pop() ?? file.path
			documents.push({
				document: file.document,
				workspace: directory.id,
				owner: subject,
				role: "owner",
				deleted: false,
				metadata: {
					title: name.replace(/\.(md|markdown|txt)$/i, ""),
					path: parts.join("/"),
					tags: [],
					pinned: false,
					archived: false,
					commentsDisabled: true,
				},
				kind: "document",
				excerpt: file.path,
				updated: file.lastModified,
				created: file.lastModified,
			})
		}
	}
	return freezeCatalogue({ workspaces, documents })
}
function localFile(file: LocalFileSync | undefined) {
	return file
}
function localMediaOf(
	media: Effect.Success<ReturnType<typeof makeLocalMedia>> | undefined,
) {
	return media
}
function connectionOf(file: {
	status: string
	message?: string
}): DocumentConnectionState {
	return Object.freeze(
		file.status === "saved"
			? { status: "synced" }
			: file.status === "saving"
				? { status: "syncing" }
				: file.status === "reconnect"
					? { status: "unavailable", message: file.message }
					: { status: "failed", message: file.message },
	)
}
function freezeCatalogue(library: BrowserCatalogue): BrowserCatalogue {
	return Object.freeze({
		workspaces: Object.freeze(
			library.workspaces.map(workspace => Object.freeze({ ...workspace })),
		),
		documents: Object.freeze(
			library.documents.map(document =>
				Object.freeze({
					...document,
					metadata: Object.freeze({
						...document.metadata,
						tags: Object.freeze([...document.metadata.tags]),
					}),
				}),
			),
		),
	})
}
function message(error: unknown) {
	return error instanceof Error ? error.message : String(error)
}
