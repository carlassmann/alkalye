import { afterAll, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as Effect from "effect/Effect"
import * as Deferred from "effect/Deferred"
import * as Fiber from "effect/Fiber"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Context from "effect/Context"
import * as Option from "effect/Option"
import * as PubSub from "effect/PubSub"
import * as SqlClient from "effect/sql/SqlClient"
import * as EventLog from "effect/eventlog/EventLog"
import { sqliteLayer } from "../../src/platform/sqlite"
import { webCryptoLayer } from "../../src/platform/web-crypto"
import { Replica } from "../../src/shared/crdt"
import { parseOperation } from "../../src/shared/model"
import { newDocument, newComment } from "../../src/shared/documents"
import { metadataSource } from "../../src/shared/document-metadata"
import { buildAction, restoreSnapshot, undoAction } from "./document"
import { WorkspaceStore, DocumentStore, Principal } from "./journal"
import { Identity } from "./workspace"

let directory = await mkdtemp(join(tmpdir(), "alkalye-effect-workspace-"))
afterAll(() => rm(directory, { recursive: true, force: true }))
function layer(name: string) {
	let filename = join(directory, name + ".sqlite")
	return Layer.mergeAll(
		WorkspaceStore.layer(filename),
		sqliteLayer(filename),
		webCryptoLayer,
	)
}
function as<A, E, R>(
	subject: string,
	task: Effect.Effect<A, E, R>,
	actors = [subject],
) {
	return task.pipe(Effect.provideService(Identity, { subject, actors }))
}
function create(document = "doc", actor = "owner") {
	return buildAction(new Replica(actor), document, "Create document", staged =>
		newDocument(
			staged,
			document,
			"Untitled",
			"---\ntitle: Source title\npath: Writing\ntags: [one, two]\npinned: true\n---\nQuote",
		),
	)
}
function load(document = "doc", actor = "owner") {
	return WorkspaceStore.use(store => store.snapshot(document)).pipe(
		Effect.flatMap(snapshot =>
			snapshot
				? restoreSnapshot(snapshot, actor)
				: Effect.die("Missing document"),
		),
	)
}
function denied<A, E, R>(task: Effect.Effect<A, E, R>) {
	return task.pipe(
		Effect.match({
			onSuccess: () => "accepted",
			onFailure: error =>
				typeof error === "object" && error !== null && "_tag" in error
					? error._tag
					: "unknown",
		}),
	)
}
function seed() {
	return WorkspaceStore.use(store =>
		Effect.gen(function* () {
			yield* as("owner", store.create("space", "Workspace", "create-space"))
			return yield* as("owner", store.createDocument("space", yield* create()))
		}),
	)
}

test("workspace and first document action commit atomically; sidebar metadata is source-derived", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			let store = yield* WorkspaceStore
			let position = yield* seed()
			let before = yield* as("owner", store.workspaceSnapshot("space"))
			expect(before?.documents).toEqual([
				{
					document: "doc",
					workspace: "space",
					owner: "owner",
					log: expect.any(String),
					position,
					deleted: false,
					metadata: {
						title: "Source title",
						path: "Writing",
						tags: ["one", "two"],
						pinned: true,
						archived: false,
						commentsDisabled: false,
					},
				},
			])
			let replica = yield* as("owner", load())
			let edit = yield* buildAction(replica, "doc", "Edit source", staged => [
				staged.edit(
					"doc",
					metadataSource(staged.text("doc"), {
						title: "Frontmatter wins",
						path: "Work",
						archived: true,
					}),
				),
			])
			let editedPosition = yield* as("owner", store.commit(edit))
			let after = yield* as("owner", store.workspaceSnapshot("space"))
			expect(after?.documents[0]).toMatchObject({
				position: editedPosition,
				metadata: { title: "Frontmatter wins", path: "Work", archived: true },
			})
			let comment = yield* buildAction(
				yield* as("owner", load()),
				"doc",
				"Comment",
				staged =>
					newComment(staged, "comment", "doc", "Quote", "Discuss", "Owner"),
			)
			let commentPosition = yield* as("owner", store.commit(comment))
			let discussed = yield* as("owner", store.workspaceSnapshot("space"))
			expect(discussed?.documents[0]?.metadata).toEqual(
				after?.documents[0]?.metadata,
			)
			expect(discussed?.documents[0]?.position).toBe(commentPosition)
			let sql = yield* SqlClient.SqlClient
			yield* sql`ALTER TABLE effect_event_journal RENAME TO unavailable_history`
			expect(yield* as("owner", store.workspaceSnapshot("space"))).toEqual(
				discussed,
			)
		}).pipe(Effect.provide(layer("summaries"))),
	)
})

test("reopening migrates creator-owned documents to workspace ownership and keeps revocation effective", async () => {
	let filename = join(directory, "ownership-upgrade.sqlite")
	let original = await Effect.runPromise(
		Effect.gen(function* () {
			yield* seed()
			let store = yield* WorkspaceStore
			let action = yield* buildAction(
				yield* as("owner", load()),
				"doc",
				"Open drawing",
				staged => [staged.set("doc", "whiteboard", "canvas")],
			)
			yield* as("owner", store.commit(action))
			let library = yield* as("owner", store.library())
			let sql = yield* SqlClient.SqlClient
			yield* sql`UPDATE workspace_documents SET owner=${"former-writer"} WHERE document=${"doc"}`
			for (let column of [
				"kind",
				"excerpt",
				"updated",
				"created",
				"details_ready",
			])
				yield* sql`ALTER TABLE document_summaries DROP COLUMN ${sql(column)}`
			yield* sql`DELETE FROM document_projection_migrations WHERE migration_id>=2`
			return library.documents[0]
		}).pipe(Effect.provide(layer("ownership-upgrade"))),
	)
	await Effect.runPromise(
		Effect.gen(function* () {
			let store = yield* WorkspaceStore
			let snapshot = yield* as("owner", store.workspaceSnapshot("space"))
			expect(snapshot?.documents[0]?.owner).toBe("owner")
			let library = yield* as("owner", store.library())
			expect(library.documents[0]).toEqual(original)
			expect(library.documents[0]?.kind).toBe("whiteboard")
			expect(yield* as("former-writer", denied(store.snapshot("doc")))).toBe(
				"ResourceUnavailable",
			)
			expect(yield* as("owner", store.snapshot("doc"))).toBeDefined()
		}).pipe(Effect.provide(WorkspaceStore.layer(filename))),
	)
})

