import { expect, test } from "bun:test"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import * as HttpServer from "effect/http/HttpServer"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as SqlClient from "effect/sql/SqlClient"
import { blobDigest } from "../src/shared/document-blobs"
import { CloudflareBlobBudget } from "../src/cloudflare/blob-budget"
import { makeWorkspaceUploads } from "../src/cloudflare/workspace-uploads"
import type { WorkspaceRequest } from "../src/cloudflare/workspace-rpc"
import { sqliteLayer } from "../src/platform/sqlite"
import { webCryptoLayer } from "../src/platform/web-crypto"
import { WorkspaceTransfers } from "../src/server/workspace-transfer"
import {
	DocumentMaintenance,
	WorkspaceStore,
} from "../src/server/document-store"
import { RequestOrigin } from "../src/server/request-origin"
import { DocumentObservability } from "../src/shared/document-observability"
import { Identity } from "../src/shared/workspace"
import { Replica } from "../src/shared/crdt"
import { buildAction, restoreSnapshot } from "../src/shared/document-actions"
import { invitationDigest } from "../src/shared/invitations"
import { newDocument } from "../src/shared/documents"
import { WorkspaceDirectory } from "../src/cloudflare/workspace-directory"
import { makeWorkspaceHandler } from "../src/cloudflare/workspace-api"
import { makeFederatedWorkspaceStore } from "../src/cloudflare/workspace-store"

function storage() {
	return ManagedRuntime.make(
		WorkspaceStore.live.pipe(
			Layer.provideMerge(sqliteLayer(":memory:")),
			Layer.provideMerge(webCryptoLayer),
		),
	)
}
class TestHandler extends Context.Service<
	TestHandler,
	Effect.Success<ReturnType<typeof makeWorkspaceHandler>>
>()("WorkspaceTestHandler") {}
function remoteStorage() {
	return ManagedRuntime.make(
		Layer.effect(TestHandler, makeWorkspaceHandler()).pipe(
			Layer.provideMerge(
				Layer.mergeAll(
					WorkspaceStore.live,
					WorkspaceTransfers.live,
					DocumentMaintenance.live,
				),
			),
			Layer.provideMerge(sqliteLayer(":memory:")),
			Layer.provideMerge(webCryptoLayer),
			Layer.provideMerge(HttpServer.layerServices),
			Layer.provideMerge(DocumentObservability.layer("server")),
			Layer.provideMerge(
				Layer.succeed(RequestOrigin, {
					read: Effect.succeed("https://workspace.internal"),
					bind: () => Effect.void,
				}),
			),
		),
	)
}
function principal<A, E, R>(
	effect: Effect.Effect<A, E, R>,
	subject = "owner",
	access?: Identity["Service"]["access"],
) {
	return effect.pipe(
		Effect.provideService(
			FetchHttpClient.Fetch,
			Object.assign(
				() => Promise.reject(new Error("Private RPC escaped to ambient fetch")),
				{ preconnect() {} },
			),
		),
		Effect.provideService(Identity, {
			subject,
			actors: [subject + "-edit", subject + "-profile"],
			...(access ? { access } : {}),
		}),
	)
}

