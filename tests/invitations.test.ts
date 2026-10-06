import { afterAll, beforeAll, expect, test } from "bun:test"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as Crypto from "effect/Crypto"
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
import {
	invitationDigest,
	invitationLink,
	invitationSecret,
	parseInvitationLink,
} from "../src/shared/invitations"

let directory = await mkdtemp(join(tmpdir(), "alkalye-invitations-"))
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

test("personal workspace identifiers cannot be claimed by another account", () =>
	run(
		Effect.gen(function* () {
			let attacker = yield* client(181)
			let victim = yield* client(182)
			let personal = "personal-" + victim.subject
			expect(yield* failure(createWorkspace(attacker, personal))).toBe(
				"PermissionDenied",
			)
			yield* victim.api.preferences.save({
				payload: {
					request: "own-personal-preferences",
					patch: { name: "Victim" },
				},
			})
			expect(
				(yield* victim.api.workspaces.snapshot({
					params: { workspace: personal },
				})).owner,
			).toBe(victim.subject)
			yield* createDocument(victim, personal, "protected-personal-document")
			expect(yield* roles(victim)).toContainEqual([
				"protected-personal-document",
				"owner",
			])
			expect(yield* roles(attacker)).not.toContainEqual([
				"protected-personal-document",
				"owner",
			])
		}),
	))

test("leaving invitations requires an active membership and retries never grow the owner's journal", () =>
	run(
		Effect.gen(function* () {
			let owner = yield* client(183)
			let guest = yield* client(184)
			let stranger = yield* client(185)
			let workspace = "protected-leave-journal"
			yield* createWorkspace(owner, workspace)
			yield* createDocument(owner, workspace, "protected-leave-document")
			let link = yield* invite(
				owner,
				{ document: "protected-leave-document" },
				"writer",
			)
			let position = (yield* owner.api.workspaces.snapshot({
				params: { workspace },
			})).position
			for (let index = 0; index < 3; index++)
				expect(
					yield* failure(
						stranger.api.invitations.leave({
							params: { invitation: link.invitation, member: stranger.subject },
							payload: { request: "never-joined-" + index },
						}),
					),
				).toBe("ResourceUnavailable")
			expect(
				(yield* owner.api.workspaces.snapshot({ params: { workspace } }))
					.position,
			).toBe(position)
			yield* accept(guest, link, "active-guest")
			let leaving = guest.api.invitations.leave({
				params: { invitation: link.invitation, member: guest.subject },
				payload: { request: "active-guest-leaves" },
			})
			let receipt = yield* leaving
			position = (yield* owner.api.workspaces.snapshot({
				params: { workspace },
			})).position
			expect(yield* leaving).toBe(receipt)
			expect(
				(yield* owner.api.workspaces.snapshot({ params: { workspace } }))
					.position,
			).toBe(position)
			expect(
				yield* failure(
					guest.api.invitations.leave({
						params: { invitation: link.invitation, member: guest.subject },
						payload: { request: "already-left-new-request" },
					}),
				),
			).toBe("ResourceUnavailable")
			yield* accept(guest, link, "guest-rejoins")
			yield* owner.api.invitations.revoke({
				params: { invitation: link.invitation },
			})
			position = (yield* owner.api.workspaces.snapshot({
				params: { workspace },
			})).position
			expect(yield* leaving).toBe(receipt)
			for (let index = 0; index < 3; index++)
				expect(
					yield* failure(
						guest.api.invitations.leave({
							params: { invitation: link.invitation, member: guest.subject },
							payload: { request: "revoked-fresh-" + index },
						}),
					),
				).toBe("ResourceUnavailable")
			expect(
				(yield* owner.api.workspaces.snapshot({ params: { workspace } }))
					.position,
			).toBe(position)
		}),
	))