test("inherited workspace roles authorize every document read and write; owners alone manage members", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			let store = yield* WorkspaceStore
			yield* seed()
			yield* as(
				"owner",
				store.membership("space", "writer", "writer", "add-writer"),
			)
			yield* as(
				"owner",
				store.membership("space", "reader", "reader", "add-reader"),
			)
			for (let subject of ["owner", "writer", "reader", "stranger"]) {
				let allowed = subject !== "stranger"
				expect(yield* as(subject, denied(store.snapshot("doc")))).toBe(
					allowed ? "accepted" : "ResourceUnavailable",
				)
				expect(yield* as(subject, denied(store.history("doc")))).toBe(
					allowed ? "accepted" : "ResourceUnavailable",
				)
				expect(yield* as(subject, denied(store.action("doc", "unknown")))).toBe(
					allowed ? "accepted" : "ResourceUnavailable",
				)
				let replica = yield* as("owner", load("doc", subject))
				let proposal = yield* buildAction(
					replica,
					"doc",
					"Settings",
					staged => [staged.set("doc", "mode", subject)],
				)
				expect(yield* as(subject, denied(store.commit(proposal)))).toBe(
					subject === "owner" || subject === "writer"
						? "accepted"
						: subject === "reader"
							? "PermissionDenied"
							: "ResourceUnavailable",
				)
				expect(
					yield* as(
						subject,
						denied(
							store.membership(
								"space",
								"another",
								"reader",
								"grant-" + subject,
							),
						),
					),
				).toBe(subject === "owner" ? "accepted" : "PermissionDenied")
			}
			expect(
				yield* as(
					"owner",
					denied(store.membership("space", "owner", null, "remove-owner")),
				),
			).toBe("DocumentConflict")
		}).pipe(Effect.provide(layer("roles"))),
	)
})

test("outer COMMIT failure rolls back association, source, sidebar, native facts and claims; retry publishes once", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			let store = yield* WorkspaceStore
			yield* as("owner", store.create("space", "Workspace", "create-space"))
			let updates = yield* store.changes
			let sql = yield* SqlClient.SqlClient
			yield* sql`CREATE TABLE commit_parent(id INTEGER PRIMARY KEY)`
			yield* sql`CREATE TABLE commit_child(parent INTEGER REFERENCES commit_parent(id) DEFERRABLE INITIALLY DEFERRED)`
			yield* sql`CREATE TRIGGER fail_outer_commit AFTER INSERT ON document_summaries BEGIN INSERT INTO commit_child VALUES (321); END`
			let proposal = yield* create()
			expect(
				yield* as("owner", denied(store.createDocument("space", proposal))),
			).toBe("SqlError")
			for (let table of [
				"workspace_documents",
				"document_summaries",
				"document_access",
				"document_heads",
				"document_tips",
				"document_actions",
				"document_actor_subjects",
				"document_targets",
				"document_operation_ids",
			])
				expect(yield* sql`SELECT * FROM ${sql(table)}`).toEqual([])
			expect(yield* sql`SELECT id FROM effect_event_journal`).toHaveLength(1)
			expect(yield* sql`SELECT * FROM workspace_actions`).toHaveLength(1)
			expect(yield* PubSub.takeUpTo(updates, 1)).toEqual([])
			yield* sql`DROP TRIGGER fail_outer_commit`
			let position = yield* as("owner", store.createDocument("space", proposal))
			expect(yield* as("owner", store.createDocument("space", proposal))).toBe(
				position,
			)
			expect(yield* sql`SELECT * FROM workspace_actions`).toHaveLength(2)
			expect(yield* sql`SELECT * FROM document_actions`).toHaveLength(1)
			expect(yield* PubSub.takeUpTo(updates, 10)).toEqual([undefined])
			expect(
				(yield* as("owner", store.workspaceSnapshot("space")))?.documents,
			).toHaveLength(1)
		}).pipe(Effect.scoped, Effect.provide(layer("rollback"))),
	)
})

test("failed COMMIT discards staged source and grants from a warm document without publishing a hint", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			let store = yield* WorkspaceStore
			yield* seed()
			let snapshot = yield* as("owner", store.snapshot("doc"))
			let sidebar = yield* as("owner", store.workspaceSnapshot("space"))
			let updates = yield* store.changes
			let proposal = yield* buildAction(
				yield* as("owner", load()),
				"doc",
				"Edit and share",
				staged => [
					staged.edit("doc", "---\ntitle: Staged title\n---\nStaged body"),
					staged.set("doc", "access:guest", "reader"),
				],
			)
			let sql = yield* SqlClient.SqlClient
			yield* sql`CREATE TABLE stage_parent (id INTEGER PRIMARY KEY)`
			yield* sql`CREATE TABLE stage_child (parent INTEGER REFERENCES stage_parent(id) DEFERRABLE INITIALLY DEFERRED)`
			yield* sql`CREATE TRIGGER reject_staged_commit AFTER UPDATE ON document_summaries BEGIN INSERT INTO stage_child VALUES (321); END`
			expect(yield* as("owner", denied(store.commit(proposal)))).toBe(
				"SqlError",
			)
			expect(yield* as("owner", store.snapshot("doc"))).toEqual(snapshot)
			expect(yield* as("owner", store.workspaceSnapshot("space"))).toEqual(
				sidebar,
			)
			expect(yield* as("guest", denied(store.snapshot("doc")))).toBe(
				"ResourceUnavailable",
			)
			expect(yield* PubSub.takeUpTo(updates, 10)).toEqual([])
			expect(yield* as("owner", store.history("doc"))).toHaveLength(1)
			yield* sql`DROP TRIGGER reject_staged_commit`
			let position = yield* as("owner", store.commit(proposal))
			expect((yield* as("guest", store.snapshot("doc")))?.position).toBe(
				position,
			)
			expect(
				(yield* as("owner", store.workspaceSnapshot("space")))?.documents[0]
					?.metadata.title,
			).toBe("Staged title")
			expect(yield* PubSub.takeUpTo(updates, 10)).toEqual([undefined])
		}).pipe(Effect.scoped, Effect.provide(layer("staged-commit-rollback"))),
	)
})

