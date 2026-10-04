import * as Console from "effect/Console"
import * as Crypto from "effect/Crypto"
import { webCryptoLayer } from "../platform/web-crypto"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import * as Semaphore from "effect/Semaphore"
import * as KeyValueStore from "effect/persistence/KeyValueStore"
import * as SqlClient from "effect/sql/SqlClient"
import * as HttpApiClient from "effect/http-api/HttpApiClient"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientError from "effect/http/HttpClientError"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import { Signatures } from "../platform/signatures"
import { ApplicationError } from "../platform/errors"
import { encode } from "../shared/base64"
import { Replica } from "../shared/crdt"
import { DocumentApi } from "../shared/document-api"
import {
	buildAction,
	LocalDocumentCreationSchema,
} from "../shared/document-actions"
import type { LocalDocumentCreation } from "../shared/document-actions"
import { DocumentSession } from "../shared/document-session"
import { makeDocumentTransport } from "../shared/document-transport"
import { newDocument } from "../shared/documents"
import { LibrarySnapshotSchema } from "../shared/workspace"
import { CliProfile } from "./profile"
import { cliDocumentSessionLayer } from "./document-platform"

let LocalDocumentsSchema = Schema.Record(
	Schema.String,
	Schema.Struct({ creation: Schema.optional(LocalDocumentCreationSchema) }),
)
export class CliDocuments extends Context.Service<
	CliDocuments,
	Effect.Success<ReturnType<typeof makeDocuments>>