test("moving into another owner's workspace preserves document ownership and inherits destination access", () =>
	run(
		Effect.gen(function* () {
			let mover = yield* client(186)
			let host = yield* client(187)
			let reader = yield* client(188)
			let invited = yield* client(189)
			yield* createWorkspace(mover, "retained-owner-source")
			yield* createWorkspace(host, "retained-owner-destination")
			yield* host.api.workspaces.membership({
				params: {
					workspace: "retained-owner-destination",
					member: mover.subject,
				},
				payload: { role: "writer", request: "destination-writer" },
			})
			yield* host.api.workspaces.membership({
				params: {
					workspace: "retained-owner-destination",
					member: reader.subject,
				},
				payload: { role: "reader", request: "destination-reader" },
			})
			yield* createDocument(
				mover,
				"retained-owner-source",
				"retained-owner-document",
			)
			let link = yield* invite(
				mover,
				{ document: "retained-owner-document" },
				"writer",
			)
			yield* accept(invited, link, "invited-before-move")
			yield* mover.api.documents.move({
				params: { document: "retained-owner-document" },
				payload: {
					workspace: "retained-owner-destination",
					request: "move-to-host",
				},
			})
			let document = (yield* mover.api.workspaces.library()).documents.find(
				entry => entry.document === "retained-owner-document",
			)
			expect(document).toMatchObject({
				owner: mover.subject,
				role: "owner",
				workspace: "retained-owner-destination",
			})
			expect(yield* roles(host)).toContainEqual([
				"retained-owner-document",
				"owner",
			])
			expect(yield* roles(reader)).toContainEqual([
				"retained-owner-document",
				"reader",
			])
			expect(
				yield* failure(
					edit(reader, "retained-owner-document", "Reader must not write"),
				),
			).toBe("PermissionDenied")
			yield* edit(host, "retained-owner-document", "Workspace owner can edit")
			yield* mover.api.invitations.revoke({
				params: { invitation: link.invitation },
			})
			expect(yield* roles(invited)).toEqual([])
			yield* mover.api.documents.move({
				params: { document: "retained-owner-document" },
				payload: { workspace: "retained-owner-source", request: "move-home" },
			})
			expect(yield* roles(reader)).toEqual([])
			expect(yield* roles(host)).toEqual([])
			yield* remove(
				mover,
				"retained-owner-document",
				"Delete after moving home",
			)
			expect(
				(yield* mover.api.workspaces.library()).documents.find(
					entry => entry.document === "retained-owner-document",
				)?.deleted,
			).toBe(true)
		}),
	))

test("invitation links round-trip and reject malformed fragments", async () => {
	let secret = await run(invitationSecret)
	let link = invitationLink("https://alkalye.test/", {
		kind: "document",
		target: "doc-1",
		invitation: "invite-1",
		secret,
	})
	expect(link).toBe(
		"https://alkalye.test/invite#/doc/doc-1/invite/invite-1/" + secret,
	)
	expect(parseInvitationLink(new URL(link).hash)).toEqual({
		kind: "document",
		target: "doc-1",
		invitation: "invite-1",
		secret,
	})
	for (let hash of [
		"#/doc/doc-1/invite/invite-1/short",
		"#/doc/doc 1/invite/invite-1/" + secret,
		"#/folder/doc-1/invite/invite-1/" + secret,
		"#/doc/%E0%A4%A/invite/invite-1/" + secret,
		"#/space/w/invite/i/" + secret + "/extra",
	])
		expect(parseInvitationLink(hash)).toBeUndefined()
})