test("failed recreation of a warm document cannot leak staged deletion, source or access", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			let store = yield* WorkspaceStore
			yield* seed()
			let snapshot = yield* as("owner", store.snapshot("doc"))
			let sidebar = yield* as("owner", store.workspaceSnapshot("space"))
			let updates = yield* store.changes
			let proposal = yield* buildAction(
				yield* as("owner", load()),
				"doc",
				"Invalid recreation",
				staged => [
					staged.edit(
						"doc",
						"---\ntitle: Invalid replacement\n---\nUncommitted",
					),
					staged.set("doc", "type", "deleted"),
					staged.set("doc", "access:guest", "reader"),
				],
			)
			expect(
				yield* as("owner", denied(store.createDocument("space", proposal))),
			).toBe("DocumentConflict")
			expect(yield* as("owner", store.snapshot("doc"))).toEqual(snapshot)
			expect(yield* as("owner", store.workspaceSnapshot("space"))).toEqual(
				sidebar,
			)
			expect(yield* as("guest", denied(store.snapshot("doc")))).toBe(
				"ResourceUnavailable",
			)
			expect(yield* as("owner", store.history("doc"))).toHaveLength(1)
			expect(yield* PubSub.takeUpTo(updates, 10)).toEqual([])
		}).pipe(Effect.scoped, Effect.provide(layer("warm-recreation"))),
	)
})

test("a concurrent reader sees durable state while a staged writer rolls back its source and many grants", async () => {
	let apply = Replica.prototype.apply
	try {
		await Effect.runPromise(
			Effect.gen(function* () {
				let store = yield* WorkspaceStore
				yield* seed()
				yield* as(
					"owner",
					store.membership("space", "reader", "reader", "add-reader"),
				)
				let before = yield* as("reader", store.snapshot("doc"))
				let proposal = yield* buildAction(
					yield* as("owner", load()),
					"doc",
					"Stage many grants",
					staged => [
						staged.edit(
							"doc",
							"---\ntitle: Private staged source\n---\nInvisible",
						),
						...Array.from({ length: 900 }, (_, index) =>
							staged.set("doc", "access:guest" + index, "reader"),
						),
					],
				)
				let sql = yield* SqlClient.SqlClient
				yield* sql`CREATE TABLE reader_parent (id INTEGER PRIMARY KEY)`
				yield* sql`CREATE TABLE reader_child (parent INTEGER REFERENCES reader_parent(id) DEFERRABLE INITIALLY DEFERRED)`
				yield* sql`CREATE TRIGGER fail_reader_commit AFTER UPDATE ON document_summaries BEGIN INSERT INTO reader_child VALUES (321); END`
				let staged = yield* Deferred.make<void>()
				let finished = false
				let readDuringTransaction = false
				let reader = yield* Deferred.await(staged).pipe(
					Effect.andThen(
						Effect.sync(() => {
							readDuringTransaction = !finished
						}),
					),
					Effect.andThen(as("reader", store.snapshot("doc"))),
					Effect.forkChild,
				)
				Replica.prototype.apply = function (operations) {
					apply.call(this, operations)
					if (operations.some(operation => operation.id === proposal.id))
						Deferred.doneUnsafe(staged, Effect.void)
				}
				let result = yield* as("owner", denied(store.commit(proposal))).pipe(
					Effect.ensuring(
						Effect.sync(() => {
							finished = true
						}),
					),
				)
				Replica.prototype.apply = apply
				expect(result).toBe("SqlError")
				expect(readDuringTransaction).toBe(true)
				expect(yield* Fiber.join(reader)).toEqual(before)
				expect(yield* as("reader", store.snapshot("doc"))).toEqual(before)
				expect(yield* as("guest899", denied(store.snapshot("doc")))).toBe(
					"ResourceUnavailable",
				)
			}).pipe(Effect.scoped, Effect.provide(layer("staged-reader"))),
		)
	} finally {
		Replica.prototype.apply = apply
	}
})

test("staged edits keep checkpoint cadence and reconstruct the same document after cold reopening", async () => {
	let filename = join(directory, "staged-cadence.sqlite")
	let warm = await Effect.runPromise(
		Effect.gen(function* () {
			let store = yield* WorkspaceStore
			yield* seed()
			let replica = yield* as("owner", load())
			for (let index = 0; index < 149; index++) {
				let change = yield* buildAction(replica, "doc", "Append", staged => [
					staged.edit("doc", staged.text("doc") + (index % 10)),
				])
				yield* as("owner", store.commit(change))
				replica.apply(change.changes.map(parseOperation))
			}
			let sql = yield* SqlClient.SqlClient
			expect(
				yield* sql`SELECT version FROM document_heads WHERE document=${"doc"}`,
			).toEqual([{ version: 100 }])
			expect(yield* as("owner", store.history("doc"))).toHaveLength(150)
			return yield* as("owner", store.snapshot("doc"))
		}).pipe(Effect.provide(layer("staged-cadence"))),
	)
	await Effect.runPromise(
		WorkspaceStore.use(store => as("owner", store.snapshot("doc"))).pipe(
			Effect.tap(snapshot => Effect.sync(() => expect(snapshot).toEqual(warm))),
			Effect.provide(WorkspaceStore.layer(filename)),
		),
	)
})