>()("cli/Documents") {
	static layer(directory: string, origin: string) {
		return Layer.effect(
			CliDocuments,
			makeDocuments(directory, new URL(origin).origin),
		).pipe(
			Layer.provide(CliProfile.layer(directory)),
			Layer.provide(Layer.merge(Signatures.layer, webCryptoLayer)),
		)
	}
}
export function allowOffline<A, E, R>(work: Effect.Effect<A, E, R>) {
	return work.pipe(
		Effect.catchIf(isNetworkFailure, () => Effect.succeed(undefined)),
	)
}
function isNetworkFailure(error: unknown): boolean {
	if (!error || typeof error !== "object" || !("_tag" in error)) return false
	if (error._tag === "TimeoutError") return true
	if (error._tag !== "HttpClientError" || !("reason" in error)) return false
	let reason = error.reason
	return (
		!!reason &&
		typeof reason === "object" &&
		"_tag" in reason &&
		reason._tag === "TransportError"
	)
}
function makeDocuments(directory: string, origin: string) {
	return Effect.gen(function* () {
		let cryptography = yield* Crypto.Crypto
		let profile = yield* (yield* CliProfile).require
		let identity = yield* (yield* Signatures).account(
			Redacted.make(profile.secret),
		)
		let sql = yield* SqlClient.SqlClient
		let kv = yield* KeyValueStore.KeyValueStore
		let locals = KeyValueStore.toSchemaStore(kv, LocalDocumentsSchema)
		let libraries = KeyValueStore.toSchemaStore(kv, LibrarySnapshotSchema)
		let key = origin + "/" + identity.subject
		let localKey = key + "/documents"
		let readLocals = locals
			.get(localKey)
			.pipe(
				Effect.map(
					Option.getOrElse((): typeof LocalDocumentsSchema.Type => ({})),
				),
			)
		let baseClient = yield* HttpClient.HttpClient
		let authentication = yield* HttpApiClient.make(DocumentApi, {
			baseUrl: origin,
		})
		let semaphore = yield* Semaphore.make(1)
		let token: { token: string; expires: number } | undefined
		let client = HttpClient.mapRequestEffect(baseClient, request =>
			Effect.gen(function* () {
				let login = yield* semaphore
					.withPermit(
						Effect.gen(function* () {
							if (token && token.expires > Date.now() + 30_000) return token
							let challenge = yield* authentication.authentication.challenge({
								payload: { publicKey: identity.publicKey, purpose: "bearer" },
							})
							let signature = yield* identity.signAuthentication(challenge, {
								origin,
								purpose: "bearer",
							})
							token = yield* authentication.authentication.bearerLogin({
								payload: {
									id: challenge.id,
									publicKey: identity.publicKey,
									signature,
								},
							})
							return token
						}),
					)
					.pipe(Effect.timeout("10 seconds"))
				return HttpClientRequest.setHeader(
					request,
					"authorization",
					"Bearer " + login.token,
				)
			}).pipe(
				Effect.mapError(cause => {
					if (HttpClientError.isHttpClientError(cause)) return cause
					return new HttpClientError.HttpClientError({
						reason:
							cause._tag === "TimeoutError"
								? new HttpClientError.TransportError({ request, cause })
								: new HttpClientError.EncodeError({
										request,
										cause,
										description: cause.message,
									}),
					})
				}),
			),
		)
		let api = yield* HttpApiClient.make(DocumentApi, { baseUrl: origin }).pipe(
			Effect.provideService(HttpClient.HttpClient, client),
		)
		let transport = yield* makeDocumentTransport(origin, identity.subject).pipe(
			Effect.provideService(HttpClient.HttpClient, client),
		)
		function register(id: string, creation?: LocalDocumentCreation) {
			return sql.withTransaction(
				Effect.gen(function* () {
					let index = yield* readLocals
					yield* locals.set(localKey, {
						...index,
						[id]: { ...index[id], ...(creation ? { creation } : {}) },
					})
				}),
			)
		}
		function library() {
			return Effect.gen(function* () {
				let remote = yield* allowOffline(
					api.workspaces.library({}).pipe(Effect.timeout("10 seconds")),
				)
				if (remote) yield* libraries.set(key, remote)
				return (
					remote ??
					Option.getOrElse(yield* libraries.get(key), () => ({
						documents: [],
						workspaces: [],
					}))
				)
			})
		}
		function open(document: string) {
			return Effect.gen(function* () {
				let local = (yield* readLocals)[document]
				let context = yield* Layer.build(
					cliDocumentSessionLayer(directory, {
						document,
						subject: identity.subject,
						author: profile.name,
						initialCreation: local?.creation,
						transport,
						activity: {
							proposing: register(document),
							projected: () => Effect.void,
							settled: sql.withTransaction(
								Effect.gen(function* () {
									let index = yield* readLocals
									if (index[document])
										yield* locals.set(localKey, { ...index, [document]: {} })
								}),
							),
						},
					}),
				)
				let session = Context.get(context, DocumentSession)
				yield* register(document)
				return session
			})
		}
		function create(
			source: string,
			title: string,
			workspace = "personal-" + identity.subject,
		) {
			return Effect.gen(function* () {
				let id = yield* cryptography.randomUUIDv4
				let replica = new Replica(
					identity.subject + "-" + encode(yield* cryptography.randomBytes(12)),
					profile.name,
				)
				let action = yield* buildAction(replica, id, "Create document", draft =>
					newDocument(draft, id, title || "Untitled", source),
				)
				yield* register(id, { workspace, subject: identity.subject, action })
				let session = yield* open(id)
				return { id, session }
			})
		}
		function list(scope: string) {
			return Effect.gen(function* () {
				let remote = yield* library()
				let index = yield* readLocals
				let ids = new Set([
					...remote.documents.map(doc => doc.document),
					...Object.keys(index),
				])
				let records = []
				for (let id of ids) {
					let summary = remote.documents.find(doc => doc.document === id)
					let workspace =
						summary?.workspace ??
						index[id]?.creation?.workspace ??
						"personal-" + identity.subject
					if (
						scope !== "all" &&
						workspace !==
							(scope.startsWith("space:")
								? scope.slice(6)
								: "personal-" + identity.subject)
					)
						continue
					let record = yield* Effect.scoped(
						Effect.gen(function* () {
							let session = yield* open(id)
							yield* allowOffline(session.sync)
							return session.replica
								.documents(workspace)
								.find(doc => doc.id === id)
						}),
					).pipe(
						Effect.catch(error =>
							Console.error(`Skipped ${id}: ${String(error)}`).pipe(
								Effect.as(undefined),
							),
						),
					)
					if (record && !record.archived) records.push(record)
				}
				return records
			})
		}
		let synchronize = Effect.gen(function* () {
			let remote = yield* api.workspaces.library({})
			yield* libraries.set(key, remote)
			let index = yield* readLocals
			let ids = new Set([
				...remote.documents.map(doc => doc.document),
				...Object.entries(index)
					.filter(([, entry]) => entry.creation)
					.map(([id]) => id),
			])
			let failed = false
			for (let id of ids)
				yield* Effect.scoped(
					Effect.gen(function* () {
						yield* (yield* open(id)).sync
					}),
				).pipe(
					Effect.catch(error => {
						failed = true
						return Console.error(
							`Could not synchronize ${id}: ${String(error)}`,
						)
					}),
				)
			if (failed)
				return yield* cliFailure(
					"Synchronization incomplete; local edits remain saved",
				)
		})
		return { identity, profile, api, open, create, list, synchronize }
	})
}
export function cliFailure(message: string) {
	return new ApplicationError({
		operation: "cli.document",
		cause: new Error(message),
	})
}