test("a document link grants its role until revocation removes everyone who joined through it", () =>
	run(
		Effect.gen(function* () {
			let owner = yield* client(11)
			let writer = yield* client(12)
			let reader = yield* client(13)
			let stranger = yield* client(14)
			yield* createWorkspace(owner, "invite-space")
			yield* createDocument(owner, "invite-space", "invite-doc")
			let writing = yield* invite(owner, { document: "invite-doc" }, "writer")
			let reading = yield* invite(owner, { document: "invite-doc" }, "reader")
			expect(
				yield* writer.api.invitations.describe({
					params: { invitation: writing.invitation },
					payload: { secret: writing.secret },
				}),
			).toEqual({
				kind: "document",
				title: "Shared plan",
				role: "writer",
				owner: "Anonymous writer",
			})
			expect(yield* accept(writer, writing, "writer-joins")).toEqual({
				workspace: "invite-space",
				document: "invite-doc",
				role: "writer",
			})
			yield* accept(reader, reading, "reader-joins")
			expect(yield* roles(writer)).toEqual([["invite-doc", "writer"]])
			expect(yield* roles(reader)).toEqual([["invite-doc", "reader"]])
			expect((yield* writer.api.workspaces.library()).workspaces).toEqual([])
			yield* edit(writer, "invite-doc", "Writer addition")
			expect(
				yield* failure(edit(reader, "invite-doc", "Reader addition")),
			).toBe("PermissionDenied")
			expect(
				yield* failure(
					writer.api.invitations.list({ query: { document: "invite-doc" } }),
				),
			).toBe("PermissionDenied")
			expect(
				yield* failure(
					writer.api.invitations.revoke({
						params: { invitation: reading.invitation },
					}),
				),
			).toBe("PermissionDenied")
			expect(
				yield* failure(invite(writer, { document: "invite-doc" }, "writer")),
			).toBe("PermissionDenied")
			let listed = yield* owner.api.invitations.list({
				query: { document: "invite-doc" },
			})
			expect(
				listed.map(entry => [
					entry.role,
					entry.members.map(member => member.member),
				]),
			).toEqual([
				["writer", [writer.subject]],
				["reader", [reader.subject]],
			])
			expect(yield* accept(stranger, writing, "stranger-joins")).toMatchObject({
				role: "writer",
			})
			yield* owner.api.invitations.revoke({
				params: { invitation: writing.invitation },
			})
			yield* owner.api.invitations.revoke({
				params: { invitation: writing.invitation },
			})
			expect(yield* roles(writer)).toEqual([])
			expect(yield* roles(stranger)).toEqual([])
			expect(yield* roles(reader)).toEqual([["invite-doc", "reader"]])
			expect(
				yield* failure(
					writer.api.documents.snapshot({ params: { document: "invite-doc" } }),
				),
			).toBe("ResourceUnavailable")
			expect(
				yield* failure(edit(writer, "invite-doc", "After revocation")),
			).not.toBe("Success")
			expect(yield* failure(accept(writer, writing, "writer-again"))).toBe(
				"InvitationRevoked",
			)
			expect(
				yield* failure(
					stranger.api.invitations.describe({
						params: { invitation: writing.invitation },
						payload: { secret: writing.secret },
					}),
				),
			).toBe("InvitationRevoked")
			expect(
				(yield* owner.api.invitations.list({
					query: { document: "invite-doc" },
				})).map(entry => entry.role),
			).toEqual(["reader"])
		}),
	))

test("wrong secrets look like unknown invitations and secrets are never stored", () =>
	run(
		Effect.gen(function* () {
			let owner = yield* client(21)
			let guest = yield* client(22)
			yield* createWorkspace(owner, "secret-space")
			yield* createDocument(owner, "secret-space", "secret-doc")
			let link = yield* invite(owner, { document: "secret-doc" }, "reader")
			let other = yield* invitationSecret
			for (let attempt of [
				{ invitation: link.invitation, secret: other },
				{ invitation: "missing-invitation", secret: link.secret },
			]) {
				expect(
					yield* failure(
						guest.api.invitations.describe({
							params: { invitation: attempt.invitation },
							payload: { secret: attempt.secret },
						}),
					),
				).toBe("ResourceUnavailable")
				expect(
					yield* failure(accept(guest, attempt, "guess-" + attempt.invitation)),
				).toBe("ResourceUnavailable")
			}
			expect(yield* roles(guest)).toEqual([])
			let files = yield* Effect.promise(() => readdir(directory))
			for (let file of files) {
				let bytes = yield* Effect.promise(() =>
					Bun.file(join(directory, file)).bytes(),
				)
				expect(Buffer.from(bytes).includes(link.secret)).toBe(false)
			}
		}),
	))