for (let fault of ["cancel", "defect"]) {
	test(`a ${fault} after private staging restores durable source, permissions and metadata`, async () => {
		let apply = Replica.prototype.apply
		try {
			await Effect.runPromise(
				Effect.gen(function* () {
					let store = yield* WorkspaceStore
					yield* seed()
					let snapshot = yield* as("owner", store.snapshot("doc"))
					let sidebar = yield* as("owner", store.workspaceSnapshot("space"))
					let updates = yield* store.changes
					let proposal = yield* buildAction(
						yield* as("owner", load()),
						"doc",
						"Stage source and grant",
						staged => [
							staged.edit("doc", "---\ntitle: Uncommitted\n---\nPrivate state"),
							staged.set("doc", "access:guest", "reader"),
						],
					)
					let staged = false
					let child = yield* Effect.withFiber(fiber =>
						Effect.gen(function* () {
							Replica.prototype.apply = function (operations) {
								apply.call(this, operations)
								if (!operations.some(operation => operation.id === proposal.id))
									return
								staged = true
								if (fault === "defect")
									throw new Error("Injected staging defect")
								fiber.interruptUnsafe()
							}
							return yield* as("owner", store.commit(proposal))
						}),
					).pipe(
						Effect.ensuring(
							Effect.sync(() => {
								Replica.prototype.apply = apply
							}),
						),
						Effect.forkChild,
					)
					let result = yield* Fiber.await(child)
					expect(staged).toBe(true)
					expect(Exit.isFailure(result)).toBe(true)
					expect(yield* as("owner", store.snapshot("doc"))).toEqual(snapshot)
					expect(yield* as("owner", store.workspaceSnapshot("space"))).toEqual(
						sidebar,
					)
					expect(yield* as("guest", denied(store.snapshot("doc")))).toBe(
						"ResourceUnavailable",
					)
					expect(yield* PubSub.takeUpTo(updates, 10)).toEqual([])
					let position = yield* as("owner", store.commit(proposal))
					expect((yield* as("guest", store.snapshot("doc")))?.position).toBe(
						position,
					)
					expect(yield* PubSub.takeUpTo(updates, 10)).toEqual([undefined])
				}).pipe(Effect.scoped, Effect.provide(layer("staging-" + fault))),
			)
		} finally {
			Replica.prototype.apply = apply
		}
	})
}

test("invalid creation cannot leave an empty document in a workspace or reuse another workspace's document", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			let store = yield* WorkspaceStore
			yield* as("owner", store.create("space", "Workspace", "create-space"))
			let invalid = yield* buildAction(
				new Replica("owner"),
				"invalid",
				"Invalid root",
				staged => [staged.set("invalid", "mode", "slideshow")],
			)
			expect(
				yield* as("owner", denied(store.createDocument("space", invalid))),
			).toBe("DocumentConflict")
			expect(
				(yield* as("owner", store.workspaceSnapshot("space")))?.documents,
			).toEqual([])
			let proposal = yield* create()
			yield* as("owner", store.createDocument("space", proposal))
			yield* as(
				"owner",
				store.create("another", "Another workspace", "create-another"),
			)
			expect(
				yield* as("owner", denied(store.createDocument("another", proposal))),
			).toBe("DocumentConflict")
			expect(
				(yield* as("owner", store.workspaceSnapshot("another")))?.documents,
			).toEqual([])
		}).pipe(Effect.provide(layer("invalid-root"))),
	)
})

test("revocation denies warm cached reads, history, action fetches and previously accepted retries", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			let store = yield* WorkspaceStore
			yield* seed()
			yield* as(
				"owner",
				store.membership("space", "peer", "writer", "invite-peer"),
			)
			let replica = yield* as("peer", load("doc", "peer"))
			let action = yield* buildAction(
				replica,
				"doc",
				"Peer setting",
				staged => [staged.set("doc", "mode", "slideshow")],
			)
			yield* as("peer", store.commit(action))
			yield* as("owner", store.membership("space", "peer", null, "revoke-peer"))
			for (let document of ["doc", "missing"]) {
				expect(yield* as("peer", denied(store.snapshot(document)))).toBe(
					"ResourceUnavailable",
				)
				expect(yield* as("peer", denied(store.history(document)))).toBe(
					"ResourceUnavailable",
				)
				expect(
					yield* as("peer", denied(store.action(document, action.id))),
				).toBe("ResourceUnavailable")
			}
			expect(yield* as("peer", denied(store.commit(action)))).toBe(
				"ResourceUnavailable",
			)
			expect(
				(yield* as("owner", store.snapshot("doc")))?.position,
			).toBeGreaterThan(0)
		}).pipe(Effect.provide(layer("revocation"))),
	)
})

test("document access is in its own action stream; compensation revokes a grant without workspace membership", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			let store = yield* WorkspaceStore
			yield* seed()
			let replica = yield* as("owner", load())
			let grant = yield* buildAction(
				replica,
				"doc",
				"Share document",
				staged => [staged.set("doc", "access:guest", "writer")],
			)
			yield* as("owner", store.commit(grant))
			let fact = yield* as("owner", store.action("doc", grant.id))
			if (!fact) return yield* Effect.die("Missing grant fact")
			expect(fact.changes[0]).toMatchObject({
				field: "access:guest",
				value: "writer",
			})
			expect(yield* as("guest", denied(store.snapshot("doc")))).toBe("accepted")
			let guest = yield* as("guest", load("doc", "guest"))
			let edit = yield* buildAction(guest, "doc", "Guest edit", staged => [
				staged.edit("doc", staged.text("doc") + "\nGuest wrote"),
			])
			yield* as("guest", store.commit(edit))
			let compensate = yield* undoAction(yield* as("owner", load()), fact)
			yield* as("owner", store.commit(compensate))
			expect(yield* as("guest", denied(store.snapshot("doc")))).toBe(
				"ResourceUnavailable",
			)
			expect((yield* as("owner", load())).text("doc")).toContain("Guest wrote")
			for (let [field, value] of [
				["access:owner", "reader"],
				["access:other", "owner"],
				["title", "Shadow title"],
				["metadata", "legacy"],
			]) {
				if (!field || value === undefined)
					return yield* Effect.die("Missing case")
				let invalid = yield* buildAction(
					yield* as("owner", load()),
					"doc",
					"Invalid metadata/access",
					staged => [staged.set("doc", field, value)],
				)
				expect(yield* as("owner", denied(store.commit(invalid)))).toBe(
					"DocumentConflict",
				)
			}
		}).pipe(Effect.provide(layer("document-access"))),
	)
})