test("federated public stores preserve isolated authority, discovery, profiles and unknown accepted receipts", async () => {
	let local = storage()
	let first = remoteStorage()
	let second = remoteStorage()
	let directoryRuntime = ManagedRuntime.make(
		WorkspaceDirectory.live.pipe(Layer.provide(sqliteLayer(":memory:"))),
	)
	try {
		let localStore = await local.runPromise(
			Effect.gen(function* () {
				return yield* WorkspaceStore
			}),
		)
		let directory = await directoryRuntime.runPromise(
			Effect.gen(function* () {
				return yield* WorkspaceDirectory
			}),
		)
		let firstHandler = await first.runPromise(
			Effect.gen(function* () {
				return yield* TestHandler
			}),
		)
		let secondHandler = await second.runPromise(
			Effect.gen(function* () {
				return yield* TestHandler
			}),
		)
		let loseNext = false
		let adapter = await Effect.runPromise(
			makeFederatedWorkspaceStore({
				local: localStore,
				directory,
				request: async (workspace, identity, request) => {
					if (workspace === "broken")
						throw new Error("Unavailable isolated workspace")
					let response = await (
						workspace === "first" ? firstHandler : secondHandler
					)(request, Context.make(Identity, identity))
					if (loseNext) {
						loseNext = false
						throw new Error("Response lost after public commit")
					}
					return response
				},
			}),
		)
		await local.runPromise(
			principal(localStore.savePreferences({ name: "Owner name" }, "profile")),
		)
		await local.runPromise(
			principal(
				localStore.savePreferences({ name: "Reader name" }, "reader-profile"),
				"reader",
			),
		)
		await local.runPromise(
			principal(
				Effect.gen(function* () {
					yield* localStore.create("first", "Retained legacy", "legacy-space")
					yield* localStore.membership(
						"first",
						"reader",
						"reader",
						"legacy-reader",
					)
					let birth = yield* buildAction(
						new Replica("owner-edit"),
						"doc",
						"Legacy",
						r =>
							newDocument(r, "doc", "Old private title", "Old private source"),
					)
					yield* localStore.createDocument("first", birth)
				}),
			),
		)
		await Effect.runPromise(
			principal(
				Effect.gen(function* () {
					yield* adapter.create("first", "First", "create-first")
					yield* adapter.create("second", "Second", "create-second")
					let action = yield* buildAction(
						new Replica("owner-edit"),
						"doc",
						"Create",
						r => newDocument(r, "doc", "Document", "Body😀"),
					)
					yield* adapter.createDocument("first", action)
					let library = yield* adapter.library()
					expect(library.workspaces.map(row => row.workspace)).toContain(
						"first",
					)
					expect(library.workspaces.map(row => row.workspace)).toContain(
						"second",
					)
					expect(library.documents.map(row => row.document)).toEqual(["doc"])
					let snapshot = yield* adapter.workspaceSnapshot("first")
					if (!snapshot)
						return yield* Effect.fail(new Error("Missing workspace"))
					expect(snapshot.ownerName).toBe("Owner name")
					yield* adapter.membership("first", "reader", "reader", "grant-reader")
					snapshot = yield* adapter.workspaceSnapshot("first")
					if (!snapshot)
						return yield* Effect.fail(new Error("Missing granted workspace"))
					expect(
						snapshot.members.find(row => row.member === "reader")?.name,
					).toBe("Reader name")
					let state = yield* adapter.snapshot("doc")
					if (!state)
						return yield* Effect.fail(new Error("Missing remote document"))
					let replica = yield* restoreSnapshot(state, "owner-edit")
					let edit = yield* buildAction(replica, "doc", "Edit", r => [
						r.edit("doc", r.text("doc") + "x"),
					])
					loseNext = true
					let lost = yield* adapter.commit(edit).pipe(Effect.exit)
					expect(lost._tag).toBe("Failure")
					let position = yield* adapter.commit(edit)
					let history = yield* adapter.history("doc", 0, undefined, undefined)
					expect(history.filter(row => row.action.id === edit.id)).toHaveLength(
						1,
					)
					expect(history.find(row => row.action.id === edit.id)?.position).toBe(
						position,
					)
					let fresh = yield* adapter.snapshot("doc")
					if (!fresh)
						return yield* Effect.fail(
							new Error("Missing committed remote document"),
						)
					expect((yield* restoreSnapshot(fresh, "readback")).text("doc")).toBe(
						replica.text("doc") + "x",
					)
				}),
			),
		)
		await Effect.runPromise(
			principal(
				Effect.gen(function* () {
					expect(
						(yield* adapter.library()).documents.map(row => row.document),
					).toEqual(["doc"])
					expect(yield* adapter.accessRole("doc", "reader")).toBe("reader")
					let rename = yield* adapter
						.rename("first", "Forbidden", "reader-rename")
						.pipe(Effect.exit)
					expect(rename._tag).toBe("Failure")
				}),
				"reader",
			),
		)
		await Effect.runPromise(
			principal(
				Effect.gen(function* () {
					let rows = yield* adapter.library()
					expect(rows.workspaces.map(row => row.workspace)).toEqual(["first"])
					expect(
						(yield* adapter
							.rename("first", "Denied", "attenuated")
							.pipe(Effect.exit))._tag,
					).toBe("Failure")
				}),
				"owner",
				{ workspaces: ["first"], ceiling: "reader" },
			),
		)
		await Effect.runPromise(
			principal(
				Effect.gen(function* () {
					expect(
						yield* adapter
							.create("personal-owner", "Squat", "squat")
							.pipe(
								Effect.catchTag("PermissionDenied", () =>
									Effect.succeed("denied"),
								),
							),
					).toBe("denied")
					expect(yield* directory.workspace("personal-owner")).toBeUndefined()
					expect(
						yield* adapter
							.create("first", "Steal", "steal")
							.pipe(
								Effect.catchTag("PermissionDenied", () =>
									Effect.succeed("denied"),
								),
							),
					).toBe("denied")
					yield* directory.registerWorkspace("broken", "stranger")
					yield* directory.rememberMember("broken", "reader")
					yield* directory.rememberMember("second", "reader")
					yield* directory.freezeWorkspace("second", 0)
					expect(
						(yield* adapter.library()).workspaces.map(row => row.workspace),
					).toEqual(["personal-reader", "first"])
				}),
				"reader",
			),
		)
		let secret = "A".repeat(43)
		let digest = await local.runPromise(invitationDigest(secret))
		await Effect.runPromise(
			principal(
				adapter.createInvitation(
					"invite",
					{ document: "doc" },
					"writer",
					digest,
				),
			),
		)
		let preview = await Effect.runPromise(
			adapter.describeInvitation("invite", secret),
		)
		expect(preview.kind).toBe("document")
		expect(preview.owner).toBe("Owner name")
		expect(preview.role).toBe("writer")
		loseNext = true
		expect(
			(
				await Effect.runPromise(
					principal(
						adapter.acceptInvitation("invite", secret, "guest-accept"),
						"guest",
					).pipe(Effect.exit),
				)
			)._tag,
		).toBe("Failure")
		await Effect.runPromise(
			principal(
				adapter.acceptInvitation("invite", secret, "guest-accept"),
				"guest",
			),
		)
		expect(
			await Effect.runPromise(
				principal(adapter.sharedDocuments(), "guest"),
			).then(rows => rows.map(row => row.document)),
		).toEqual(["doc"])
		await Effect.runPromise(
			principal(adapter.membership("first", "reader", null, "revoke-reader")),
		)
		expect(
			await local
				.runPromise(principal(localStore.library(), "reader"))
				.then(value => value.documents.map(row => row.document)),
		).toEqual(["doc"])
		await Effect.runPromise(
			principal(
				Effect.gen(function* () {
					expect((yield* adapter.library()).documents).toEqual([])
					expect(yield* adapter.snapshot("doc")).toBeUndefined()
				}),
				"reader",
			),
		)
		await Effect.runPromise(
			principal(
				Effect.gen(function* () {
					let birth = yield* buildAction(
						new Replica("owner-profile"),
						"profile-doc",
						"Profile document",
						r => newDocument(r, "profile-doc", "Late legacy", "Durable local"),
					)
					yield* adapter.createDocument("personal-owner", birth)
					expect((yield* directory.document("profile-doc"))?.workspace).toBe(
						"personal-owner",
					)
					expect((yield* directory.workspace("personal-owner"))?.state).toBe(
						"legacy",
					)
					expect(
						(yield* adapter.createDocument("first", birth).pipe(Effect.exit))
							._tag,
					).toBe("Failure")
					expect(yield* localStore.snapshot("profile-doc")).toBeDefined()
				}),
			),
		)
		expect(
			await first
				.runPromise(principal(WorkspaceStore.use(store => store.library())))
				.then(value => value.documents.length),
		).toBe(1)
		expect(
			await second
				.runPromise(principal(WorkspaceStore.use(store => store.library())))
				.then(value => value.documents.length),
		).toBe(0)
	} finally {
		await Promise.all([
			local.dispose(),
			first.dispose(),
			second.dispose(),
			directoryRuntime.dispose(),
		])
	}
})

