import { Database } from "bun:sqlite"
import { profile } from "bun:jsc"
import { afterAll, beforeAll, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type * as Crypto from "effect/Crypto"
import * as Effect from "effect/Effect"
import * as Context from "effect/Context"
import * as Layer from "effect/Layer"
import * as Queue from "effect/Queue"
import { cliDocumentSessionLayer } from "../src/cli/document-platform"
import { performanceFixture } from "../experiments/performance/fixture"
import { DocumentSession } from "../src/shared/document-session"
import type { DocumentTransport } from "../src/shared/document-session"
import * as Redacted from "effect/Redacted"
import * as HttpApiClient from "effect/http-api/HttpApiClient"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import { Signatures } from "../src/platform/signatures"
import { webCryptoLayer } from "../src/platform/web-crypto"
import { startServer } from "../src/server/index"
import { encode } from "../src/shared/base64"
import { object, parsePresence } from "../src/shared/model"
import {
	nextMove,
	presentationLeader,
	maximumPresentationSkew,
} from "../src/shared/presentation-follow"
import { Replica } from "../src/shared/crdt"
import { buildAction, restoreSnapshot } from "../src/shared/document-actions"
import { DocumentApi } from "../src/shared/document-api"
import { invitationDigest, invitationSecret } from "../src/shared/invitations"
import { newDocument } from "../src/shared/documents"
import { cookieLogin, liveSocket, livePoll } from "./live-fixture"
import type { LiveMessage } from "./live-fixture"

let wait = 400
let directory = await mkdtemp(join(tmpdir(), "alkalye-live-poll-"))
let instance: Effect.Success<ReturnType<typeof startServer>>
beforeAll(async () => {
	instance = await Effect.runPromise(
		startServer({ port: 0, data: directory, build: false, livePollWait: wait }),
	)
})
afterAll(async () => {
	await Effect.runPromise(instance.close())
	await rm(directory, { recursive: true, force: true })
})

test("polling and WebSocket peers share notifications, presence and departures", async () => {
	let owner = await run(client(51))
	let reader = await run(client(52))
	await run(
		Effect.gen(function* () {
			yield* createWorkspace(owner, "mixed", "Mixed")
			yield* createDocument(owner, "mixed", "mixed-doc")
			yield* member(owner, "mixed", reader, "reader")
		}),
	)
	let polling = livePoll(await cookieLogin(instance.server.url, 52))
	await polling.open()
	let connected = await polling.until(message => message.type === "connected")
	expect(await polling.send([{ type: "watch", document: "mixed-doc" }])).toBe(
		204,
	)
	let socket = await liveSocket(await cookieLogin(instance.server.url, 51))
	try {
		let socketActor = (await socket.until(is("connected"))).actor
		socket.send({ type: "watch", document: "mixed-doc" })
		socket.send({ type: "presence", presence: cursor("mixed-doc", 3) })
		let seen = await polling.until(is("presence"))
		expect(seen.presence).toMatchObject({
			actor: socketActor,
			document: "mixed-doc",
			cursor: 3,
			x: 10,
			own: false,
		})

		expect(
			await polling.send([
				{ type: "presence", presence: cursor("mixed-doc", 7) },
			]),
		).toBe(204)
		let readerPresence = await socket.until(is("presence"))
		// The reader's pointer is withheld exactly as it is over WebSockets.
		expect(readerPresence.presence).toMatchObject({
			actor: connected.actor,
			cursor: 7,
			x: -1,
			y: -1,
			presenting: false,
			own: false,
		})

		await run(edit(owner, "mixed-doc", "Polled change"))
		await polling.until(is("advanced"))
		await socket.until(is("advanced"))

		socket.close()
		let gone = await polling.until(is("gone"))
		expect(gone).toEqual({
			type: "gone",
			document: "mixed-doc",
			actor: socketActor,
		})
	} finally {
		socket.close()
		await polling.close()
	}
})

test("profile edits invalidate shared labels without disclosing another account's preferences", async () => {
	let owner = await run(client(83))
	let shared = await run(client(84))
	let stranger = await run(client(85))
	await run(createWorkspace(owner, "profile-shared", "Shared profiles"))
	await run(member(owner, "profile-shared", shared, "reader"))
	let unrelated = livePoll(await cookieLogin(instance.server.url, 85))
	await unrelated.open()
	await unrelated.until(is("connected"))
	let polling = livePoll(await cookieLogin(instance.server.url, 83))
	await polling.open()
	await polling.until(is("connected"))
	let socket = await liveSocket(await cookieLogin(instance.server.url, 83))
	try {
		await socket.until(is("connected"))
		let before = await run(owner.api.preferences.get())
		await run(
			shared.api.preferences.save({
				payload: {
					request: "private-profile-name",
					patch: { name: "Private name", appearance: "dark" },
				},
			}),
		)
		expect(await polling.until(is("advanced"))).toEqual({ type: "advanced" })
		expect(await socket.until(is("advanced"))).toEqual({ type: "advanced" })
		expect(await unrelated.poll()).toEqual([])
		await run(
			stranger.api.preferences.save({
				payload: { request: "unrelated-profile", patch: { name: "Unrelated" } },
			}),
		)
		expect(await polling.poll()).toEqual([])
		await run(
			shared.api.preferences.save({
				payload: {
					request: "private-only-pref",
					patch: { appearance: "light" },
				},
			}),
		)
		expect(await polling.poll()).toEqual([])
		expect(await run(owner.api.preferences.get())).toEqual(before)
		expect(polling.inbox.some(message => message.type === "preferences")).toBe(
			false,
		)
	} finally {
		socket.close()
		await polling.close()
		await unrelated.close()
	}
})

test("document and workspace changes wake shared libraries but leave unrelated peers asleep", async () => {
	let owner = await run(client(91))
	let shared = await run(client(92))
	await run(createWorkspace(owner, "scoped-live", "Scoped"))
	await run(createDocument(owner, "scoped-live", "scoped-document"))
	await run(member(owner, "scoped-live", shared, "reader"))
	let library = livePoll(await cookieLogin(instance.server.url, 92))
	let stranger = livePoll(await cookieLogin(instance.server.url, 93))
	let socket = await liveSocket(await cookieLogin(instance.server.url, 93))
	try {
		await socket.until(is("connected"))
		for (let peer of [library, stranger]) {
			await peer.open()
			await peer.until(is("connected"))
		}
		await run(edit(owner, "scoped-document", "Only shared clients"))
		expect(await library.until(is("advanced"))).toEqual({ type: "advanced" })
		expect(await stranger.poll()).toEqual([])
		await run(
			owner.api.workspaces.rename({
				params: { workspace: "scoped-live" },
				payload: { name: "Renamed", request: "rename-scoped" },
			}),
		)
		expect(await library.until(is("advanced"))).toEqual({ type: "advanced" })
		expect(await stranger.poll()).toEqual([])
		await run(
			owner.api.workspaces.membership({
				params: { workspace: "scoped-live", member: shared.subject },
				payload: { role: null, request: "remove-scoped-member" },
			}),
		)
		expect(await library.until(is("advanced"))).toEqual({ type: "advanced" })
		expect(await stranger.poll()).toEqual([])
		await run(edit(owner, "scoped-document", "Former member excluded"))
		expect(await library.poll()).toEqual([])
		expect(await stranger.poll()).toEqual([])
		expect(
			socket.inbox.filter(message => message.type !== "heartbeat"),
		).toEqual([])
	} finally {
		socket.close()
		await library.close()
		await stranger.close()
	}
})

test("a failed postcommit recipient read preserves the durable write and only wakes its watchers", async () => {
	let owner = await run(client(101))
	await run(
		createWorkspace(owner, "notification-failure", "Notification failure"),
	)
	await run(
		createDocument(owner, "notification-failure", "notification-failure-doc"),
	)
	let replica = await run(
		restoreSnapshot(
			await run(
				owner.api.documents.snapshot({
					params: { document: "notification-failure-doc" },
					query: {},
				}),
			),
			owner.subject + "-notification-failure",
		),
	)
	let action = await run(
		buildAction(
			replica,
			"notification-failure-doc",
			"Durable notification failure",
			staged => [
				staged.edit(
					"notification-failure-doc",
					staged.text("notification-failure-doc") +
						"\nDurable despite failed notification",
				),
			],
		),
	)
	let watcher = livePoll(await cookieLogin(instance.server.url, 101)),
		stranger = livePoll(await cookieLogin(instance.server.url, 102))
	let database = new Database(join(directory, "documents.sqlite"))
	let view = database
		.query<{ sql: string }, []>(
			"SELECT sql FROM sqlite_schema WHERE name='document_grants'",
		)
		.get()
	if (!view) throw new Error("Missing document grants view")
	try {
		for (let peer of [watcher, stranger]) {
			await peer.open()
			await peer.until(is("connected"))
		}
		expect(
			await watcher.send([
				{ type: "watch", document: "notification-failure-doc" },
			]),
		).toBe(204)
		database.run("DROP VIEW document_grants")
		let receipt = await run(
			owner.api.documents.commit({
				params: { document: "notification-failure-doc" },
				payload: action,
			}),
		)
		expect(await watcher.until(is("advanced"))).toEqual({ type: "advanced" })
		expect(await stranger.poll()).toEqual([])
		database.run(view.sql)
		expect(
			await run(
				owner.api.documents.commit({
					params: { document: "notification-failure-doc" },
					payload: action,
				}),
			),
		).toEqual(receipt)
		let saved = await run(
			restoreSnapshot(
				await run(
					owner.api.documents.snapshot({
						params: { document: "notification-failure-doc" },
						query: {},
					}),
				),
				"verify-failed-notification",
			),
		)
		expect(saved.text("notification-failure-doc")).toBe(
			replica.text("notification-failure-doc") +
				"\nDurable despite failed notification",
		)
	} finally {
		if (
			!database
				.query("SELECT name FROM sqlite_schema WHERE name='document_grants'")
				.get()
		)
			database.run(view.sql)
		database.close()
		await watcher.close()
		await stranger.close()
	}
})

test("accepted and revoked invitation members receive their library changes", async () => {
	let owner = await run(client(96)),
		joiner = await run(client(97))
	await run(createWorkspace(owner, "scoped-invite", "Invited"))
	await run(createDocument(owner, "scoped-invite", "invited-doc"))
	let link = await run(
		Effect.gen(function* () {
			let invitation = "scoped-invitation",
				secret = yield* invitationSecret
			yield* owner.api.invitations.create({
				payload: {
					invitation,
					target: { workspace: "scoped-invite" },
					role: "reader",
					digest: yield* invitationDigest(secret),
				},
			})
			return { invitation, secret }
		}),
	)
	let peer = livePoll(await cookieLogin(instance.server.url, 97))
	try {
		await peer.open()
		await peer.until(is("connected"))
		await run(
			joiner.api.invitations.accept({
				params: { invitation: link.invitation },
				payload: { secret: link.secret, request: "join-scoped" },
			}),
		)
		expect(await peer.until(is("advanced"))).toEqual({ type: "advanced" })
		expect(await peer.send([{ type: "watch", document: "invited-doc" }])).toBe(
			204,
		)
		await run(
			owner.api.invitations.revoke({ params: { invitation: link.invitation } }),
		)
		expect(await peer.until(is("unavailable"))).toEqual({
			type: "unavailable",
			document: "invited-doc",
		})
	} finally {
		await peer.close()
	}
})

test("moving a document wakes both libraries and retains its creator after workspace access ends", async () => {
	let host = await run(client(98)),
		creator = await run(client(99)),
		reader = await run(client(100))
	await run(createWorkspace(creator, "scoped-source", "Source"))
	await run(createWorkspace(host, "scoped-target", "Target"))
	await run(member(host, "scoped-target", creator, "writer"))
	await run(member(creator, "scoped-source", reader, "reader"))
	await run(createDocument(creator, "scoped-source", "moved-scoped-doc"))
	let author = livePoll(await cookieLogin(instance.server.url, 99)),
		former = livePoll(await cookieLogin(instance.server.url, 100))
	try {
		for (let peer of [author, former]) {
			await peer.open()
			await peer.until(is("connected"))
			expect(
				await peer.send([{ type: "watch", document: "moved-scoped-doc" }]),
			).toBe(204)
		}
		await run(
			creator.api.documents.move({
				params: { document: "moved-scoped-doc" },
				payload: { workspace: "scoped-target", request: "move-scoped" },
			}),
		)
		expect(await author.until(is("advanced"))).toEqual({ type: "advanced" })
		expect(await former.until(is("unavailable"))).toEqual({
			type: "unavailable",
			document: "moved-scoped-doc",
		})
		await run(
			host.api.workspaces.membership({
				params: { workspace: "scoped-target", member: creator.subject },
				payload: { role: null, request: "revoke-moved-creator" },
			}),
		)
		expect(await author.until(is("advanced"))).toEqual({ type: "advanced" })
		await run(edit(host, "moved-scoped-doc", "Original creator still notified"))
		expect(await author.until(is("advanced"))).toEqual({ type: "advanced" })
		expect(author.inbox.some(is("unavailable"))).toBe(false)
	} finally {
		await author.close()
		await former.close()
	}
})

test("public document watchers receive advances and lose access on workspace deletion", async () => {
	let owner = await run(client(94))
	await run(createWorkspace(owner, "public-scoped", "Public scoped"))
	await run(createDocument(owner, "public-scoped", "public-scoped-doc"))
	await run(grant(owner, "public-scoped-doc", "public", "reader"))
	let reader = livePoll(await cookieLogin(instance.server.url, 95))
	try {
		await reader.open()
		await reader.until(is("connected"))
		expect(
			await reader.send([{ type: "watch", document: "public-scoped-doc" }]),
		).toBe(204)
		await run(edit(owner, "public-scoped-doc", "Public update"))
		expect(await reader.until(is("advanced"))).toEqual({ type: "advanced" })
		await run(
			owner.api.workspaces.remove({
				params: { workspace: "public-scoped" },
				payload: { request: "delete-public-scoped", name: "Public scoped" },
			}),
		)
		expect(await reader.until(is("unavailable"))).toEqual({
			type: "unavailable",
			document: "public-scoped-doc",
		})
	} finally {
		await reader.close()
	}
})

test("real polling presenters converge on ties and clock skew while readers cannot present", async () => {
	let owner = await run(client(71))
	let writer = await run(client(72))
	let reader = await run(client(73))
	await run(
		Effect.gen(function* () {
			yield* createWorkspace(owner, "presenters", "Presenters")
			yield* createDocument(owner, "presenters", "presented-doc")
			yield* member(owner, "presenters", writer, "writer")
			yield* member(owner, "presenters", reader, "reader")
		}),
	)
	let first = livePoll(await cookieLogin(instance.server.url, 71))
	let second = livePoll(await cookieLogin(instance.server.url, 72))
	let audience = livePoll(await cookieLogin(instance.server.url, 73))
	try {
		for (let peer of [first, second, audience]) {
			await peer.open()
			await peer.until(is("connected"))
			expect(
				await peer.send([{ type: "watch", document: "presented-doc" }]),
			).toBe(204)
		}
		let now = Date.now()
		function move(slide: number, movedAt: number) {
			return {
				type: "presence",
				presence: {
					...cursor("presented-doc", 0),
					slide,
					movedAt,
					own: true,
					target: "audience-screen",
				},
			}
		}
		expect(await first.send([move(1, now)])).toBe(204)
		expect(await second.send([move(2, now)])).toBe(204)
		let a = parsePresence(
			(
				await second.until(
					message =>
						message.type === "presence" && object(message.presence).slide === 1,
				)
			).presence,
		)
		let b = parsePresence(
			(
				await first.until(
					message =>
						message.type === "presence" && object(message.presence).slide === 2,
				)
			).presence,
		)
		expect(a.actor).not.toBe(b.actor)
		let leader = presentationLeader([a, b], "presented-doc", Date.now())
		expect(leader?.actor).toBe([a.actor, b.actor].sort().at(-1))
		expect(presentationLeader([b, a], "presented-doc", Date.now())?.actor).toBe(
			leader?.actor,
		)
		expect(a.own).toBe(false)
		expect(b.own).toBe(false)
		// The relay intentionally accepts at most one move per 40ms window.
		await Bun.sleep(Math.max(0, a.time + 40 - Date.now()))
		let reply = nextMove(now - 2000, [a, b])
		expect(await first.send([move(3, reply)])).toBe(204)
		let advanced = parsePresence(
			(
				await second.until(
					message =>
						message.type === "presence" && object(message.presence).slide === 3,
				)
			).presence,
		)
		expect(
			presentationLeader([b, advanced], "presented-doc", Date.now())?.slide,
		).toBe(3)
		await Bun.sleep(Math.max(0, advanced.time + 40 - Date.now()))
		expect(await first.send([move(4, Number.MAX_SAFE_INTEGER)])).toBe(204)
		let bounded = parsePresence(
			(
				await second.until(
					message =>
						message.type === "presence" && object(message.presence).slide === 4,
				)
			).presence,
		)
		expect(bounded.movedAt).toBeLessThanOrEqual(
			Date.now() + maximumPresentationSkew,
		)
		expect(await audience.send([move(5, now + 1)])).toBe(204)
		let refused = parsePresence(
			(
				await first.until(
					message =>
						message.type === "presence" && object(message.presence).slide === 5,
				)
			).presence,
		)
		expect(refused.presenting).toBe(false)
		expect(refused.movedAt).toBeUndefined()
		expect(refused.target).toBeUndefined()
		expect(refused.x).toBe(-1)
		expect(
			presentationLeader([refused], "presented-doc", Date.now()),
		).toBeUndefined()
	} finally {
		for (let peer of [first, second, audience]) await peer.close()
	}
})

test("two polling peers see each other and a closed session announces departure", async () => {
	let owner = await run(client(53))
	await run(
		Effect.gen(function* () {
			yield* createWorkspace(owner, "polled", "Polled")
			yield* createDocument(owner, "polled", "polled-doc")
		}),
	)
	let first = livePoll(await cookieLogin(instance.server.url, 53))
	let second = livePoll(await cookieLogin(instance.server.url, 53))
	await first.open()
	await second.open()
	let firstActor = (await first.until(is("connected"))).actor
	await first.send([{ type: "watch", document: "polled-doc" }])
	await second.send([
		{ type: "watch", document: "polled-doc" },
		{ type: "presence", presence: cursor("polled-doc", 1) },
		{ type: "presence", presence: cursor("polled-doc", 2) },
	])
	let presence = await first.until(is("presence"))
	// The same account on another device is told it is its own.
	expect(presence.presence).toMatchObject({ cursor: 1, own: true })
	await first.send([{ type: "presence", presence: cursor("polled-doc", 4) }])
	expect((await second.until(is("presence"))).presence).toMatchObject({
		actor: firstActor,
		cursor: 4,
		own: true,
	})
	let before = instance.liveSessions()
	expect(await first.close()).toBe(204)
	expect(instance.liveSessions()).toBe(before - 1)
	expect(await second.until(is("gone"))).toMatchObject({ actor: firstActor })
	expect(await first.poll()).toBe(410)
	expect(await first.send([])).toBe(410)
	await second.close()
})

test("revoked access withholds presence already queued for a polling reader", async () => {
	let owner = await run(client(54))
	let guest = await run(client(55))
	await run(
		Effect.gen(function* () {
			yield* createWorkspace(owner, "private", "Private")
			yield* createDocument(owner, "private", "private-doc")
			yield* grant(owner, "private-doc", guest.subject, "reader")
		}),
	)
	let host = livePoll(await cookieLogin(instance.server.url, 54))
	let visitor = livePoll(await cookieLogin(instance.server.url, 55))
	await host.open()
	await visitor.open()
	await visitor.until(is("connected"))
	await visitor.send([{ type: "watch", document: "private-doc" }])
	await host.send([{ type: "watch", document: "private-doc" }])
	// The visitor does not poll, so this presence waits in its queue.
	await host.send([{ type: "presence", presence: cursor("private-doc", 9) }])
	await run(grant(owner, "private-doc", guest.subject, ""))
	await visitor.until(
		message =>
			message.type === "unavailable" && message.document === "private-doc",
	)
	await Bun.sleep(50)
	await host.send([{ type: "presence", presence: cursor("private-doc", 11) }])
	await visitor.poll()
	expect(visitor.inbox.filter(is("presence"))).toEqual([])
	await visitor.send([{ type: "watch", document: "private-doc" }])
	await visitor.until(
		message =>
			message.type === "unavailable" && message.document === "private-doc",
	)
	await host.close()
	await visitor.close()
})

test("logging out during a pending poll prevents delivery and closes its session", async () => {
	let login = await cookieLogin(instance.server.url, 61)
	let polling = livePoll(login)
	await polling.open()
	await polling.until(is("connected"))
	let before = instance.liveSessions()
	let pending = polling.poll()
	await Bun.sleep(50)
	let logout = await fetch(
		new URL("/api/accounts/session", instance.server.url),
		{
			method: "DELETE",
			headers: { origin: instance.server.url.origin, cookie: login.cookie },
		},
	)
	expect(logout.ok).toBe(true)
	expect(await pending).toBe(401)
	expect(instance.liveSessions()).toBe(before - 1)
})

test("demotion strips presenter privileges from queued and replayed presence", async () => {
	let owner = await run(client(62))
	let writer = await run(client(63))
	await run(
		Effect.gen(function* () {
			yield* createWorkspace(owner, "demotion", "Demotion")
			yield* createDocument(owner, "demotion", "demotion-doc")
			yield* member(owner, "demotion", writer, "writer")
		}),
	)
	let observer = livePoll(await cookieLogin(instance.server.url, 62))
	let presenter = livePoll(await cookieLogin(instance.server.url, 63))
	await observer.open()
	await presenter.open()
	await observer.until(is("connected"))
	await observer.send([{ type: "watch", document: "demotion-doc" }])
	await presenter.send([
		{ type: "watch", document: "demotion-doc" },
		{
			type: "presence",
			presence: {
				...cursor("demotion-doc", 4),
				target: "audience",
				movedAt: Date.now(),
			},
		},
	])
	await run(
		owner.api.workspaces.membership({
			params: { workspace: "demotion", member: writer.subject },
			payload: { role: "reader", request: "demote-presenter" },
		}),
	)
	let queued = await observer.until(is("presence"))
	expect(queued.presence).toMatchObject({ presenting: false, x: -1, y: -1 })
	expect(queued.presence).not.toHaveProperty("target")
	expect(queued.presence).not.toHaveProperty("movedAt")
	let newcomer = livePoll(await cookieLogin(instance.server.url, 62))
	await newcomer.open()
	await newcomer.send([{ type: "watch", document: "demotion-doc" }])
	let replayed = await newcomer.until(is("presence"))
	expect(replayed.presence).toMatchObject({ presenting: false, x: -1, y: -1 })
	expect(replayed.presence).not.toHaveProperty("target")
	await observer.close()
	await presenter.close()
	await newcomer.close()
})

test("one presence batch updates each watched document", async () => {
	let owner = await run(client(64))
	await run(
		Effect.gen(function* () {
			yield* createWorkspace(owner, "batch", "Batch")
			yield* createDocument(owner, "batch", "batch-one")
			yield* createDocument(owner, "batch", "batch-two")
		}),
	)
	let login = await cookieLogin(instance.server.url, 64)
	let observer = livePoll(login),
		presenter = livePoll(login)
	await observer.open()
	await presenter.open()
	let watches = ["batch-one", "batch-two"].map(document => ({
		type: "watch",
		document,
	}))
	await observer.send(watches)
	await presenter.send(watches)
	await presenter.send([
		{ type: "presence", presence: cursor("batch-one", 1) },
		{ type: "presence", presence: cursor("batch-two", 2) },
	])
	await observer.until(
		message =>
			message.type === "presence" &&
			object(message.presence).document === "batch-one",
	)
	let second = await observer.until(
		message =>
			message.type === "presence" &&
			object(message.presence).document === "batch-two",
	)
	expect(second.presence).toMatchObject({ cursor: 2 })
	await observer.close()
	await presenter.close()
})

test("polling authenticates the cookie, account, origin and session owner", async () => {
	let login = await cookieLogin(instance.server.url, 56)
	let other = await cookieLogin(instance.server.url, 57)
	let polling = livePoll(login)
	await polling.open()
	let session = polling.session()
	let base = instance.server.url

	expect((await raw("/api/live/poll", { account: login.subject })).status).toBe(
		401,
	)
	expect(
		(
			await raw(
				"/api/live/poll",
				{ account: other.subject },
				{ cookie: login.cookie },
			)
		).status,
	).toBe(409)
	expect(
		(
			await raw(
				"/api/live/poll",
				{ account: login.subject },
				{ cookie: login.cookie, origin: "https://unrelated.example" },
			)
		).status,
	).toBe(403)
	expect(
		(
			await fetch(new URL("/api/live/poll", base), {
				headers: { cookie: login.cookie },
			})
		).status,
	).toBe(403)
	// Another account cannot read or drive a session it learned the identifier of.
	expect(
		(
			await raw(
				"/api/live/poll",
				{ account: other.subject, session },
				{ cookie: other.cookie },
			)
		).status,
	).toBe(410)
	expect(
		(
			await raw(
				"/api/live/send",
				{
					account: other.subject,
					session,
					messages: [{ type: "watch", document: "anything" }],
				},
				{ cookie: other.cookie },
			)
		).status,
	).toBe(410)

	let logout = await fetch(new URL("/api/accounts/session", base), {
		method: "DELETE",
		headers: { origin: base.origin, cookie: login.cookie },
	})
	expect(logout.status).toBeLessThan(300)
	expect(await polling.poll()).toBe(401)
	expect(await polling.send([])).toBe(401)

	function raw(
		path: string,
		body: unknown,
		headers: Record<string, string> = {},
	) {
		return fetch(new URL(path, base), {
			method: "POST",
			headers: {
				origin: base.origin,
				"content-type": "application/json",
				...headers,
			},
			body: JSON.stringify(body),
		})
	}
})

test("polling bounds request size, message count, watched documents and sessions", async () => {
	let login = await cookieLogin(instance.server.url, 58)
	let polling = livePoll(login)
	await polling.open()
	let session = polling.session()
	let invalid = await polling.request("/api/live/send", "not an object")
	expect(invalid.status).toBe(400)
	let broken = await fetch(new URL("/api/live/send", login.base), {
		method: "POST",
		headers: { origin: login.base.origin, cookie: login.cookie },
		body: "{",
	})
	expect(broken.status).toBe(400)
	expect(await polling.send([{ type: "shout", document: "document" }])).toBe(
		400,
	)
	expect(
		await polling.send(
			Array.from({ length: 33 }, () => ({ type: "unwatch", document: "a" })),
		),
	).toBe(400)

	for (let presence of [
		{ ...cursor("malformed", 1), x: "NaN" },
		{ ...cursor("malformed", 1), cursor: -1 },
		{ ...cursor("malformed", 1), document: "../private" },
		{ ...cursor("malformed", 1), movedAt: "tomorrow" },
	])
		expect(await polling.send([{ type: "presence", presence }])).toBe(400)
	let huge = await polling.request("/api/live/send", {
		account: login.subject,
		session,
		messages: [],
		padding: "x".repeat(40_000),
	})
	expect(huge.status).toBe(413)
	expect(await polling.send([])).toBe(204)

	let owner = await run(client(58))
	await run(createWorkspace(owner, "many", "Many"))
	for (let index = 0; index < 33; index++)
		await run(createDocument(owner, "many", "many-" + index))
	let watches = Array.from({ length: 32 }, (_, index) => ({
		type: "watch",
		document: "many-" + index,
	}))
	expect(await polling.send(watches)).toBe(204)
	expect(await polling.send([{ type: "watch", document: "many-32" }])).toBe(410)
	expect(await polling.poll()).toBe(410)

	let sessions = []
	for (let index = 0; index < 32; index++) {
		let next = livePoll(login)
		await next.open()
		sessions.push(next)
	}
	let excess = await polling.request("/api/live/poll", {
		account: login.subject,
	})
	expect(excess.status).toBe(429)
	// A new tab cannot evict existing tabs and start a reconnect loop.
	for (let next of sessions) expect(await next.send([])).toBe(204)
	for (let next of sessions) await next.close()
})

test("aborted and superseded polls release their waiter and abandoned sessions expire", async () => {
	let polling = livePoll(await cookieLogin(instance.server.url, 59))
	await polling.open()
	await polling.until(is("connected"))
	let before = instance.liveSessions()

	let aborted = new AbortController()
	let pending = polling.poll(aborted.signal).catch(() => "aborted")
	await Bun.sleep(50)
	aborted.abort()
	expect(await pending).toBe("aborted")
	expect(await polling.poll()).toEqual([])

	let first = polling.poll()
	await Bun.sleep(50)
	let second = polling.poll()
	expect(await first).toEqual([])
	expect(await second).toEqual([])
	expect(instance.liveSessions()).toBe(before)

	let started = Date.now()
	while (instance.liveSessions() > 0 && Date.now() - started < 9000)
		await Bun.sleep(200)
	expect(instance.liveSessions()).toBe(0)
	expect(await polling.poll()).toBe(410)
}, 15_000)

test("a restarted server expires old sessions and a new session resynchronizes", async () => {
	let data = await mkdtemp(join(tmpdir(), "alkalye-live-restart-"))
	try {
		let first = await Effect.runPromise(
			startServer({ port: 0, data, build: false, livePollWait: wait }),
		)
		let login = await cookieLogin(first.server.url, 60)
		let polling = livePoll(login)
		await polling.open()
		await Effect.runPromise(first.close())
		let second = await Effect.runPromise(
			startServer({ port: 0, data, build: false, livePollWait: wait }),
		)
		try {
			let resumed = livePoll({ ...login, base: second.server.url })
			let stale = await resumed.request("/api/live/poll", {
				account: login.subject,
				session: polling.session(),
			})
			expect(stale.status).toBe(410)
			await resumed.open()
			expect(await resumed.until(is("connected"))).toMatchObject({
				type: "connected",
			})
			await resumed.close()
		} finally {
			await Effect.runPromise(second.close())
		}
	} finally {
		await rm(data, { recursive: true, force: true })
	}
})

async function sustainedSwarm() {
	let accounts = await Promise.all(
		Array.from({ length: 25 }, (_, index) => run(client(120 + index))),
	)
	let owner = accounts[0]
	let reader = accounts[24]
	if (!owner || !reader) throw Error("Missing swarm accounts")
	let writers = accounts.slice(0, 24)
	let document = "swarm-document"
	await run(
		Effect.gen(function* () {
			yield* createWorkspace(owner, "swarm-workspace", "Swarm")
			yield* createDocument(
				owner,
				"swarm-workspace",
				document,
				performanceFixture(8),
			)
			for (let account of writers.slice(1))
				yield* member(owner, "swarm-workspace", account, "writer")
			yield* member(owner, "swarm-workspace", reader, "reader")
		}),
	)
	let peers: {
		inbox: LiveMessage[]
		send(message: unknown): Promise<void>
		until(match: (message: LiveMessage) => boolean): Promise<LiveMessage>
		close(): Promise<void>
	}[] = []
	async function connect(index: number) {
		let login = await cookieLogin(instance.server.url, 120 + index)
		if (index % 2 === 0) {
			let socket = await liveSocket(login)
			return {
				inbox: socket.inbox,
				async send(message: unknown) {
					socket.send(message)
				},
				until: socket.until,
				async close() {
					socket.close()
				},
			}
		}
		let polling = livePoll(login)
		await polling.open()
		let messages = await Effect.runPromise(Queue.unbounded<LiveMessage>())
		let abort = new AbortController()
		let failure: unknown
		function collect() {
			for (let message of polling.inbox.splice(0))
				Queue.offerUnsafe(messages, message)
		}
		collect()
		let pump = (async () => {
			try {
				while (!abort.signal.aborted) {
					let response = await polling.poll(abort.signal)
					if (typeof response === "number")
						throw Error("Live poll failed: " + response)
					collect()
				}
			} catch (error) {
				if (!abort.signal.aborted) failure = error
			} finally {
				Queue.shutdownUnsafe(messages)
			}
		})()
		return {
			inbox: polling.inbox,
			async send(message: unknown) {
				if (failure) throw failure
				expect(await polling.send([message])).toBe(204)
			},
			async until(match: (message: LiveMessage) => boolean) {
				return Effect.runPromise(
					Effect.gen(function* () {
						while (true) {
							let message = yield* Queue.take(messages)
							if (match(message)) return message
						}
					}).pipe(Effect.timeout("5 seconds")),
				)
			},
			async close() {
				abort.abort()
				await pump
				await polling.close()
				if (failure) throw failure
			},
		}
	}
	try {
		for (let index = 0; index < writers.length; index++)
			peers.push(await connect(index))
		await Promise.all(
			peers.map(async peer => {
				await peer.until(is("connected"))
				await peer.send({ type: "watch", document })
			}),
		)
		await Promise.all(
			peers.map((peer, index) =>
				peer.send({ type: "presence", presence: cursor(document, index) }),
			),
		)
		let observer = peers[0]
		if (!observer) throw Error("Missing observer")
		let actors = new Set<string>()
		while (actors.size < writers.length - 1) {
			let presence = parsePresence(
				(await observer.until(is("presence"))).presence,
			)
			actors.add(presence.actor)
		}
		expect(actors.size).toBe(23)
		await run(
			Effect.scoped(
				Effect.gen(function* () {
					let offline = new Set<number>()
					let sessions: DocumentSession["Service"][] = []
					for (let [index, account] of writers.entries()) {
						function online<A, E>(effect: Effect.Effect<A, E>) {
							return Effect.suspend<A, E | Error, never>(() =>
								offline.has(index)
									? Effect.fail(new Error("Offline writer"))
									: effect,
							)
						}
						let transport: DocumentTransport = {
							snapshot: document =>
								online(
									account.api.documents.snapshot({
										params: { document },
										query: {},
									}),
								),
							commit: action =>
								online(
									account.api.documents.commit({
										params: { document },
										payload: action,
									}),
								),
							history: (document, after, log, limit) =>
								online(
									account.api.documents.history({
										params: { document },
										query: { after, log, limit },
									}),
								),
						}
						let services = yield* Layer.build(
							cliDocumentSessionLayer(
								join(directory, "swarm-client-" + index),
								{ document, subject: account.subject, transport },
							),
						)
						sessions.push(Context.get(services, DocumentSession))
					}

					let burstMilliseconds: number[] = []
					for (let round = 0; round < 8; round++) {
						let started = performance.now()
						yield* Effect.all(
							sessions.map((session, index) => {
								let source = session.replica.text(document)
								let marker = `\nwriter-${index}-round-${round}\n`
								let position = source.length,
									remove = 0
								if (round % 4 === 1) position = source.indexOf("# Benchmark")
								if (round % 4 === 2)
									position = source.indexOf(
										"A responsiveness",
										Math.floor(source.length / 3),
									)
								if (round % 4 === 3) {
									position = source.indexOf("A responsiveness")
									remove = 2
								}
								if (position < 0) throw Error("Missing source fixture passage")
								return session.edit(
									source.slice(0, position) +
										marker +
										source.slice(position + remove),
								).saved
							}),
							{ concurrency: "unbounded" },
						)
						yield* Effect.all(
							sessions.map(session => session.sync),
							{ concurrency: "unbounded" },
						)
						yield* Effect.promise(() =>
							Promise.all(peers.map(peer => peer.until(is("advanced")))),
						)
						yield* Effect.all(
							sessions.map(session => session.sync),
							{ concurrency: "unbounded" },
						)
						let expected = sessions[0]?.replica.text(document)
						if (!expected) throw Error("Missing converged source")
						for (let [index, session] of sessions.entries()) {
							expect(session.replica.text(document)).toBe(expected)
							for (let completed = 0; completed <= round; completed++)
								expect(
									expected.split(`writer-${index}-round-${completed}\n`),
								).toHaveLength(2)
						}
						yield* Effect.promise(() =>
							Promise.all(
								peers.map((peer, index) =>
									peer.send({
										type: "presence",
										presence: cursor(document, round * 100 + index),
									}),
								),
							),
						)
						let updated = new Set<string>()
						while (updated.size < writers.length - 1) {
							let frame = yield* Effect.promise(() =>
								observer.until(
									message =>
										message.type === "presence" &&
										Number(object(message.presence).cursor) >= round * 100,
								),
							)
							updated.add(parsePresence(frame.presence).actor)
						}
						expect(updated.size).toBe(23)
						burstMilliseconds.push(performance.now() - started)
					}
					console.info(
						"24-writer8KBburst",
						JSON.stringify({
							operations: 192,
							roundMilliseconds: burstMilliseconds,
							operationsPerSecond:
								192000 /
								burstMilliseconds.reduce((sum, duration) => sum + duration, 0),
						}),
					)
					for (let index = 0; index < 4; index++) {
						let session = sessions[index],
							peer = peers[index]
						if (!session || !peer) throw Error("Missing offline client")
						offline.add(index)
						yield* Effect.promise(() => peer.close())
						yield* session.edit(
							session.replica.text(document) + `\noffline-${index} 🧠\n`,
						).saved
						expect((yield* Effect.exit(session.sync))._tag).toBe("Failure")
						yield* session.save
						offline.delete(index)
						let resumed = yield* Effect.promise(() => connect(index))
						peers[index] = resumed
						yield* Effect.promise(() =>
							resumed.send({ type: "watch", document }),
						)
					}
					yield* Effect.all(
						sessions.map(session => session.sync),
						{ concurrency: "unbounded" },
					)
					yield* Effect.all(
						sessions.map(session => session.sync),
						{ concurrency: "unbounded" },
					)
					let expected = sessions[0]?.replica.text(document)
					if (!expected) throw Error("Missing reconnected source")
					for (let session of sessions)
						expect(session.replica.text(document)).toBe(expected)
					for (let index = 0; index < 4; index++)
						expect(expected).toContain(`offline-${index} 🧠\n`)
					let forbidden = yield* buildAction(
						yield* restoreSnapshot(
							yield* reader.api.documents.snapshot({
								params: { document },
								query: {},
							}),
							reader.subject + "-reader",
						),
						document,
						"Reader edit",
						staged => [staged.edit(document, "Forbidden overwrite")],
					)
					let refusal = yield* Effect.flip(
						reader.api.documents.commit({
							params: { document },
							payload: forbidden,
						}),
					)
					expect(refusal._tag).toBe("PermissionDenied")
					let snapshot = yield* restoreSnapshot(
						yield* owner.api.documents.snapshot({
							params: { document },
							query: {},
						}),
						"verification",
					)
					expect(snapshot.text(document)).toBe(expected)
				}),
			),
		)
		let polling = livePoll(await cookieLogin(instance.server.url, 144))
		await polling.open()
		let abort = new AbortController()
		let waiting = polling.poll(abort.signal).catch(() => undefined)
		abort.abort()
		await waiting
		expect(await polling.close()).toBe(204)
		expect(await polling.poll()).toBe(410)
	} finally {
		await Promise.allSettled(peers.map(peer => peer.close()))
	}
}
test("24 independently persisted writers converge over mixed live transports, reconnect and enforce reader permissions", async () => {
	if (process.env.PROFILE_SWARM === "1") {
		let result = await profile(sustainedSwarm)
		await Bun.write("/tmp/alkalye-swarm-profile.txt", result.functions)
	} else await sustainedSwarm()
}, 120_000)

function is(type: string) {
	return (message: LiveMessage) => message.type === type
}
function cursor(document: string, position: number) {
	return {
		actor: "ignored",
		name: "ignored",
		document,
		cursor: position,
		slide: 0,
		x: 10,
		y: 20,
		time: 0,
		presenting: true,
	}
}
type Client = Effect.Success<ReturnType<typeof client>>
function client(seed: number) {
	return Effect.gen(function* () {
		let base = instance.server.url
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
function createWorkspace(owner: Client, workspace: string, name: string) {
	return owner.api.workspaces.create({
		payload: { workspace, name, request: "create-" + workspace },
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
function createDocument(
	owner: Client,
	workspace: string,
	document: string,
	source = "# Live\n\nBody",
) {
	return Effect.gen(function* () {
		let action = yield* buildAction(
			new Replica(owner.subject + "-" + document),
			document,
			"Create document",
			staged => newDocument(staged, document, "Untitled", source),
		)
		return yield* owner.api.documents.create({ payload: { workspace, action } })
	})
}
function edit(account: Client, document: string, text: string) {
	return Effect.gen(function* () {
		let replica = yield* restoreSnapshot(
			yield* account.api.documents.snapshot({
				params: { document },
				query: {},
			}),
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
			yield* account.api.documents.snapshot({
				params: { document },
				query: {},
			}),
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