test("workspace readers cannot create documents; removed writers lose access to their creations", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			let store = yield* WorkspaceStore
			yield* seed()
			for (let role of ["writer", "reader"]) {
				let validRole: "writer" | "reader" =
					role === "writer" ? "writer" : "reader"
				yield* as(
					"owner",
					store.membership("space", role, validRole, "invite-" + role),
				)
				let proposal = yield* create("doc-" + role, role)
				expect(
					yield* as(role, denied(store.createDocument("space", proposal))),
				).toBe(role === "writer" ? "accepted" : "PermissionDenied")
			}
			yield* as(
				"owner",
				store.membership("space", "writer", null, "remove-writer"),
			)
			expect(yield* as("writer", denied(store.snapshot("doc-writer")))).toBe(
				"ResourceUnavailable",
			)
			expect(yield* as("writer", denied(store.snapshot("doc")))).toBe(
				"ResourceUnavailable",
			)
			expect(
				(yield* as("writer", store.sharedDocuments())).map(
					document => document.document,
				),
			).toEqual([])
			let replica = yield* as("owner", load("doc-writer", "owner-other"))
			let ownership = yield* buildAction(
				replica,
				"doc-writer",
				"Change owner via grant",
				staged => [staged.set("doc-writer", "access:writer", "reader")],
			)
			expect(
				yield* as("owner", denied(store.commit(ownership)), ["owner-other"]),
			).toBe("accepted")
			expect(
				yield* as("writer", store.accessRole("doc-writer", "writer")),
			).toBe("reader")
		}).pipe(Effect.provide(layer("creator-owner"))),
	)
})

test("cold reopen preserves workspace membership, grant access and sidebar summary positions", async () => {
	let filename = join(directory, "reopen.sqlite")
	let before = await Effect.runPromise(
		Effect.gen(function* () {
			let store = yield* WorkspaceStore
			yield* seed()
			yield* as(
				"owner",
				store.membership("space", "reader", "reader", "invite-reader"),
			)
			return {
				snapshot: yield* as("reader", store.snapshot("doc")),
				workspace: yield* as("reader", store.workspaceSnapshot("space")),
				history: yield* as("owner", store.workspaceHistory("space")),
			}
		}).pipe(Effect.provide(WorkspaceStore.layer(filename))),
	)
	let after = await Effect.runPromise(
		Effect.gen(function* () {
			let store = yield* WorkspaceStore
			return {
				snapshot: yield* as("reader", store.snapshot("doc")),
				workspace: yield* as("reader", store.workspaceSnapshot("space")),
				history: yield* as("owner", store.workspaceHistory("space")),
			}
		}).pipe(Effect.provide(WorkspaceStore.layer(filename))),
	)
	expect(after).toEqual(before)
	expect(after.history.map(entry => entry.fact.change.kind)).toEqual([
		"created",
		"documentAdded",
		"membership",
	])
})

test("public workspace layer hides the fixture authority and SQL/event journal; notifications contain no identifiers", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			let context = yield* Effect.context<WorkspaceStore>()
			expect(Option.isNone(Context.getOption(context, DocumentStore))).toBe(
				true,
			)
			expect(Option.isNone(Context.getOption(context, Principal))).toBe(true)
			expect(
				Option.isNone(Context.getOption(context, SqlClient.SqlClient)),
			).toBe(true)
			expect(Option.isNone(Context.getOption(context, EventLog.EventLog))).toBe(
				true,
			)
			expect(Option.isNone(Context.getOption(context, Identity))).toBe(true)
			let store = yield* WorkspaceStore
			let updates = yield* store.changes
			yield* seed()
			expect(yield* PubSub.takeUpTo(updates, 10)).toEqual([undefined])
			expect(yield* as("stranger", denied(store.snapshot("doc")))).toBe(
				"ResourceUnavailable",
			)
		}).pipe(
			Effect.scoped,
			Effect.provide(WorkspaceStore.layer(join(directory, "hidden.sqlite"))),
		),
	)
})

test("failed membership COMMIT retains access and emits no wake-up; successful revoke denies every later write", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			let store = yield* WorkspaceStore
			yield* seed()
			yield* as(
				"owner",
				store.membership("space", "peer", "writer", "invite-peer"),
			)
			let updates = yield* store.changes
			let sql = yield* SqlClient.SqlClient
			yield* sql`CREATE TABLE parent(id INTEGER PRIMARY KEY)`
			yield* sql`CREATE TABLE child(parent INTEGER REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED)`
			yield* sql`CREATE TRIGGER fail_membership_commit AFTER DELETE ON workspace_members BEGIN INSERT INTO child VALUES (5); END`
			expect(
				yield* as(
					"owner",
					denied(store.membership("space", "peer", null, "remove-peer")),
				),
			).toBe("SqlError")
			expect(yield* as("peer", denied(store.snapshot("doc")))).toBe("accepted")
			expect(yield* PubSub.takeUpTo(updates, 1)).toEqual([])
			yield* sql`DROP TRIGGER fail_membership_commit`
			let proposal = yield* buildAction(
				yield* as("peer", load("doc", "peer")),
				"doc",
				"Racing write",
				staged => [staged.set("doc", "mode", "teleprompter")],
			)
			yield* Effect.all(
				[
					as("peer", store.commit(proposal).pipe(Effect.exit)),
					as(
						"owner",
						store
							.membership("space", "peer", null, "remove-peer")
							.pipe(Effect.exit),
					),
				],
				{ concurrency: "unbounded" },
			)
			expect(yield* as("peer", denied(store.commit(proposal)))).toBe(
				"ResourceUnavailable",
			)
			let rejected = yield* as("peer", store.commit(proposal).pipe(Effect.exit))
			expect(Exit.isFailure(rejected)).toBe(true)
		}).pipe(Effect.scoped, Effect.provide(layer("membership-rollback"))),
	)
})