test("federated uploads pin authorized workspace and retain global quota across moves", async () => {
	let local = storage()
	let first = remoteStorage()
	let second = remoteStorage()
	let authority = ManagedRuntime.make(
		Layer.mergeAll(WorkspaceDirectory.live, CloudflareBlobBudget.live).pipe(
			Layer.provideMerge(sqliteLayer(":memory:")),
			Layer.provideMerge(webCryptoLayer),
		),
	)
	try {
		let localStore = await local.runPromise(
			Effect.gen(function* () {
				return yield* WorkspaceStore
			}),
		)
		let directory = await authority.runPromise(
			Effect.gen(function* () {
				return yield* WorkspaceDirectory
			}),
		)
		let firstHandler = await first.runPromise(
			Effect.gen(function* () {
				return yield* TestHandler
			}),
		)
		let secondHandler = await second.runPromise(
			Effect.gen(function* () {
				return yield* TestHandler
			}),
		)
		let freezeUpload = false
		let uploadWorkspaces: string[] = []
		let request: WorkspaceRequest = async (workspace, identity, request) => {
			if (
				request.method === "PUT" &&
				new URL(request.url).pathname.includes("/blobs/")
			) {
				uploadWorkspaces.push(workspace)
				if (freezeUpload) {
					freezeUpload = false
					await first.runPromise(
						principal(
							WorkspaceTransfers.use(transfers =>
								transfers.stageDocumentMove(
									"upload-doc",
									"second",
									"race-move",
								),
							),
						),
					)
				}
			}
			return (workspace === "first" ? firstHandler : secondHandler)(
				request,
				Context.make(Identity, identity),
			)
		}
		let adapter = await Effect.runPromise(
			makeFederatedWorkspaceStore({ local: localStore, directory, request }),
		)
		let upload = await authority.runPromise(
			makeWorkspaceUploads(request, adapter.putBlob),
		)
		await local.runPromise(
			principal(
				Effect.gen(function* () {
					yield* adapter.create("first", "First", "upload-first")
					yield* adapter.create("second", "Second", "upload-second")
					let action = yield* buildAction(
						new Replica("owner-edit"),
						"upload-doc",
						"Create",
						r => newDocument(r, "upload-doc", "Upload", "body"),
					)
					yield* adapter.createDocument("first", action)
					yield* adapter.membership(
						"first",
						"reader",
						"reader",
						"upload-reader",
					)
				}),
			),
		)
		let bytes = new Uint8Array([1, 2, 3])
		let digest = await authority.runPromise(blobDigest(bytes))
		expect(
			(
				await authority.runPromise(
					principal(upload("upload-doc", digest, bytes), "reader").pipe(
						Effect.exit,
					),
				)
			)._tag,
		).toBe("Failure")
		expect(uploadWorkspaces).toEqual([])
		await authority.runPromise(principal(upload("upload-doc", digest, bytes)))
		expect(uploadWorkspaces).toEqual(["first"])
		expect(
			Array.from(
				await local.runPromise(
					principal(adapter.getBlob("upload-doc", digest)),
				),
			),
		).toEqual([1, 2, 3])
		let nextBytes = new Uint8Array([4, 5, 6])
		let nextDigest = await authority.runPromise(blobDigest(nextBytes))
		freezeUpload = true
		let refused = await authority.runPromise(
			principal(upload("upload-doc", nextDigest, nextBytes)).pipe(Effect.exit),
		)
		expect(refused._tag).toBe("Failure")
		expect(uploadWorkspaces).toEqual(["first", "first"])
		let budget = await authority.runPromise(
			Effect.gen(function* () {
				return yield* CloudflareBlobBudget
			}),
		)
		let rows = await authority.runPromise(
			SqlClient.SqlClient.use(
				sql =>
					sql<{
						document: string
						digest: string
						state: string
					}>`SELECT document,digest,state FROM cloudflare_blob_budget ORDER BY digest`,
			),
		)
		expect(rows).toHaveLength(2)
		expect(rows.find(row => row.digest === nextDigest)?.state).toBe("pending")
		expect(rows.find(row => row.digest === digest)?.state).toBe("confirmed")
		await authority.runPromise(
			budget.reassignDocument("upload-doc", "owner", "next-owner"),
		)
		await authority.runPromise(
			budget.reassignDocument("upload-doc", "owner", "next-owner"),
		)
		let owners = await authority.runPromise(
			SqlClient.SqlClient.use(
				sql => sql<{ owner: string }>`SELECT owner FROM cloudflare_blob_budget`,
			),
		)
		expect(owners).toEqual([{ owner: "next-owner" }, { owner: "next-owner" }])
	} finally {
		await Promise.all([
			local.dispose(),
			first.dispose(),
			second.dispose(),
			authority.dispose(),
		])
	}
})
