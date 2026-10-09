import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Replica } from "../src/shared/crdt"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as HttpServer from "effect/http/HttpServer"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import { sqliteLayer } from "../src/platform/sqlite"
import { webCryptoLayer } from "../src/platform/web-crypto"
import {
	WorkspaceStore,
	DocumentMaintenance,
} from "../src/server/document-store"
import { WorkspaceTransfers } from "../src/server/workspace-transfer"
import { RequestOrigin } from "../src/server/request-origin"
import { DocumentObservability } from "../src/shared/document-observability"
import { Identity } from "../src/shared/workspace"
import { newDocument } from "../src/shared/documents"
import { restoreSnapshot, buildAction } from "../src/shared/document-actions"
import { makeWorkspaceHandler } from "../src/cloudflare/workspace-api"
import { WorkspaceDirectory } from "../src/cloudflare/workspace-directory"
import { makeWorkspaceMoves } from "../src/cloudflare/workspace-moves"
import type { WorkspaceRequest } from "../src/cloudflare/workspace-rpc"
class Handler extends Context.Service<
	Handler,
	Effect.Success<ReturnType<typeof makeWorkspaceHandler>>
>()("MoveTestHandler") {}
function remote() {
	return ManagedRuntime.make(
		Layer.effect(Handler, makeWorkspaceHandler()).pipe(
			Layer.provideMerge(
				Layer.mergeAll(
					WorkspaceStore.live,
					DocumentMaintenance.live,
					WorkspaceTransfers.live,
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
function owner<A, E, R>(effect: Effect.Effect<A, E, R>) {
	return effect.pipe(
		Effect.provideService(Identity, {
			subject: "owner",
			actors: ["owner", "owner-edit", "owner-profile"],
		}),
	)
}
function gateway(request: WorkspaceRequest, file: string) {
	return ManagedRuntime.make(
		Layer.effect(
			Moves,
			makeWorkspaceMoves(request, route => Effect.succeed(route)),
		).pipe(
			Layer.provideMerge(WorkspaceDirectory.live),
			Layer.provideMerge(sqliteLayer(file)),
		),
	)
}
class Moves extends Context.Service<
	Moves,
	Effect.Success<ReturnType<typeof makeWorkspaceMoves>>
>()("MoveTestGateway") {}

test("durable gateway moves resume unknown target acceptance and preserve cyclic request receipts", async () => {
	let first = remote(),
		second = remote()
	let loseImport = true
	let rejectImport = true
	function destination<A, E, R>(effect: Effect.Effect<A, E, R>) {
		return effect.pipe(
			Effect.provideService(Identity, {
				subject: "destination-owner",
				actors: ["destination-owner"],
			}),
		)
	}
	let requests: WorkspaceRequest = async (workspace, identity, request) => {
		let runtime = workspace === "first" ? first : second
		if (
			new URL(request.url).pathname === "/internal/moves/import" &&
			rejectImport
		) {
			rejectImport = false
			await second.runPromise(
				destination(
					WorkspaceStore.use(s =>
						s.membership("second", "owner", null, "revoke"),
					),
				),
			)
		}
		let handler = await runtime.runPromise(Handler)
		let response = await handler(request, Context.make(Identity, identity))
		if (
			new URL(request.url).pathname === "/internal/moves/import" &&
			loseImport &&
			response.ok
		) {
			loseImport = false
			throw new Error("Accepted response lost")
		}
		return response
	}
	let directory = mkdtempSync(join(tmpdir(), "alkalye-workspace-moves-"))
	let file = join(directory, "gateway.sqlite")
	let central = gateway(requests, file)
	try {
		await first.runPromise(
			owner(
				Effect.gen(function* () {
					let s = yield* WorkspaceStore
					yield* s.create("first", "First", "create-first")
					yield* s.createDocument(
						"first",
						yield* buildAction(new Replica("owner"), "moving", "Create", r =>
							newDocument(r, "moving", "Moved", "seed"),
						),
					)
				}),
			),
		)
		await second.runPromise(
			destination(
				WorkspaceStore.use(s =>
					s
						.create("second", "Second", "create-second")
						.pipe(
							Effect.andThen(
								s.membership("second", "owner", "writer", "grant"),
							),
						),
				),
			),
		)
		await central.runPromise(
			WorkspaceDirectory.use(d =>
				Effect.gen(function* () {
					yield* d.registerWorkspace("first", "owner")
					yield* d.registerWorkspace("second", "destination-owner")
					yield* d.registerDocument("moving", "first")
				}),
			),
		)
		await second.runPromise(
			destination(
				WorkspaceStore.use(s =>
					s.membership("second", "stranger", "writer", "stranger"),
				),
			),
		)
		let unauthorized = await central.runPromise(
			Moves.use(m => m("moving", "second", "unauthorized")).pipe(
				Effect.provideService(Identity, {
					subject: "stranger",
					actors: ["stranger"],
				}),
				Effect.exit,
			),
		)
		expect(unauthorized._tag).toBe("Failure")
		let denied = await central.runPromise(
			owner(Moves.use(m => m("moving", "second", "denied")).pipe(Effect.exit)),
		)
		expect(denied._tag).toBe("Failure")
		expect(
			await first.runPromise(
				owner(WorkspaceStore.use(s => s.snapshot("moving"))),
			),
		).toBeDefined()
		await second.runPromise(
			destination(
				WorkspaceStore.use(s =>
					s.membership("second", "owner", "writer", "restore"),
				),
			),
		)
		expect(
			(
				await central.runPromise(
					owner(
						Moves.use(m => m("moving", "second", "denied")).pipe(Effect.exit),
					),
				)
			)._tag,
		).toBe("Failure")
		let interrupted = await central.runPromise(
			owner(Moves.use(m => m("moving", "second", "out")).pipe(Effect.exit)),
		)
		expect(interrupted._tag).toBe("Failure")
		expect(
			(
				await first.runPromise(
					owner(
						WorkspaceStore.use(s => s.snapshot("moving")).pipe(Effect.exit),
					),
				)
			)._tag,
		).toBe("Failure")
		expect(
			(
				await central.runPromise(
					WorkspaceDirectory.use(d => d.document("moving")),
				)
			)?.workspace,
		).toBe("first")
		await central.dispose()
		central = gateway(requests, file)
		let receipt = await central.runPromise(
			owner(Moves.use(m => m("moving", "second", "out"))),
		)
		expect(
			await central.runPromise(
				owner(Moves.use(m => m("moving", "second", "out"))),
			),
		).toBe(receipt)
		let saved = await second.runPromise(
			owner(
				Effect.gen(function* () {
					let s = yield* WorkspaceStore
					let snapshot = yield* s.snapshot("moving")
					if (!snapshot)
						return yield* Effect.fail(new Error("Missing moved document"))
					let r = yield* restoreSnapshot(snapshot, "owner-edit")
					let a = yield* buildAction(r, "moving", "Edit", replica => [
						replica.edit("moving", r.text("moving") + " changed"),
					])
					yield* s.commit(a)
					return { source: r.text("moving"), log: snapshot.log }
				}),
			),
		)
		let back = await central.runPromise(
			owner(Moves.use(m => m("moving", "first", "back"))),
		)
		expect(back).toBeGreaterThan(0)
		expect(
			await central.runPromise(
				owner(Moves.use(m => m("moving", "second", "out"))),
			),
		).toBe(receipt)
		expect(
			(
				await central.runPromise(
					WorkspaceDirectory.use(d => d.document("moving")),
				)
			)?.workspace,
		).toBe("first")
		await first.runPromise(
			owner(
				Effect.gen(function* () {
					let s = yield* WorkspaceStore
					let snapshot = yield* s.snapshot("moving")
					if (!snapshot)
						return yield* Effect.fail(new Error("Missing returned document"))
					expect(snapshot.log).not.toBe(saved.log)
					expect(
						(yield* restoreSnapshot(snapshot, "reader")).text("moving"),
					).toBe(saved.source + " changed")
					expect(
						(yield* s.workspaceHistory("first")).some(
							row => row.fact.change.kind === "documentMoved",
						),
					).toBe(true)
				}),
			),
		)
		await central.dispose()
		central = gateway(requests, file)
		expect(
			await central.runPromise(
				owner(Moves.use(m => m("moving", "second", "out"))),
			),
		).toBe(receipt)
	} finally {
		await central.dispose()
		await first.dispose()
		await second.dispose()
		rmSync(directory, { recursive: true, force: true })
	}
})