test("access projections retain the winning register and reject stale replacement grants", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			let store = yield* WorkspaceStore
			yield* seed()
			let first = yield* as("owner", load("doc", "owner-z"))
			let stale = yield* as("owner", load("doc", "owner-a"))
			let grantWriter = yield* buildAction(
				first,
				"doc",
				"Grant writer",
				staged => [staged.set("doc", "access:guest", "writer")],
			)
			let grantReader = yield* buildAction(
				stale,
				"doc",
				"Old grant reader",
				staged => [staged.set("doc", "access:guest", "reader")],
			)
			yield* as("owner", store.commit(grantWriter), ["owner-z"])
			expect(
				yield* as("owner", denied(store.commit(grantReader)), ["owner-a"]),
			).toBe("AccessConflict")
			let sql = yield* SqlClient.SqlClient
			expect(
				yield* sql`SELECT role FROM document_access WHERE document='doc' AND member='guest'`,
			).toEqual([{ role: "writer" }])
			let guest = yield* as("guest", load("doc", "guest"))
			let change = yield* buildAction(guest, "doc", "Guest setting", staged => [
				staged.set("doc", "mode", "slideshow"),
			])
			expect(yield* as("guest", denied(store.commit(change)))).toBe("accepted")
			expect(
				(yield* as("guest", store.sharedDocuments())).map(
					document => document.document,
				),
			).toEqual(["doc"])
		}).pipe(Effect.provide(layer("winning-grants"))),
	)
})

test("all combinations of workspace and document grants select the strongest effective role", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			let store = yield* WorkspaceStore
			yield* seed()
			for (let workspaceRole of ["writer", "reader", null]) {
				for (let documentRole of ["writer", "reader", null]) {
					let subject = String(workspaceRole) + "-" + String(documentRole)
					if (workspaceRole === "writer" || workspaceRole === "reader")
						yield* as(
							"owner",
							store.membership(
								"space",
								subject,
								workspaceRole,
								"membership-" + subject,
							),
						)
					if (documentRole) {
						let replica = yield* as("owner", load())
						let role = documentRole
						let grant = yield* buildAction(replica, "doc", "Grant", staged => [
							staged.set("doc", "access:" + subject, role),
						])
						yield* as("owner", store.commit(grant))
					}
					let read = workspaceRole !== null || documentRole !== null
					let write = workspaceRole === "writer" || documentRole === "writer"
					expect(yield* as(subject, denied(store.snapshot("doc")))).toBe(
						read ? "accepted" : "ResourceUnavailable",
					)
					let replica = yield* as("owner", load("doc", subject))
					let proposal = yield* buildAction(
						replica,
						"doc",
						"Settings",
						staged => [staged.set("doc", "mode", subject)],
					)
					expect(yield* as(subject, denied(store.commit(proposal)))).toBe(
						write
							? "accepted"
							: read
								? "PermissionDenied"
								: "ResourceUnavailable",
					)
				}
			}
		}).pipe(Effect.provide(layer("effective-roles"))),
	)
})

test("a stale revoke cannot report success while retaining access, including an equal-clock lower actor", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			let store = yield* WorkspaceStore
			yield* seed()
			let stale = yield* as("owner", load("doc", "owner-a"))
			let peer = yield* as("owner", load("doc", "owner-z"))
			let grant = yield* buildAction(peer, "doc", "Grant access", staged => [
				staged.set("doc", "access:guest", "writer"),
			])
			let revoke = yield* buildAction(stale, "doc", "Revoke access", staged => [
				staged.set("doc", "access:guest", ""),
			])
			yield* as("owner", store.commit(grant), ["owner-z"])
			let position = (yield* as("owner", store.snapshot("doc")))?.position
			expect(
				yield* as("owner", denied(store.commit(revoke)), ["owner-a"]),
			).toBe("AccessConflict")
			expect((yield* as("owner", store.snapshot("doc")))?.position).toBe(
				position,
			)
			let current = yield* as("owner", load("doc", "owner-a"))
			let actualRevoke = yield* buildAction(
				current,
				"doc",
				"Revoke current access",
				staged => [staged.set("doc", "access:guest", "")],
			)
			yield* as("owner", store.commit(actualRevoke), ["owner-a"])
			expect(yield* as("guest", denied(store.snapshot("doc")))).toBe(
				"ResourceUnavailable",
			)
			expect(
				yield* as("owner", denied(store.commit(revoke)), ["owner-a"]),
			).toBe("AccessConflict")
		}).pipe(Effect.provide(layer("stale-revoke"))),
	)
})

test("legacy fixture service cannot read or mutate a managed document even with a forged owner role", async () => {
	let filename = join(directory, "fixture-guard.sqlite")
	let result = await Effect.runPromise(
		Effect.gen(function* () {
			let store = yield* WorkspaceStore
			yield* seed()
			return {
				snapshot: yield* as("owner", store.snapshot("doc")),
				summary: yield* as("owner", store.workspaceSnapshot("space")),
			}
		}).pipe(Effect.provide(WorkspaceStore.layer(filename))),
	)
	await Effect.runPromise(
		Effect.gen(function* () {
			let store = yield* DocumentStore
			if (!result.snapshot) return yield* Effect.die("Missing snapshot")
			let replica = yield* restoreSnapshot(result.snapshot, "evil")
			let forged = yield* buildAction(replica, "doc", "Bypass", staged => [
				staged.set("doc", "access:evil", "writer"),
				staged.set("doc", "title", "Shadow title"),
			])
			expect(yield* denied(store.commit(forged))).toBe("PermissionDenied")
			expect(yield* denied(store.snapshot("doc"))).toBe("PermissionDenied")
			expect(yield* denied(store.history("doc"))).toBe("PermissionDenied")
			expect(yield* denied(store.action("doc", forged.id))).toBe(
				"PermissionDenied",
			)
		}).pipe(
			Effect.provide(DocumentStore.layer(filename)),
			Effect.provideService(Principal, {
				subject: "evil",
				actors: ["evil"],
				role: "owner",
			}),
		),
	)
	await Effect.runPromise(
		Effect.gen(function* () {
			let store = yield* WorkspaceStore
			expect(yield* as("owner", store.snapshot("doc"))).toEqual(result.snapshot)
			expect(yield* as("owner", store.workspaceSnapshot("space"))).toEqual(
				result.summary,
			)
			expect(yield* as("evil", denied(store.snapshot("doc")))).toBe(
				"ResourceUnavailable",
			)
		}).pipe(Effect.provide(WorkspaceStore.layer(filename))),
	)
})

