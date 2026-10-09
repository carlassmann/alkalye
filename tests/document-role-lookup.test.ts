import { afterAll, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { WorkspaceStore } from "../src/server/document-store"
import { Replica } from "../src/shared/crdt"
import { buildAction } from "../src/shared/document-actions"
import { newDocument } from "../src/shared/documents"
import { Identity } from "../src/shared/workspace"
import { webCryptoLayer } from "../src/platform/web-crypto"

let directory = await mkdtemp(join(tmpdir(), "alkalye-role-lookup-"))
afterAll(() => rm(directory, { recursive: true, force: true }))

test("role lookups preserve current self authority, cross-subject privacy and scoped admission", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			let store = yield* WorkspaceStore
			yield* store.create("space", "Workspace", "create-space")
			let action = yield* buildAction(
				new Replica("owner"),
				"doc",
				"Create",
				staged => newDocument(staged, "doc", "Title", "Body"),
			)
			yield* store.createDocument("space", action)
			yield* store.membership("space", "writer", "writer", "grant-writer")
			yield* store.membership("space", "reader", "reader", "grant-reader")
			expect(yield* store.accessRole("doc", "owner")).toBe("owner")
			expect(yield* store.accessRole("doc", "writer")).toBe("writer")
			expect(yield* store.accessRole("doc", "reader")).toBe("reader")
			expect(
				yield* store
					.accessRole("doc", "writer")
					.pipe(
						Effect.provideService(Identity, { subject: "writer", actors: [] }),
					),
			).toBe("writer")
			expect(
				yield* store
					.accessRole("doc", "reader")
					.pipe(
						Effect.provideService(Identity, { subject: "reader", actors: [] }),
					),
			).toBe("reader")
			let privateRole = yield* store
				.accessRole("doc", "owner")
				.pipe(
					Effect.provideService(Identity, { subject: "stranger", actors: [] }),
					Effect.flip,
				)
			expect(privateRole._tag).toBe("ResourceUnavailable")
			let scoped = {
				subject: "owner",
				actors: [],
				access: { workspaces: ["space"], ceiling: "reader" },
			} satisfies typeof Identity.Service
			expect(
				yield* store
					.accessRole("doc", "owner")
					.pipe(Effect.provideService(Identity, scoped)),
			).toBe("owner")
			expect(
				yield* store
					.accessRole("doc", "writer")
					.pipe(Effect.provideService(Identity, scoped)),
			).toBe("writer")
			let excluded = yield* store.accessRole("doc", "owner").pipe(
				Effect.provideService(Identity, {
					subject: "owner",
					actors: [],
					access: { workspaces: ["other"], ceiling: "owner" },
				}),
				Effect.flip,
			)
			expect(excluded._tag).toBe("ResourceUnavailable")
			yield* store.membership("space", "writer", null, "revoke-writer")
			let revoked = yield* store
				.accessRole("doc", "writer")
				.pipe(
					Effect.provideService(Identity, { subject: "writer", actors: [] }),
					Effect.flip,
				)
			expect(revoked._tag).toBe("ResourceUnavailable")
			expect(yield* store.accessRole("doc", "writer")).toBeUndefined()
			yield* store.membership("space", "writer", "reader", "regrant-reader")
			expect(
				yield* store
					.accessRole("doc", "writer")
					.pipe(
						Effect.provideService(Identity, { subject: "writer", actors: [] }),
					),
			).toBe("reader")
			yield* store.membership("space", "writer", "writer", "promote-writer")
			expect(
				yield* store
					.accessRole("doc", "writer")
					.pipe(
						Effect.provideService(Identity, { subject: "writer", actors: [] }),
					),
			).toBe("writer")
		}).pipe(
			Effect.provideService(Identity, { subject: "owner", actors: ["owner"] }),
			Effect.provide(
				Layer.merge(
					WorkspaceStore.layer(join(directory, "roles.sqlite")),
					webCryptoLayer,
				),
			),
		),
	)
})
