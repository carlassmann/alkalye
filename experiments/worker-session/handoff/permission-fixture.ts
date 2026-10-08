import type * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import * as HttpApiClient from "effect/http-api/HttpApiClient"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import type { BrowserAccount } from "../../../src/client/browser-account"
import { Signatures } from "../../../src/platform/signatures"
import { webCryptoLayer } from "../../../src/platform/web-crypto"
import { DocumentApi } from "../../../src/shared/document-api"
import {
	buildAction,
	restoreSnapshot,
} from "../../../src/shared/document-actions"
import {
	invitationDigest,
	invitationSecret,
} from "../../../src/shared/invitations"
import { encode } from "../../../src/shared/base64"
import { Replica } from "../../../src/shared/crdt"
import { newDocument } from "../../../src/shared/documents"
import { createWorkerSessionClient } from "./worker-client"
import { makeEditorQueue } from "./editor-queue"
import { WorkerDocumentFailure } from "./worker-rpc"

export function verifyWorkerRevocation(
	member: Context.Service.Shape<typeof BrowserAccount>,
	check: (value: unknown, message: string) => void,
) {
	return Effect.scoped(
		Effect.gen(function* () {
			let identity = yield* Signatures.use(signatures =>
				signatures.account(
					Redacted.make(encode(crypto.getRandomValues(new Uint8Array(32)))),
				),
			).pipe(Effect.provide(Signatures.layer))
			let anonymous = yield* HttpApiClient.make(DocumentApi, {
				baseUrl: location.origin,
			})
			let challenge = yield* anonymous.authentication.challenge({
				payload: { publicKey: identity.publicKey, purpose: "bearer" },
			})
			let signature = yield* identity.signAuthentication(challenge, {
				origin: location.origin,
				purpose: "bearer",
			})
			let login = yield* anonymous.authentication.bearerLogin({
				payload: { id: challenge.id, publicKey: identity.publicKey, signature },
			})
			let owner = yield* HttpApiClient.make(DocumentApi, {
				baseUrl: location.origin,
				transformClient: client =>
					HttpClient.mapRequest(
						client,
						HttpClientRequest.bearerToken(Redacted.make(login.token)),
					),
			})
			check(
				login.subject !== member.subject,
				"revocation fixture uses distinct signed owner and worker accounts",
			)
			let workspace = "worker-revocation-" + crypto.randomUUID()
			let document = "worker-shared-" + crypto.randomUUID()
			let source = "# Shared worker\n"
			yield* owner.workspaces.create({
				payload: {
					workspace,
					name: "Shared worker fixture",
					request: "create",
				},
			})
			let action = yield* buildAction(
				new Replica(login.subject + "-shared-owner"),
				document,
				"Create",
				staged => newDocument(staged, document, "Untitled", source),
			)
			yield* owner.documents.create({ payload: { workspace, action } })
			let beforeInvite = yield* member.api.documents
				.snapshot({ params: { document }, query: { encoding: "compact" } })
				.pipe(Effect.result)
			check(
				beforeInvite._tag === "Failure",
				"worker account cannot read owner's document before invitation",
			)
			let invitation = crypto.randomUUID()
			let secret = yield* invitationSecret.pipe(Effect.provide(webCryptoLayer))
			let digest = yield* invitationDigest(secret).pipe(
				Effect.provide(webCryptoLayer),
			)
			yield* owner.invitations.create({
				payload: { invitation, target: { workspace }, role: "writer", digest },
			})
			yield* member.api.invitations.accept({
				params: { invitation },
				payload: { secret, request: crypto.randomUUID() },
			})
			let worker = yield* createWorkerSessionClient(
				new URL("/worker.js", location.origin).href,
			)
			yield* Effect.addFinalizer(() =>
				worker.Close().pipe(Effect.catch(() => Effect.void)),
			)
			let initial = yield* worker.Open({
				document,
				subject: member.subject,
				origin: location.origin,
			})
			check(
				initial.source === source,
				"invited worker writer opens separate owner's shared document",
			)
			let allowed = yield* worker.Replace({
				handle: initial.handle,
				ranges: [{ start: source.length, remove: 0, text: "ALLOWED\n" }],
			})
			yield* worker.Sync()
			check(
				allowed.source === source + "ALLOWED\n",
				"invited writer saves and accepts initial shared edit",
			)
			let basis = yield* worker.Begin()
			let editor = yield* makeEditorQueue(worker, basis)
			yield* owner.workspaces.membership({
				params: { workspace, member: member.subject },
				payload: { role: "reader", request: crypto.randomUUID() },
			})
			yield* owner.invitations.revoke({ params: { invitation } })
			let draft = editor.replace([
				{ start: basis.source.length, remove: 0, text: "REVOKED DRAFT\n" },
			])
			yield* draft.saved
			let refusal = yield* worker.Sync().pipe(Effect.result)
			check(
				refusal._tag === "Failure" &&
					refusal.failure instanceof WorkerDocumentFailure &&
					refusal.failure.category === "access",
				"real owner writer revocation refuses worker remote acceptance",
			)
			let retained = yield* worker.Read()
			check(
				retained.localSource === draft.source &&
					retained.pending > 0 &&
					editor.state().source === draft.source,
				"permission refusal retains main draft, worker local basis and durable pending action",
			)
			let deniedSnapshot = yield* owner.documents.snapshot({
				params: { document },
				query: { encoding: "compact" },
			})
			let deniedReplica = yield* restoreSnapshot(
				deniedSnapshot,
				"revocation-owner-reader",
			)
			check(
				deniedReplica.text(document) === allowed.source,
				"server accepted source excludes unauthorized pending draft",
			)
			yield* member.connect
			let reconnect = yield* worker.Sync().pipe(Effect.result)
			check(
				reconnect._tag === "Failure" &&
					reconnect.failure instanceof WorkerDocumentFailure &&
					reconnect.failure.category === "access",
				"reauthentication cannot republish while worker account remains reader",
			)
			yield* owner.workspaces.membership({
				params: { workspace, member: member.subject },
				payload: { role: "writer", request: crypto.randomUUID() },
			})
			yield* worker.Sync()
			let accepted = yield* owner.documents.snapshot({
				params: { document },
				query: { encoding: "compact" },
			})
			let acceptedReplica = yield* restoreSnapshot(
				accepted,
				"reauthorized-owner-reader",
			)
			check(
				acceptedReplica.text(document) === draft.source,
				"owner reauthorization accepts preserved draft exactly once",
			)
			let ended = yield* worker.End({ epoch: basis.epoch, sequence: 1 })
			check(
				ended.source === draft.source,
				"idle merge preserves reauthorized editor source",
			)
			yield* worker.Close()
		}),
	)
}