test("workspace links combine with direct membership and only the owner may manage them", () =>
	run(
		Effect.gen(function* () {
			let owner = yield* client(31)
			let member = yield* client(32)
			let outsider = yield* client(33)
			yield* createWorkspace(owner, "team-space")
			yield* createDocument(owner, "team-space", "team-doc")
			yield* owner.api.workspaces.membership({
				params: { workspace: "team-space", member: member.subject },
				payload: { role: "reader", request: "direct-reader" },
			})
			let link = yield* invite(owner, { workspace: "team-space" }, "writer")
			expect(
				yield* member.api.invitations.describe({
					params: { invitation: link.invitation },
					payload: { secret: link.secret },
				}),
			).toMatchObject({ kind: "workspace", title: "team-space" })
			yield* accept(member, link, "member-joins")
			let library = yield* member.api.workspaces.library()
			expect(library.workspaces.map(space => space.role)).toEqual(["writer"])
			expect(yield* roles(member)).toEqual([["team-doc", "writer"]])
			yield* createDocument(member, "team-space", "member-doc")
			expect(
				yield* failure(invite(member, { workspace: "team-space" }, "reader")),
			).toBe("PermissionDenied")
			expect(
				yield* failure(invite(outsider, { workspace: "team-space" }, "reader")),
			).toBe("ResourceUnavailable")
			expect(
				yield* failure(invite(outsider, { document: "team-doc" }, "reader")),
			).toBe("ResourceUnavailable")
			yield* owner.api.invitations.revoke({
				params: { invitation: link.invitation },
			})
			let after = yield* member.api.workspaces.library()
			expect(after.workspaces.map(space => space.role)).toEqual(["reader"])
			expect(
				after.documents.map(entry => [entry.document, entry.role]).sort(),
			).toEqual([
				["member-doc", "reader"],
				["team-doc", "reader"],
			])
			expect(yield* failure(accept(owner, link, "owner-revoked"))).toBe(
				"InvitationRevoked",
			)
		}),
	))

test("members can leave, owners can remove them and the same link can be accepted again", () =>
	run(
		Effect.gen(function* () {
			let owner = yield* client(41)
			let guest = yield* client(42)
			let other = yield* client(43)
			yield* createWorkspace(owner, "leave-space")
			yield* createDocument(owner, "leave-space", "leave-doc")
			let link = yield* invite(owner, { document: "leave-doc" }, "writer")
			yield* accept(guest, link, "guest-first")
			yield* accept(guest, link, "guest-first")
			yield* accept(other, link, "other-first")
			expect(
				yield* failure(
					guest.api.invitations.leave({
						params: { invitation: link.invitation, member: other.subject },
						payload: { request: "guest-removes-other" },
					}),
				),
			).toBe("PermissionDenied")
			yield* guest.api.invitations.leave({
				params: { invitation: link.invitation, member: guest.subject },
				payload: { request: "guest-leaves" },
			})
			expect(yield* roles(guest)).toEqual([])
			yield* owner.api.invitations.leave({
				params: { invitation: link.invitation, member: other.subject },
				payload: { request: "owner-removes-other" },
			})
			expect(yield* roles(other)).toEqual([])
			yield* accept(guest, link, "guest-second")
			expect(yield* roles(guest)).toEqual([["leave-doc", "writer"]])
			expect(
				yield* accept(owner, link, "owner-follows-own-link"),
			).toMatchObject({ document: "leave-doc" })
			expect(
				(yield* owner.api.invitations.list({
					query: { document: "leave-doc" },
				}))[0]?.members.map(member => member.member),
			).toEqual([guest.subject])
			expect(
				yield* failure(
					invite(owner, { document: "leave-doc" }, "reader", link.invitation),
				),
			).toBe("DocumentConflict")
		}),
	))