test("invalid access subjects produce domain errors and cannot create hidden permissions", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			let store = yield* WorkspaceStore
			yield* seed()
			let replica = yield* as("owner", load())
			let proposal = yield* buildAction(
				replica,
				"doc",
				"Invalid subject",
				staged => [staged.set("doc", "access:", "writer")],
			)
			expect(yield* as("owner", denied(store.commit(proposal)))).toBe(
				"DocumentConflict",
			)
			let sql = yield* SqlClient.SqlClient
			expect(yield* sql`SELECT * FROM document_access`).toEqual([])
		}).pipe(Effect.provide(layer("invalid-member"))),
	)
})

test("additional grants report inherited effective access instead of promising a downgrade", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			let store = yield* WorkspaceStore
			yield* seed()
			yield* as(
				"owner",
				store.membership("space", "writer", "writer", "invite-writer"),
			)
			let grant = yield* buildAction(
				yield* as("owner", load()),
				"doc",
				"Additional reader grant",
				staged => [staged.set("doc", "access:writer", "reader")],
			)
			yield* as("owner", store.commit(grant))
			expect(yield* as("owner", store.accessRole("doc", "writer"))).toBe(
				"writer",
			)
			yield* as(
				"owner",
				store.membership("space", "writer", null, "remove-inherited-writer"),
			)
			expect(yield* as("owner", store.accessRole("doc", "writer"))).toBe(
				"reader",
			)
			expect(
				yield* as("stranger", denied(store.accessRole("doc", "writer"))),
			).toBe("ResourceUnavailable")
		}).pipe(Effect.provide(layer("grant-reporting"))),
	)
})

test("concurrent creates in one workspace cannot duplicate a document or lose the second document's sidebar", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			let store = yield* WorkspaceStore
			yield* as("owner", store.create("space", "Workspace", "create-space"))
			let first = yield* create("one", "first")
			let second = yield* create("two", "second")
			let results = yield* Effect.all(
				[
					as("owner", store.createDocument("space", first), ["first"]),
					as("owner", store.createDocument("space", second), ["second"]),
					as("owner", store.createDocument("space", first), ["first"]),
				],
				{ concurrency: "unbounded" },
			)
			expect(results[0]).toBe(results[2])
			expect(
				(yield* as("owner", store.workspaceSnapshot("space")))?.documents.map(
					document => document.document,
				),
			).toEqual(["one", "two"])
			expect(yield* as("owner", store.history("one"))).toHaveLength(1)
			expect(yield* as("owner", store.history("two"))).toHaveLength(1)
		}).pipe(Effect.provide(layer("concurrent-create"))),
	)
})

test("a higher actor id cannot use an unobserved grant to resurrect revoked access", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			let store = yield* WorkspaceStore
			yield* seed()
			let owner = yield* as("owner", load("doc", "owner-a"))
			let grant = yield* buildAction(owner, "doc", "Grant reader", staged => [
				staged.set("doc", "access:guest", "reader"),
			])
			yield* as("owner", store.commit(grant), ["owner-a"])
			let stale = yield* as("owner", load("doc", "owner-z"))
			let revoke = yield* buildAction(
				yield* as("owner", load("doc", "owner-a")),
				"doc",
				"Revoke",
				staged => [staged.set("doc", "access:guest", "")],
			)
			yield* as("owner", store.commit(revoke), ["owner-a"])
			let upgrade = yield* buildAction(
				stale,
				"doc",
				"Stale upgrade",
				staged => [staged.set("doc", "access:guest", "writer")],
			)
			expect(upgrade.changes[0]?.id > (revoke.changes[0]?.id ?? "")).toBe(true)
			expect(
				yield* as("owner", denied(store.commit(upgrade)), ["owner-z"]),
			).toBe("AccessConflict")
			expect(yield* as("guest", denied(store.snapshot("doc")))).toBe(
				"ResourceUnavailable",
			)
			let current = yield* as("owner", load("doc", "owner-z"))
			let deliberate = yield* buildAction(
				current,
				"doc",
				"Share after observing revoke",
				staged => [staged.set("doc", "access:guest", "writer")],
			)
			yield* as("owner", store.commit(deliberate), ["owner-z"])
			expect(yield* as("guest", denied(store.snapshot("doc")))).toBe("accepted")
			let fact = yield* as("owner", store.action("doc", deliberate.id))
			expect(fact).not.toHaveProperty("accessGuards")
		}).pipe(Effect.provide(layer("unobserved-grant"))),
	)
})

test("access preconditions cannot be omitted or duplicated; unrelated edits do not conflict with an observed grant", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			let store = yield* WorkspaceStore
			yield* seed()
			let first = yield* as("owner", load("doc", "owner"))
			let observed = yield* buildAction(first, "doc", "Share", staged => [
				staged.set("doc", "access:guest", "reader"),
			])
			expect(
				yield* as(
					"owner",
					denied(store.commit({ ...observed, accessGuards: [] })),
				),
			).toBe("AccessConflict")
			expect(
				yield* as(
					"owner",
					denied(
						store.commit({
							...observed,
							accessGuards: [
								...observed.accessGuards,
								...observed.accessGuards,
							],
						}),
					),
				),
			).toBe("AccessConflict")
			let other = yield* as("owner", load("doc", "other"))
			let setting = yield* buildAction(
				other,
				"doc",
				"Unrelated setting",
				staged => [staged.set("doc", "mode", "slideshow")],
			)
			yield* as("owner", store.commit(setting), ["other"])
			yield* as("owner", store.commit(observed))
			expect(yield* as("guest", denied(store.snapshot("doc")))).toBe("accepted")
			expect((yield* as("owner", load())).fields("doc").mode).toBe("slideshow")
		}).pipe(Effect.provide(layer("required-preconditions"))),
	)
})

