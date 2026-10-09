import * as Effect from "effect/Effect"
import * as RcMap from "effect/RcMap"
import * as Schema from "effect/Schema"
import * as Semaphore from "effect/Semaphore"
import * as SqlClient from "effect/sql/SqlClient"
import * as SqlError from "effect/sql/SqlError"
import * as SqlSchema from "effect/sql/SqlSchema"
import {
	PermissionDenied,
	ResourceUnavailable,
	DocumentConflict,
} from "../shared/document-actions"
import { Identity } from "../shared/workspace"
import { BlobQuotaExceeded } from "../shared/document-errors"
import { WorkspaceDirectory } from "./workspace-directory"
import type { WorkspaceRoute } from "./workspace-directory"
import { workspaceRpc } from "./workspace-rpc"
import type { WorkspaceRequest, WorkspaceClient } from "./workspace-rpc"

let failures = Schema.Union([
	PermissionDenied,
	ResourceUnavailable,
	DocumentConflict,
])
let ledgerRow = Schema.Struct({
	subject: Schema.String,
	request: Schema.String,
	document: Schema.String,
	source: Schema.String,
	destination: Schema.String,
	phase: Schema.Literals([
		"staged",
		"admitting",
		"importing",
		"imported",
		"published",
		"done",
		"aborted",
	]),
	position: Schema.NullOr(Schema.Natural),
})
export function makeWorkspaceMoves(
	request: WorkspaceRequest,
	resolveRoute: (
		route: WorkspaceRoute,
	) => Effect.Effect<WorkspaceRoute, SqlError.SqlError>,
	beforeImport?: (
		document: string,
		source: string,
		destination: string,
	) => Effect.Effect<
		Effect.Effect<void, SqlError.SqlError>,
		BlobQuotaExceeded | SqlError.SqlError,
		Identity
	>,
) {
	return Effect.gen(function* () {
		let directory = yield* WorkspaceDirectory
		let sql = yield* SqlClient.SqlClient
		let gates = yield* RcMap.make({
			lookup: (_document: string) => Semaphore.make(1),
		})
		yield* sql`CREATE TABLE IF NOT EXISTS gateway_document_moves (subject TEXT NOT NULL,request TEXT NOT NULL,document TEXT NOT NULL,source TEXT NOT NULL,destination TEXT NOT NULL,phase TEXT NOT NULL,position INTEGER,PRIMARY KEY(subject,request))`
		yield* sql`CREATE TABLE IF NOT EXISTS gateway_document_move_aliases(subject TEXT NOT NULL,request TEXT NOT NULL,document TEXT NOT NULL,destination TEXT NOT NULL,canonical_request TEXT NOT NULL,PRIMARY KEY(subject,request))`
		let read = SqlSchema.findOneOption({
			Request: Schema.Struct({
				subject: Schema.String,
				request: Schema.String,
			}),
			Result: ledgerRow,
			execute: key =>
				sql`SELECT * FROM gateway_document_moves WHERE subject=${key.subject} AND request=${key.request}`,
		})
		function moveDocument(
			document: string,
			destination: string,
			command: string,
		) {
			let requestedCommand = command
			return Effect.scoped(
				Effect.gen(function* () {
					let identity = yield* Identity
					if (identity.access)
						return yield* Effect.fail(
							new PermissionDenied({
								message: "Document moves require an unrestricted identity",
							}),
						)
					let gate = yield* RcMap.get(gates, document)
					return yield* gate.withPermits(1)(
						Effect.gen(function* () {
							let command = requestedCommand
							let aliases = yield* sql<{
								document: string
								destination: string
								canonical_request: string
							}>`SELECT document,destination,canonical_request FROM gateway_document_move_aliases WHERE subject=${identity.subject} AND request=${command}`
							let alias = aliases[0]
							if (alias) {
								if (
									alias.document !== document ||
									alias.destination !== destination
								)
									return yield* unavailable("Move request identity conflicts")
								command = alias.canonical_request
							}
							let key = { subject: identity.subject, request: command }
							let prior = yield* read(key)
							let entry = prior._tag === "Some" ? prior.value : undefined
							if (
								entry &&
								(entry.document !== document ||
									entry.destination !== destination)
							)
								return yield* unavailable("Move request identity conflicts")
							if (entry?.phase === "done" && entry.position !== null)
								return entry.position
							if (entry?.phase === "aborted")
								return yield* Effect.fail(
									new PermissionDenied({
										message: "Move request was rejected",
									}),
								)
							let inFlight = yield* sql<{
								request: string
								subject: string
								destination: string
							}>`SELECT request,subject,destination FROM gateway_document_moves WHERE document=${document} AND phase NOT IN ('done','aborted') LIMIT 1`
							let pending = inFlight[0]
							if (
								!entry &&
								pending &&
								pending.subject === identity.subject &&
								pending.destination === destination
							) {
								yield* sql`INSERT INTO gateway_document_move_aliases VALUES(${identity.subject},${requestedCommand},${document},${destination},${pending.request})`
								command = pending.request
								let resumed = yield* read({
									subject: identity.subject,
									request: command,
								})
								if (resumed._tag !== "Some")
									return yield* unavailable("Prior move receipt disappeared")
								entry = resumed.value
							}
							if (
								inFlight[0] &&
								(inFlight[0].request !== command ||
									inFlight[0].subject !== identity.subject)
							)
								return yield* unavailable(
									"A prior document move must finish first",
								)
							let target = yield* directory.workspace(destination)
							if (!target)
								return yield* Effect.fail(
									new ResourceUnavailable({
										message: "Destination workspace unavailable",
									}),
								)
							yield* resolveRoute(target)
							function remote<A>(
								workspace: string,
								send: (client: WorkspaceClient) => Effect.Effect<A, unknown>,
							) {
								return workspaceRpc(
									request,
									workspace,
									identity,
									send,
									failures,
								)
							}
							if (!entry) {
								let source = yield* directory.document(document)
								if (!source)
									return yield* Effect.fail(
										new ResourceUnavailable({
											message: "Document unavailable",
										}),
									)
								if (source.workspace === destination)
									return yield* Effect.fail(
										new DocumentConflict({
											message: "Document is already in that workspace",
										}),
									)
								yield* resolveRoute(source)
								yield* remote(destination, c =>
									c.internal.authorizeDocumentDestination({
										payload: { destination },
									}),
								)
								yield* sql`INSERT INTO gateway_document_moves VALUES(${identity.subject},${command},${document},${source.workspace},${destination},'staged',NULL)`
								entry = {
									subject: identity.subject,
									request: command,
									document,
									source: source.workspace,
									destination,
									phase: "staged",
									position: null,
								}
							}
							let originalSource = entry.source
							if (
								entry.phase === "staged" ||
								entry.phase === "admitting" ||
								entry.phase === "importing"
							) {
								let admissionNotStarted = entry.phase === "staged"
								let importMayHaveCommitted = entry.phase === "importing"
								let bundle = yield* remote(originalSource, c =>
									c.internal.stageDocumentMove({
										payload: { document, destination, request: command },
									}),
								).pipe(
									Effect.catch(
										(
											error,
										): Effect.Effect<
											never,
											typeof failures.Type | SqlError.SqlError
										> => {
											if (
												!(error instanceof PermissionDenied) &&
												!(error instanceof ResourceUnavailable)
											)
												return Effect.fail(error)
											if (!admissionNotStarted)
												return unavailable(
													"Prior move admission outcome remains unknown",
												)
											return sql`UPDATE gateway_document_moves SET phase='aborted' WHERE subject=${identity.subject} AND request=${command}`.pipe(
												Effect.andThen(Effect.fail(error)),
											)
										},
									),
								)
								if (admissionNotStarted)
									yield* sql`UPDATE gateway_document_moves SET phase='admitting' WHERE subject=${identity.subject} AND request=${command}`
								let rollback = yield* (
									beforeImport
										? beforeImport(document, originalSource, destination)
										: Effect.succeed(Effect.void)
								).pipe(
									Effect.catch(
										(
											error,
										): Effect.Effect<
											never,
											typeof failures.Type | SqlError.SqlError
										> => {
											if (!(error instanceof BlobQuotaExceeded))
												return Effect.fail(error)
											if (importMayHaveCommitted)
												return unavailable(
													"Prior import outcome remains unknown",
												)
											return remote(originalSource, c =>
												c.internal.abortDocumentMove({
													payload: { document, request: command },
												}),
											).pipe(
												Effect.andThen(
													sql`UPDATE gateway_document_moves SET phase='aborted' WHERE subject=${identity.subject} AND request=${command}`,
												),
												Effect.andThen(
													Effect.fail(
														new DocumentConflict({
															message: "Destination attachment quota exceeded",
														}),
													),
												),
											)
										},
									),
								)
								yield* sql`UPDATE gateway_document_moves SET phase='importing' WHERE subject=${identity.subject} AND request=${command}`
								yield* remote(destination, c =>
									c.internal.importDocumentMove({ payload: bundle }),
								).pipe(
									Effect.catch(
										(
											error,
										): Effect.Effect<
											never,
											typeof failures.Type | SqlError.SqlError
										> => {
											if (
												!(error instanceof PermissionDenied) &&
												!(error instanceof ResourceUnavailable)
											)
												return Effect.fail(error)
											return rollback.pipe(
												Effect.andThen(
													remote(originalSource, c =>
														c.internal.abortDocumentMove({
															payload: { document, request: command },
														}),
													),
												),
												Effect.andThen(
													sql`UPDATE gateway_document_moves SET phase='aborted' WHERE subject=${identity.subject} AND request=${command}`,
												),
												Effect.andThen(Effect.fail(error)),
											)
										},
									),
								)
								yield* sql`UPDATE gateway_document_moves SET phase='imported' WHERE subject=${identity.subject} AND request=${command}`
								entry = { ...entry, phase: "imported" }
							}
							if (entry.phase === "imported") {
								let bundle = yield* remote(originalSource, c =>
									c.internal.stageDocumentMove({
										payload: { document, destination, request: command },
									}),
								)
								yield* directory.relocateDocument(
									document,
									originalSource,
									destination,
									command,
									bundle.invitations.map(row => row.invitation),
								)
								yield* directory.rememberMember(destination, identity.subject)
								yield* sql`UPDATE gateway_document_moves SET phase='published' WHERE subject=${identity.subject} AND request=${command}`
								entry = { ...entry, phase: "published" }
							}
							if (entry.phase === "published") {
								yield* remote(destination, c =>
									c.internal.activateDocumentMove({
										payload: { document, request: command },
									}),
								)
								let position = yield* remote(destination, c =>
									c.internal.recordImportedMove({
										payload: {
											document,
											from: originalSource,
											destination,
											request: command,
										},
									}),
								)
								yield* remote(originalSource, c =>
									c.internal.retireDocumentMove({
										payload: { document, request: command },
									}),
								)
								yield* sql`UPDATE gateway_document_moves SET phase='done',position=${position} WHERE subject=${identity.subject} AND request=${command}`
								entry = { ...entry, position }
							}
							if (entry.position === null)
								return yield* unavailable("Move receipt is incomplete")
							return entry.position
						}),
					)
				}),
			)
		}
		return moveDocument
	})
}
function unavailable(message: string) {
	return Effect.fail(
		new SqlError.SqlError({
			reason: new SqlError.ConnectionError({
				operation: "workspace-move",
				message,
				cause: new Error(message),
			}),
		}),
	)
}
