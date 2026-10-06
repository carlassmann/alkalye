import { afterAll, beforeAll, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type * as Crypto from "effect/Crypto"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import * as HttpApiClient from "effect/http-api/HttpApiClient"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import { Signatures } from "../src/platform/signatures"
import { webCryptoLayer } from "../src/platform/web-crypto"
import { startServer } from "../src/server/index"
import { encode } from "../src/shared/base64"
import { Replica } from "../src/shared/crdt"
import { buildAction, restoreSnapshot } from "../src/shared/document-actions"
import { DocumentApi } from "../src/shared/document-api"
import { newDocument } from "../src/shared/documents"
import { invitationDigest, invitationSecret } from "../src/shared/invitations"
import { cookieLogin, liveSocket as openLiveSocket } from "./live-fixture"

let directory = await mkdtemp(join(tmpdir(), "alkalye-workspace-deletion-"))
let instance: Effect.Success<ReturnType<typeof startServer>>
beforeAll(async () => {
	instance = await Effect.runPromise(
		startServer({ port: 0, data: directory, build: false }),
	)
})
afterAll(async () => {
	await Effect.runPromise(instance.close())
	await rm(directory, { recursive: true, force: true })
})

test("deleting a workspace removes it and its documents for everyone and denies every later use", () =>
	run(
		Effect.gen(function* () {
			let owner = yield* client(201)
			let writer = yield* client(202)
			let reader = yield* client(203)
			let stranger = yield* client(204)
			yield* createWorkspace(owner, "doomed", "Doomed")
			yield* createWorkspace(owner, "kept", "Kept")
			yield* createDocument(owner, "doomed", "doomed-doc")
			yield* createDocument(owner, "doomed", "doomed-moving")
			yield* createDocument(owner, "kept", "kept-doc")
			yield* member(owner, "doomed", writer, "writer")
			yield* member(owner, "doomed", reader, "reader")
			yield* grant(owner, "doomed-doc", "public", "reader")
			let pending = yield* invite(owner, { workspace: "doomed" }, "writer")
			let documentLink = yield* invite(
				owner,
				{ document: "doomed-doc" },
				"reader",
			)
			expect(yield* roles(writer)).toEqual([
				["doomed-doc", "writer"],
				["doomed-moving", "writer"],
			])
			yield* stranger.api.documents.snapshot({
				params: { document: "doomed-doc" },
			})

			yield* remove(owner, "doomed", "Doomed", "delete-doomed")

			let library = yield* owner.api.workspaces.library()
			expect(library.workspaces.map(space => space.workspace)).toEqual(["kept"])
			expect(library.documents.map(entry => entry.document)).toEqual([
				"kept-doc",
			])
			for (let account of [writer, reader, stranger])
				expect(yield* account.api.workspaces.library()).toEqual({
					workspaces: [],
					documents: [],
				})
			for (let account of [owner, writer, reader, stranger]) {
				expect(
					yield* failure(
						account.api.documents.snapshot({
							params: { document: "doomed-doc" },
						}),
					),
				).toBe("ResourceUnavailable")
				expect(
					yield* failure(
						account.api.documents.history({
							params: { document: "doomed-doc" },
							query: {},
						}),
					),
				).toBe("ResourceUnavailable")
				expect(
					yield* failure(
						account.api.workspaces.snapshot({
							params: { workspace: "doomed" },
						}),
					),
				).toBe("ResourceUnavailable")
			}
			expect(
				yield* failure(
					writer.api.documents.missingBlobs({
						params: { document: "doomed-doc" },
						payload: [],
					}),
				),
			).toBe("ResourceUnavailable")
			expect(yield* failure(createDocument(owner, "doomed", "late-doc"))).toBe(
				"PermissionDenied",
			)
			expect(yield* failure(createDocument(writer, "doomed", "late-doc"))).toBe(
				"PermissionDenied",
			)
			expect(
				yield* failure(
					owner.api.workspaces.rename({
						params: { workspace: "doomed" },
						payload: { name: "Revived", request: "rename-doomed" },
					}),
				),
			).toBe("PermissionDenied")
			expect(yield* failure(member(owner, "doomed", stranger, "writer"))).toBe(
				"PermissionDenied",
			)
			expect(
				yield* failure(invite(owner, { workspace: "doomed" }, "reader")),
			).toBe("ResourceUnavailable")
			expect(
				yield* failure(invite(owner, { document: "doomed-doc" }, "reader")),
			).toBe("ResourceUnavailable")
			for (let link of [pending, documentLink]) {
				expect(
					yield* failure(
						stranger.api.invitations.describe({
							params: { invitation: link.invitation },
							payload: { secret: link.secret },
						}),
					),
				).toBe("ResourceUnavailable")
				expect(
					yield* failure(
						stranger.api.invitations.accept({
							params: { invitation: link.invitation },
							payload: { secret: link.secret, request: "late-join" },
						}),
					),
				).toBe("ResourceUnavailable")
			}
			expect(
				yield* failure(
					owner.api.documents.move({
						params: { document: "doomed-moving" },
						payload: { workspace: "kept", request: "rescue" },
					}),
				),
			).toBe("ResourceUnavailable")
			expect(
				yield* failure(
					owner.api.documents.move({
						params: { document: "kept-doc" },
						payload: { workspace: "doomed", request: "bury" },
					}),
				),
			).toBe("ResourceUnavailable")
			expect(
				yield* failure(
					owner.api.workspaces.create({
						payload: {
							workspace: "doomed",
							name: "Doomed",
							request: "recreate-doomed",
						},
					}),
				),
			).toBe("ResourceUnavailable")
			expect(yield* failure(edit(owner, "kept-doc", "Still editable"))).toBe(
				"Success",
			)
		}),
	))

test("only the owner deletes, the personal workspace stays and the name must match", () =>
	run(
		Effect.gen(function* () {
			let owner = yield* client(211)
			let writer = yield* client(212)
			let reader = yield* client(213)
			let stranger = yield* client(214)
			yield* createWorkspace(owner, "guarded", "Guarded")
			yield* member(owner, "guarded", writer, "writer")
			yield* member(owner, "guarded", reader, "reader")
			expect(
				yield* failure(remove(writer, "guarded", "Guarded", "writer-delete")),
			).toBe("PermissionDenied")
			expect(
				yield* failure(remove(reader, "guarded", "Guarded", "reader-delete")),
			).toBe("PermissionDenied")
			expect(
				yield* failure(
					remove(stranger, "guarded", "Guarded", "stranger-delete"),
				),
			).toBe("ResourceUnavailable")
			expect(
				yield* failure(remove(owner, "missing", "Missing", "missing-delete")),
			).toBe("ResourceUnavailable")
			expect(
				yield* refusal(remove(owner, "guarded", "guarded", "wrong-name")),
			).toBe("NameMismatch")
			yield* owner.api.workspaces.rename({
				params: { workspace: "guarded" },
				payload: { name: "Renamed", request: "rename-guarded" },
			})
			expect(
				yield* refusal(remove(owner, "guarded", "Guarded", "stale-name")),
			).toBe("NameMismatch")
			let personal = "personal-" + owner.subject
			yield* owner.api.workspaces.create({
				payload: {
					workspace: personal,
					name: "Personal",
					request: "personal-v1",
				},
			})
			expect(
				yield* refusal(remove(owner, personal, "Personal", "delete-personal")),
			).toBe("Personal")
			expect(
				(yield* owner.api.workspaces.library()).workspaces.map(
					space => space.workspace,
				),
			).toEqual(["guarded", personal].sort())
			yield* remove(owner, "guarded", "Renamed", "delete-guarded")
		}),
	))

test("retrying a deletion returns its receipt while a new request is refused", () =>
	run(
		Effect.gen(function* () {
			let owner = yield* client(221)
			let writer = yield* client(222)
			yield* createWorkspace(owner, "retried", "Retried")
			yield* member(owner, "retried", writer, "writer")
			let first = yield* remove(owner, "retried", "Retried", "delete-retried")
			expect(yield* remove(owner, "retried", "Retried", "delete-retried")).toBe(
				first,
			)
			expect(
				yield* failure(
					remove(owner, "retried", "Retried", "delete-retried-again"),
				),
			).toBe("ResourceUnavailable")
			expect(
				yield* failure(remove(writer, "retried", "Retried", "delete-retried")),
			).toBe("DocumentConflict")
		}),
	))

test("concurrent deletions and writes settle on one tombstone without leaking access", () =>
	run(
		Effect.gen(function* () {
			let owner = yield* client(231)
			let writer = yield* client(232)
			yield* createWorkspace(owner, "raced", "Raced")
			yield* createDocument(owner, "raced", "raced-doc")
			yield* member(owner, "raced", writer, "writer")
			let link = yield* invite(owner, { workspace: "raced" }, "reader")
			let joiner = yield* client(233)
			let outcomes = yield* Effect.all(
				[
					remove(owner, "raced", "Raced", "race-one").pipe(Effect.result),
					remove(owner, "raced", "Raced", "race-one").pipe(Effect.result),
					remove(owner, "raced", "Raced", "race-two").pipe(Effect.result),
					failure(createDocument(writer, "raced", "raced-new")),
					failure(edit(writer, "raced-doc", "Racing edit")),
					failure(
						joiner.api.invitations.accept({
							params: { invitation: link.invitation },
							payload: { secret: link.secret, request: "race-join" },
						}),
					),
				],
				{ concurrency: "unbounded" },
			)
			let [one, again, two, created, edited, joined] = outcomes
			expect(one._tag).toBe("Success")
			expect(again).toEqual(one)
			if (two._tag === "Success") expect(two).not.toEqual(one)
			else expect(two.failure._tag).toBe("ResourceUnavailable")
			for (let outcome of [created, edited, joined])
				expect([
					"Success",
					"PermissionDenied",
					"ResourceUnavailable",
				]).toContain(outcome)
			for (let account of [owner, writer, joiner]) {
				let library = yield* account.api.workspaces.library()
				expect(library.workspaces.map(space => space.workspace)).not.toContain(
					"raced",
				)
				expect(
					library.documents.filter(entry => entry.workspace === "raced"),
				).toEqual([])
				for (let document of ["raced-doc", "raced-new"])
					expect(
						yield* failure(
							account.api.documents.snapshot({ params: { document } }),
						),
					).toBe("ResourceUnavailable")
			}
		}),
	))

test("watching collaborators learn a deleted workspace's documents became unavailable", async () => {
	let owner = await run(client(241))
	let reader = await run(client(242))
	await run(
		Effect.gen(function* () {
			yield* createWorkspace(owner, "watched", "Watched")
			yield* createDocument(owner, "watched", "watched-doc")
			yield* member(owner, "watched", reader, "reader")
		}),
	)
	let live = await liveSocket(242, reader.subject)
	try {
		expect(await live.next()).toMatchObject({ type: "connected" })
		live.send({ type: "watch", document: "watched-doc" })
		await run(createDocument(owner, "watched", "watched-other"))
		expect(await live.next()).toEqual({ type: "advanced" })
		await run(remove(owner, "watched", "Watched", "delete-watched"))
		expect(await live.next()).toEqual({
			type: "unavailable",
			document: "watched-doc",
		})
		live.send({ type: "watch", document: "watched-other" })
		expect(await live.next()).toEqual({ type: "advanced" })
		expect(await live.next()).toEqual({
			type: "unavailable",
			document: "watched-other",
		})
	} finally {
		live.close()
	}
})

test("deletions survive restarts and the tombstone migration upgrades existing data", async () => {
	let data = await mkdtemp(join(tmpdir(), "alkalye-workspace-migration-"))
	try {
		let first = await Effect.runPromise(
			startServer({ port: 0, data, build: false }),
		)
		await run(
			Effect.gen(function* () {
				let owner = yield* client(251, first.server.url)
				yield* createWorkspace(owner, "legacy", "Legacy")
				yield* createWorkspace(owner, "short-lived", "Short-lived")
				yield* createDocument(owner, "legacy", "legacy-doc")
				yield* createDocument(owner, "short-lived", "short-doc")
				yield* remove(owner, "short-lived", "Short-lived", "delete-short")
			}),
		)
		await Effect.runPromise(first.close())
		let restarted = await Effect.runPromise(
			startServer({ port: 0, data, build: false }),
		)
		await run(
			Effect.gen(function* () {
				let owner = yield* client(251, restarted.server.url)
				let library = yield* owner.api.workspaces.library()
				expect(library.workspaces.map(space => space.workspace)).toEqual([
					"legacy",
				])
				expect(
					yield* failure(
						owner.api.documents.snapshot({ params: { document: "short-doc" } }),
					),
				).toBe("ResourceUnavailable")
				expect(
					yield* remove(owner, "short-lived", "Short-lived", "delete-short"),
				).toBeGreaterThan(0)
			}),
		)
		await Effect.runPromise(restarted.close())
		// Roll the projection back to its shape before tombstones existed.
		let database = new Database(join(data, "documents.sqlite"))
		database.run("UPDATE workspaces SET deleted=0")
		database.run("ALTER TABLE workspaces DROP COLUMN deleted")
		// Later migrations postdate tombstones, so they roll back as well.
		database.run(
			"DELETE FROM document_projection_migrations WHERE name IN ('workspace_tombstones','workspace_avatars')",
		)
		database.close()
		let upgraded = await Effect.runPromise(
			startServer({ port: 0, data, build: false }),
		)
		try {
			await run(
				Effect.gen(function* () {
					let owner = yield* client(251, upgraded.server.url)
					let library = yield* owner.api.workspaces.library()
					expect(library.workspaces.map(space => space.workspace)).toEqual(
						["legacy", "short-lived"].sort(),
					)
					yield* remove(owner, "legacy", "Legacy", "delete-legacy")
					expect(
						yield* failure(
							owner.api.documents.snapshot({
								params: { document: "legacy-doc" },
							}),
						),
					).toBe("ResourceUnavailable")
				}),
			)
		} finally {
			await Effect.runPromise(upgraded.close())
		}
	} finally {
		await rm(data, { recursive: true, force: true })
	}
})

type Client = Effect.Success<ReturnType<typeof client>>
function client(seed: number, base = instance.server.url) {
	return Effect.gen(function* () {
		let signatures = yield* Signatures
		let identity = yield* signatures.account(
			Redacted.make(encode(new Uint8Array(32).fill(seed))),
		)
		let anonymous = yield* HttpApiClient.make(DocumentApi, { baseUrl: base })
		let issued = yield* anonymous.authentication.challenge({
			payload: { publicKey: identity.publicKey, purpose: "bearer" },
		})
		let signature = yield* identity.signAuthentication(issued, {
			origin: base.origin,
			purpose: "bearer",
		})
		let login = yield* anonymous.authentication.bearerLogin({
			payload: { id: issued.id, publicKey: identity.publicKey, signature },
		})
		let api = yield* HttpApiClient.make(DocumentApi, {
			baseUrl: base,
			transformClient: client =>
				HttpClient.mapRequest(
					client,
					HttpClientRequest.bearerToken(Redacted.make(login.token)),
				),
		})
		return { api, subject: login.subject }
	})
}
async function liveSocket(seed: number, subject: string) {
	let login = await cookieLogin(instance.server.url, seed)
	expect(login.subject).toBe(subject)
	return openLiveSocket(login)
}
function createWorkspace(owner: Client, workspace: string, name: string) {
	return owner.api.workspaces.create({
		payload: { workspace, name, request: "create-" + workspace },
	})
}
function remove(
	owner: Client,
	workspace: string,
	name: string,
	request: string,
) {
	return owner.api.workspaces.remove({
		params: { workspace },
		payload: { name, request },
	})
}
function member(
	owner: Client,
	workspace: string,
	account: Client,
	role: "writer" | "reader",
) {
	return owner.api.workspaces.membership({
		params: { workspace, member: account.subject },
		payload: { role, request: "member-" + workspace + "-" + account.subject },
	})
}
function createDocument(owner: Client, workspace: string, document: string) {
	return Effect.gen(function* () {
		let action = yield* buildAction(
			new Replica(owner.subject + "-" + document),
			document,
			"Create document",
			staged =>
				newDocument(staged, document, "Untitled", "# Shared plan\n\nBody"),
		)
		return yield* owner.api.documents.create({ payload: { workspace, action } })
	})
}
function invite(
	owner: Client,
	target: { workspace: string } | { document: string },
	role: "writer" | "reader",
) {
	return Effect.gen(function* () {
		let invitation = crypto.randomUUID()
		let secret = yield* invitationSecret
		yield* owner.api.invitations.create({
			payload: {
				invitation,
				target,
				role,
				digest: yield* invitationDigest(secret),
			},
		})
		return { invitation, secret }
	})
}
function edit(account: Client, document: string, text: string) {
	return Effect.gen(function* () {
		let replica = yield* restoreSnapshot(
			yield* account.api.documents.snapshot({ params: { document } }),
			account.subject + "-" + text.replace(/\W+/g, "-").slice(0, 40),
		)
		let action = yield* buildAction(replica, document, "Edit", staged => [
			staged.edit(document, staged.text(document) + "\n" + text),
		])
		return yield* account.api.documents.commit({
			params: { document },
			payload: action,
		})
	})
}
function grant(account: Client, document: string, who: string, role: string) {
	return Effect.gen(function* () {
		let replica = yield* restoreSnapshot(
			yield* account.api.documents.snapshot({ params: { document } }),
			account.subject + "-grant-" + who + "-" + (role || "none"),
		)
		let action = yield* buildAction(replica, document, "Share", staged => [
			staged.set(document, "access:" + who, role),
		])
		return yield* account.api.documents.commit({
			params: { document },
			payload: action,
		})
	})
}
function roles(account: Client) {
	return account.api.workspaces
		.library()
		.pipe(
			Effect.map(library =>
				library.documents.map(entry => [entry.document, entry.role]),
			),
		)
}
function failure<A, E extends { _tag: string }, R>(
	effect: Effect.Effect<A, E, R>,
) {
	return effect.pipe(
		Effect.as("Success"),
		Effect.catch(error => Effect.succeed(error._tag)),
	)
}
function refusal<A, E extends { _tag: string }, R>(
	effect: Effect.Effect<A, E, R>,
) {
	return effect.pipe(
		Effect.as("Success"),
		Effect.catch(error =>
			Effect.succeed(
				error._tag === "WorkspaceDeletionRefused" && "reason" in error
					? String(error.reason)
					: error._tag,
			),
		),
	)
}
function run<A, E>(
	effect: Effect.Effect<
		A,
		E,
		Signatures | HttpClient.HttpClient | Crypto.Crypto
	>,
) {
	return Effect.runPromise(
		effect.pipe(
			Effect.provide(Signatures.layer),
			Effect.provide(FetchHttpClient.layer),
			Effect.provide(webCryptoLayer),
		),
	)
}