test("concurrent acceptance and revocation never leave access through a revoked link", () =>
	run(
		Effect.gen(function* () {
			let owner = yield* client(51)
			yield* createWorkspace(owner, "race-space")
			yield* createDocument(owner, "race-space", "race-doc")
			let guests = yield* Effect.forEach(
				Array.from({ length: 10 }, (_value, index) => 60 + index),
				seed => client(seed),
			)
			let link = yield* invite(owner, { document: "race-doc" }, "writer")
			let outcomes = yield* Effect.all(
				[
					...guests.map(guest =>
						failure(accept(guest, link, "race-" + guest.subject)),
					),
					owner.api.invitations
						.revoke({ params: { invitation: link.invitation } })
						.pipe(Effect.as("Revoked")),
				],
				{ concurrency: "unbounded" },
			)
			expect(outcomes.at(-1)).toBe("Revoked")
			expect(
				outcomes
					.slice(0, -1)
					.every(
						outcome => outcome === "Success" || outcome === "InvitationRevoked",
					),
			).toBe(true)
			for (let guest of guests) expect(yield* roles(guest)).toEqual([])
			let repeated = yield* Effect.all(
				[1, 2, 3].map(() =>
					failure(accept(guests[0] ?? owner, link, "late-accept")),
				),
				{ concurrency: "unbounded" },
			)
			expect(repeated).toEqual([
				"InvitationRevoked",
				"InvitationRevoked",
				"InvitationRevoked",
			])
			let fresh = yield* invite(owner, { document: "race-doc" }, "reader")
			let duplicate = yield* Effect.all(
				[1, 2, 3, 4].map(() =>
					accept(guests[1] ?? owner, fresh, "same-request"),
				),
				{ concurrency: "unbounded" },
			)
			expect(new Set(duplicate.map(value => value.role))).toEqual(
				new Set(["reader"]),
			)
			expect(yield* roles(guests[1] ?? owner)).toEqual([["race-doc", "reader"]])
		}),
	))

test("owners move documents between workspaces with their history and access follows", () =>
	run(
		Effect.gen(function* () {
			let owner = yield* client(91)
			let member = yield* client(92)
			let stranger = yield* client(93)
			yield* createWorkspace(owner, "move-from")
			yield* createWorkspace(owner, "move-to")
			yield* createDocument(owner, "move-from", "moved-doc")
			yield* edit(owner, "moved-doc", "Before the move")
			yield* owner.api.workspaces.membership({
				params: { workspace: "move-to", member: member.subject },
				payload: { role: "reader", request: "reader-of-destination" },
			})
			expect(yield* roles(member)).toEqual([])
			let link = yield* invite(owner, { document: "moved-doc" }, "writer")
			yield* accept(stranger, link, "stranger-before-move")
			expect(
				yield* failure(
					member.api.documents.move({
						params: { document: "moved-doc" },
						payload: { workspace: "move-to", request: "member-move" },
					}),
				),
			).toBe("ResourceUnavailable")
			yield* owner.api.documents.move({
				params: { document: "moved-doc" },
				payload: { workspace: "move-to", request: "owner-move" },
			})
			yield* owner.api.documents.move({
				params: { document: "moved-doc" },
				payload: { workspace: "move-to", request: "owner-move" },
			})
			let library = yield* owner.api.workspaces.library()
			expect(
				library.documents.find(entry => entry.document === "moved-doc")
					?.workspace,
			).toBe("move-to")
			expect(yield* roles(member)).toEqual([["moved-doc", "reader"]])
			expect(yield* roles(stranger)).toEqual([["moved-doc", "writer"]])
			expect(
				(yield* owner.api.invitations.list({
					query: { document: "moved-doc" },
				})).length,
			).toBe(1)
			let history = yield* owner.api.documents.history({
				params: { document: "moved-doc" },
				query: {},
			})
			expect(history.map(entry => entry.action.label)).toEqual([
				"Create document",
				"Edit",
			])
			expect(
				yield* failure(
					stranger.api.documents.move({
						params: { document: "moved-doc" },
						payload: { workspace: "move-from", request: "stranger-move" },
					}),
				),
			).toBe("PermissionDenied")
		}),
	))

test("collaborators leave every link they joined and only owners delete documents", () =>
	run(
		Effect.gen(function* () {
			let owner = yield* client(94)
			let guest = yield* client(95)
			yield* createWorkspace(owner, "leave-all")
			yield* createDocument(owner, "leave-all", "leave-all-doc")
			let first = yield* invite(owner, { document: "leave-all-doc" }, "writer")
			let second = yield* invite(owner, { document: "leave-all-doc" }, "reader")
			yield* accept(guest, first, "guest-first-link")
			yield* accept(guest, second, "guest-second-link")
			expect(
				yield* failure(remove(guest, "leave-all-doc", "Guest deletion")),
			).toBe("PermissionDenied")
			expect(
				yield* guest.api.invitations.leaveTarget({
					payload: { target: { document: "leave-all-doc" }, request: "go" },
				}),
			).toBe(2)
			expect(yield* roles(guest)).toEqual([])
			expect(
				yield* guest.api.invitations.leaveTarget({
					payload: { target: { document: "leave-all-doc" }, request: "again" },
				}),
			).toBe(0)
			yield* remove(owner, "leave-all-doc", "Owner deletion")
			expect(
				(yield* owner.api.workspaces.library()).documents.find(
					entry => entry.document === "leave-all-doc",
				)?.deleted,
			).toBe(true)
		}),
	))

