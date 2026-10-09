import { expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { sqliteLayer } from "../src/platform/sqlite"
import { WorkspaceDirectory } from "../src/cloudflare/workspace-directory"

test("workspace routing preserves mappings and generation boundaries", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			let directory = yield* WorkspaceDirectory
			expect(yield* directory.document("missing")).toBeUndefined()
			yield* directory.registerWorkspace("workspace", "owner")
			yield* directory.registerWorkspace("workspace", "owner")
			yield* directory.registerDocument("document", "workspace")
			yield* directory.registerInvitation("invitation", "workspace")
			yield* directory.rememberMember("workspace", "reader")
			expect(yield* directory.subjectWorkspaces("reader")).toEqual([
				"workspace",
			])
			expect(yield* directory.document("document")).toEqual({
				workspace: "workspace",
				generation: 0,
				state: "active",
			})
			yield* directory.registerWorkspace("other", "owner")
			let conflict = yield* directory
				.registerDocument("document", "other")
				.pipe(Effect.exit)
			expect(conflict._tag).toBe("Failure")
			expect((yield* directory.document("document"))?.workspace).toBe(
				"workspace",
			)
			let frozen = yield* directory.freezeWorkspace("workspace", 0)
			expect(frozen).toEqual({
				workspace: "workspace",
				generation: 1,
				state: "frozen",
			})
			expect(yield* directory.invitation("invitation")).toEqual(frozen)
			let stale = yield* directory
				.activateWorkspace("workspace", 0)
				.pipe(Effect.exit)
			expect(stale._tag).toBe("Failure")
			expect(
				(yield* directory.activateWorkspace("workspace", 1)).generation,
			).toBe(2)
			yield* directory.registerWorkspace("legacy", "owner", "legacy")
			expect((yield* directory.freezeWorkspace("legacy", 0)).state).toBe(
				"frozen",
			)
			expect((yield* directory.activateWorkspace("legacy", 1)).state).toBe(
				"active",
			)
		}).pipe(
			Effect.provide(
				WorkspaceDirectory.live.pipe(Layer.provide(sqliteLayer(":memory:"))),
			),
		),
	)
})