test("library kind follows whiteboard toggles without a source edit and restores frontmatter presentation mode", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			let store = yield* WorkspaceStore
			yield* seed()
			let edit = yield* buildAction(
				yield* as("owner", load()),
				"doc",
				"Slideshow",
				staged => [
					staged.edit(
						"doc",
						"---\ntitle: Slides\nmode: present\n---\n# First slide",
					),
				],
			)
			yield* as("owner", store.commit(edit))
			let slides = yield* as("owner", store.library())
			expect(slides.documents[0]?.kind).toBe("slides")
			let toggles: Array<{ value: string; kind: "whiteboard" | "slides" }> = [
				{ value: "canvas", kind: "whiteboard" },
				{ value: "", kind: "slides" },
			]
			for (let { value, kind } of toggles) {
				let action = yield* buildAction(
					yield* as("owner", load()),
					"doc",
					"Toggle drawing",
					staged => [staged.set("doc", "whiteboard", value)],
				)
				yield* as("owner", store.commit(action))
				let current = yield* as("owner", store.library())
				expect(current.documents[0]?.kind).toBe(kind)
				expect(current.documents[0]?.metadata).toEqual(
					slides.documents[0]?.metadata,
				)
				expect(current.documents[0]?.excerpt).toBe(slides.documents[0]?.excerpt)
			}
			for (let mode of ["presentation", "slideshow", "present"]) {
				let action = yield* buildAction(
					yield* as("owner", load()),
					"doc",
					"Change mode",
					staged => [staged.edit("doc", `---\nmode: ${mode}\n---\n# Title`)],
				)
				yield* as("owner", store.commit(action))
				let expected: "slides" | "document" =
					mode === "present" ? "slides" : "document"
				expect((yield* as("owner", store.library())).documents[0]?.kind).toBe(
					expected,
				)
				expect((yield* as("owner", load())).documents("doc")[0]?.kind).toBe(
					expected,
				)
			}
		}).pipe(Effect.provide(layer("library-whiteboard"))),
	)
})

test("reopening repairs an already upgraded catalogue from checkpoint and tail without retaining default or invented details", async () => {
	let original = await Effect.runPromise(
		Effect.gen(function* () {
			yield* seed()
			let store = yield* WorkspaceStore
			let changed = yield* buildAction(
				yield* as("owner", load()),
				"doc",
				"Revise source",
				staged => [
					staged.edit(
						"doc",
						"---\ntitle: Presentation\nmode: present\n---\n# Opening",
					),
				],
			)
			yield* as("owner", store.commit(changed))
			let library = yield* as("owner", store.library())
			let sql = yield* SqlClient.SqlClient
			yield* sql`UPDATE document_summaries SET kind='document',excerpt='',created=1,updated=0`
			yield* sql`ALTER TABLE document_summaries DROP COLUMN details_ready`
			yield* sql`DELETE FROM document_projection_migrations WHERE migration_id>=4`
			return library.documents[0]
		}).pipe(Effect.provide(layer("summary-repair"))),
	)
	await Effect.runPromise(
		Effect.gen(function* () {
			let store = yield* WorkspaceStore
			let library = yield* as("owner", store.library())
			expect(library.documents[0]).toEqual(original)
			expect(library.documents[0]?.kind).toBe("slides")
			expect(library.documents[0]?.excerpt).toBe("Opening")
			let sql = yield* SqlClient.SqlClient
			yield* sql`ALTER TABLE document_heads RENAME TO unavailable_checkpoints`
			yield* sql`ALTER TABLE effect_event_journal RENAME TO unavailable_events`
			expect(yield* as("owner", store.library())).toEqual(library)
		}).pipe(Effect.provide(layer("summary-repair"))),
	)
})

test("current writers can withdraw their own ACL proposals; reader retries are idempotent without admitting new work", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			let store = yield* WorkspaceStore
			yield* seed()
			yield* as(
				"owner",
				store.membership("space", "writer", "writer", "withdraw-writer"),
			)
			let replica = yield* as("writer", load("doc", "writer-device"))
			let acl = yield* buildAction(replica, "doc", "Withdraw grant", staged => [
				staged.set("doc", "access:guest", "reader"),
			])
			let snapshot = yield* as("owner", store.snapshot("doc"))
			let history = yield* as("owner", store.history("doc"))
			expect(yield* as("writer", denied(store.commit(acl)), [acl.actor])).toBe(
				"PermissionDenied",
			)
			yield* as("writer", store.withdraw(acl), [acl.actor])
			expect(yield* as("owner", store.snapshot("doc"))).toEqual(snapshot)
			expect(yield* as("owner", store.history("doc"))).toEqual(history)
			expect(yield* as("guest", denied(store.snapshot("doc")))).toBe(
				"ResourceUnavailable",
			)
			yield* as(
				"owner",
				store.membership("space", "writer", "reader", "withdraw-demotion"),
			)
			yield* as("writer", store.withdraw(acl), [acl.actor])
			let next = yield* buildAction(
				replica,
				"doc",
				"Not admitted",
				staged => [staged.set("doc", "note", "blocked")],
				"writer-new",
			)
			expect(
				yield* as("writer", denied(store.withdraw(next)), [next.actor]),
			).toBe("PermissionDenied")
			expect(
				yield* as(
					"writer",
					denied(store.withdraw({ ...acl, label: "Changed" })),
					[acl.actor],
				),
			).toBe("DocumentConflict")
			yield* as(
				"owner",
				store.membership("space", "writer", null, "withdraw-revoke"),
			)
			expect(
				yield* as("writer", denied(store.withdraw(acl)), [acl.actor]),
			).toBe("ResourceUnavailable")
			let mismatched = yield* as("owner", denied(store.withdraw(acl)), [
				acl.actor,
			])
			expect(mismatched).toBe("DocumentConflict")
		}).pipe(Effect.provide(layer("withdrawal-role-retries"))),
	)
})