test("public links let any account read without listing or writing, until unpublished", () =>
	run(
		Effect.gen(function* () {
			let owner = yield* client(101)
			let writer = yield* client(102)
			let stranger = yield* client(103)
			yield* createWorkspace(owner, "public-space")
			yield* createDocument(owner, "public-space", "public-doc")
			expect(
				yield* failure(
					stranger.api.documents.snapshot({
						params: { document: "public-doc" },
					}),
				),
			).toBe("ResourceUnavailable")
			let link = yield* invite(owner, { document: "public-doc" }, "writer")
			yield* accept(writer, link, "writer-joins-public")
			expect(
				yield* failure(grant(writer, "public-doc", "public", "reader")),
			).toBe("PermissionDenied")
			expect(
				yield* failure(grant(owner, "public-doc", "public", "writer")),
			).toBe("DocumentConflict")
			yield* grant(owner, "public-doc", "public", "reader")
			let snapshot = yield* stranger.api.documents.snapshot({
				params: { document: "public-doc" },
			})
			expect(snapshot.document).toBe("public-doc")
			expect(yield* roles(stranger)).toEqual([])
			expect(
				yield* failure(edit(stranger, "public-doc", "Stranger edit")),
			).toBe("PermissionDenied")
			expect(yield* roles(writer)).toEqual([["public-doc", "writer"]])
			yield* grant(owner, "public-doc", "public", "")
			expect(
				yield* failure(
					stranger.api.documents.snapshot({
						params: { document: "public-doc" },
					}),
				),
			).toBe("ResourceUnavailable")
		}),
	))

test("library summaries carry wiki link targets for backlinks", () =>
	run(
		Effect.gen(function* () {
			let owner = yield* client(111)
			yield* createWorkspace(owner, "links-space")
			yield* createDocument(owner, "links-space", "links-target")
			yield* createDocument(owner, "links-space", "links-source")
			yield* edit(
				owner,
				"links-source",
				"See [[links-target|the plan]] and [[Shared plan]].",
			)
			let library = yield* owner.api.workspaces.library()
			expect(
				library.documents.find(entry => entry.document === "links-source")
					?.links,
			).toEqual(["links-target", "Shared plan"])
			expect(
				library.documents.find(entry => entry.document === "links-target")
					?.links,
			).toEqual([])
		}),
	))

