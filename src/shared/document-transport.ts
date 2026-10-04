import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as HttpApiClient from "effect/http-api/HttpApiClient"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import { DocumentApi } from "./document-api"
import { accountHeader } from "./authentication"
import { personalWorkspaceRequest } from "./workspace"
import { DocumentConflict } from "./document-actions"
import type { DocumentAction, LocalDocumentCreation } from "./document-actions"
import type { DocumentTransport } from "./document-session"

export class DocumentRemote extends Context.Service<
	DocumentRemote,
	DocumentTransport
>()("alkalye/DocumentRemote") {
	static layer(origin: string, subject: string) {
		return Layer.effect(DocumentRemote, makeDocumentTransport(origin, subject))
	}
}
export function makeDocumentTransport(origin: string, subject: string) {
	return Effect.gen(function* () {
		let api = yield* HttpApiClient.make(DocumentApi, {
			baseUrl: origin,
			transformClient: client =>
				HttpClient.mapRequest(
					client,
					HttpClientRequest.setHeader(accountHeader, subject),
				),
		})
		return {
			create: (creation: LocalDocumentCreation) =>
				Effect.gen(function* () {
					if (creation.subject !== subject)
						return yield* Effect.fail(
							new DocumentConflict({
								message: "Creation belongs to another account",
							}),
						)
					if (creation.workspace === "personal-" + subject)
						yield* api.workspaces.create({
							payload: {
								workspace: creation.workspace,
								name: "Personal",
								request: personalWorkspaceRequest,
							},
						})
					let document = creation.action.document
					let position = yield* api.documents.create({
						payload: { workspace: creation.workspace, action: creation.action },
					})
					let snapshot = yield* api.documents.snapshot({ params: { document } })
					let facts = yield* api.documents.history({
						params: { document },
						query: { after: position - 1, log: snapshot.log, limit: 1 },
					})
					let initial = facts[0]
					if (!initial || initial.position !== position)
						return yield* Effect.fail(
							new DocumentConflict({
								message: "Creation receipt is unavailable",
							}),
						)
					return { log: snapshot.log, initial }
				}).pipe(Effect.timeout("20 seconds")),
			snapshot: (document: string) =>
				api.documents
					.snapshot({ params: { document } })
					.pipe(Effect.timeout("20 seconds")),
			action: (document: string, id: string) =>
				api.documents
					.action({ params: { document, action: id } })
					.pipe(Effect.timeout("20 seconds")),
			chain: (document: string, id: string) =>
				api.documents
					.chain({ params: { document, action: id } })
					.pipe(Effect.timeout("20 seconds")),
			withdraw: (action: DocumentAction) =>
				api.documents
					.withdraw({ params: { document: action.document }, payload: action })
					.pipe(Effect.timeout("20 seconds")),
			commit: (action: DocumentAction) =>
				api.documents
					.commit({
						params: { document: action.document },
						payload: action,
					})
					.pipe(Effect.timeout("20 seconds")),
			history: (document: string, after: number, log: string, limit = 100) =>
				api.documents
					.history({
						params: { document },
						query: { after, log, limit },
					})
					.pipe(Effect.timeout("20 seconds")),
		}
	})
}