test("invitation grants survive a server restart", async () => {
	let data = await mkdtemp(join(tmpdir(), "alkalye-invitation-restart-"))
	try {
		let first = await Effect.runPromise(
			startServer({ port: 0, data, build: false }),
		)
		let link = await run(
			Effect.gen(function* () {
				let owner = yield* client(81, first.server.url)
				let guest = yield* client(82, first.server.url)
				yield* createWorkspace(owner, "restart-space")
				yield* createDocument(owner, "restart-space", "restart-doc")
				let link = yield* invite(owner, { document: "restart-doc" }, "writer")
				yield* accept(guest, link, "guest-restart")
				return link
			}),
		)
		await Effect.runPromise(first.close())
		let second = await Effect.runPromise(
			startServer({ port: 0, data, build: false }),
		)
		try {
			await run(
				Effect.gen(function* () {
					let owner = yield* client(81, second.server.url)
					let guest = yield* client(82, second.server.url)
					expect(yield* roles(guest)).toEqual([["restart-doc", "writer"]])
					yield* owner.api.invitations.revoke({
						params: { invitation: link.invitation },
					})
					expect(yield* roles(guest)).toEqual([])
				}),
			)
		} finally {
			await Effect.runPromise(second.close())
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
function createWorkspace(owner: Client, workspace: string) {
	return owner.api.workspaces.create({
		payload: { workspace, name: workspace, request: "create-" + workspace },
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
	identity?: string,
) {
	return Effect.gen(function* () {
		let random = yield* Crypto.Crypto
		let invitation = identity ?? (yield* random.randomUUIDv4)
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
function accept(
	member: Client,
	link: { invitation: string; secret: string },
	request: string,
) {
	return member.api.invitations.accept({
		params: { invitation: link.invitation },
		payload: { secret: link.secret, request },
	})
}
function edit(member: Client, document: string, text: string) {
	return Effect.gen(function* () {
		let replica = yield* restoreSnapshot(
			yield* member.api.documents.snapshot({ params: { document } }),
			member.subject + "-" + text.replace(/\W+/g, "-").slice(0, 40),
		)
		let action = yield* buildAction(replica, document, "Edit", staged => [
			staged.edit(document, staged.text(document) + "\n" + text),
		])
		return yield* member.api.documents.commit({
			params: { document },
			payload: action,
		})
	})
}
function grant(member: Client, document: string, who: string, role: string) {
	return Effect.gen(function* () {
		let replica = yield* restoreSnapshot(
			yield* member.api.documents.snapshot({ params: { document } }),
			member.subject + "-grant-" + who + "-" + (role || "none"),
		)
		let action = yield* buildAction(replica, document, "Share", staged => [
			staged.set(document, "access:" + who, role),
		])
		return yield* member.api.documents.commit({
			params: { document },
			payload: action,
		})
	})
}
function remove(member: Client, document: string, label: string) {
	return Effect.gen(function* () {
		let replica = yield* restoreSnapshot(
			yield* member.api.documents.snapshot({ params: { document } }),
			member.subject + "-" + label.replaceAll(" ", "-"),
		)
		let action = yield* buildAction(replica, document, label, staged => [
			staged.set(document, "type", "deleted"),
		])
		return yield* member.api.documents.commit({
			params: { document },
			payload: action,
		})
	})
}
function roles(member: Client) {
	return member.api.workspaces
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
function run<A, E>(
	task: Effect.Effect<A, E, HttpClient.HttpClient | Signatures | Crypto.Crypto>,
) {
	return Effect.runPromise(
		task.pipe(
			Effect.provide(FetchHttpClient.layer),
			Effect.provide(Signatures.layer),
			Effect.provide(webCryptoLayer),
		),
	)
}

test("workspace snapshots include named invite members and effective grant sources", () =>
	run(
		Effect.gen(function* () {
			let owner = yield* client(91)
			let member = yield* client(92)
			yield* owner.api.preferences.save({
				payload: { request: "owner-profile", patch: { name: "Harbour owner" } },
			})
			yield* member.api.preferences.save({
				payload: {
					request: "member-profile",
					patch: { name: "Invited writer" },
				},
			})
			yield* createWorkspace(owner, "named-team")
			let link = yield* invite(owner, { workspace: "named-team" }, "writer")
			yield* accept(member, link, "join-named-team")
			let snapshot = yield* owner.api.workspaces.snapshot({
				params: { workspace: "named-team" },
			})
			expect(snapshot.ownerName).toBe("Harbour owner")
			expect(snapshot.members).toEqual([
				{
					member: member.subject,
					role: "writer",
					name: "Invited writer",
					source: "invitation",
				},
			])
			yield* owner.api.workspaces.membership({
				params: { workspace: "named-team", member: member.subject },
				payload: { role: "reader", request: "named-direct-reader" },
			})
			expect(
				(yield* owner.api.workspaces.snapshot({
					params: { workspace: "named-team" },
				})).members[0],
			).toMatchObject({ role: "writer", source: "both" })
			yield* owner.api.invitations.revoke({
				params: { invitation: link.invitation },
			})
			expect(
				(yield* owner.api.workspaces.snapshot({
					params: { workspace: "named-team" },
				})).members[0],
			).toMatchObject({
				role: "reader",
				source: "direct",
				name: "Invited writer",
			})
			yield* member.api.preferences.save({
				payload: {
					request: "renamed-member",
					patch: { name: "Renamed writer" },
				},
			})
			expect(
				(yield* owner.api.workspaces.snapshot({
					params: { workspace: "named-team" },
				})).members[0]?.name,
			).toBe("Renamed writer")
		}),
	))
