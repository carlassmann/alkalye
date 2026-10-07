import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as Context from "effect/Context"
import * as Layer from "effect/Layer"
import { cliDocumentSessionLayer } from "../src/cli/document-platform"
import { DocumentSession } from "../src/shared/document-session"
import type { DocumentTransport } from "../src/shared/document-session"
import { expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import { Replica } from "../src/shared/crdt"
import { buildAction } from "../src/shared/document-actions"
import type { Operation } from "../src/shared/model"
import { parseOperation } from "../src/shared/model"

function makeReplica() {
	let replica = new Replica("writer", "Named writer")
	replica.edit("doc", "Words 😀\n".repeat(16384))
	replica.set("doc", "access:reader", "reader")
	return replica
}
function build(staged: Pick<Replica, "set">): Operation[] {
	return [
		staged.set("doc", "note", "Changed"),
		staged.set("doc", "access:reader", "writer"),
	].map(operation => ({ ...operation, time: 0 }))
}
test("detached action builders retain author, clock, guards and exact operation semantics", async () => {
	let replica = makeReplica()
	let before = replica.checkpoint()
	let next = await Effect.runPromise(
		buildAction(replica, "doc", "Settings", build, "different-actor"),
	)
	expect(next.changes.map(change => change.clock)).toEqual([
		replica.clock + 1,
		replica.clock + 2,
	])
	expect(next.actor).toBe("different-actor")
	expect(next.accessGuards).toEqual([
		{
			field: "access:reader",
			observed: replica.register("doc", "access:reader")?.id ?? "",
		},
	])
	expect(next.changes.every(change => change.author === "Named writer")).toBe(
		true,
	)
	expect(replica.checkpoint()).toEqual(before)
	let stagedHistory = ""
	await Effect.runPromise(
		buildAction(replica, "doc", "History", staged => {
			stagedHistory = staged.text("doc", replica.clock)
			return build(staged)
		}),
	)
	expect(stagedHistory).toBe(replica.text("doc"))
})
test("interruption prevents action publication and leaves the source independent", async () => {
	let replica = makeReplica()
	let before = replica.checkpoint()
	let built = false
	await Effect.runPromise(
		Effect.gen(function* () {
			let fiber = yield* Effect.forkChild(
				buildAction(replica, "doc", "Interrupted", staged => {
					built = true
					return build(staged)
				}),
				{ startImmediately: true },
			)
			yield* Fiber.interrupt(fiber)
		}),
	)
	expect(built).toBe(false)
	expect(replica.checkpoint()).toEqual(before)
})
test("a concurrent edit rejects stale staging without publishing or losing the edit", async () => {
	let replica = makeReplica()
	let source = replica.text("doc")
	let built = false
	let result = await Effect.runPromise(
		Effect.gen(function* () {
			let fiber = yield* Effect.forkChild(
				buildAction(replica, "doc", "Concurrent", staged => {
					built = true
					return build(staged)
				}),
				{ startImmediately: true },
			)
			replica.edit("doc", source + "Concurrent 🌻")
			return yield* Fiber.await(fiber)
		}),
	)
	expect(result._tag).toBe("Failure")
	expect(built).toBe(false)
	expect(replica.text("doc")).toBe(source + "Concurrent 🌻")
	expect(replica.fields("doc").note).toBeUndefined()
})

test("legacy text atoms retain identical staged edit semantics", async () => {
	let replica = new Replica("legacy")
	replica.edit("doc", "Z")
	let snapshot = replica.checkpoint()
	let atom = snapshot.targets[0]?.atoms[0]
	if (!atom) throw Error("Missing atom")
	atom.value = "Legacy 😀 text"
	let legacy = new Replica("migrated")
	legacy.restore(snapshot)
	function edit(staged: Pick<Replica, "edit">) {
		let op = staged.edit("doc", "Changed 😀 text")
		return op ? [{ ...op, time: 0 }] : []
	}
	let after = await Effect.runPromise(
		buildAction(legacy, "doc", "Legacy", edit),
	)
	legacy.apply(after.changes.map(parseOperation))
	expect(legacy.text("doc")).toBe("Changed 😀 text")
})
test("document views expose independent detached staging through real durable sessions", async () => {
	let directory = await mkdtemp(join(tmpdir(), "alkalye-action-fork-"))
	let remote = new Replica("birth", "Named writer")
	remote.edit("doc", "Original 😀")
	let transport: DocumentTransport = {
		snapshot: () =>
			Effect.succeed({
				format: "document-state-v1",
				document: "doc",
				log: "fork-log",
				position: 1,
				state: JSON.stringify(remote.checkpoint()),
			}),
		commit: () => Effect.fail(new Error("Offline")),
		history: () => Effect.succeed([]),
	}
	try {
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					let services = yield* Layer.build(
						cliDocumentSessionLayer(directory, {
							document: "doc",
							subject: "owner",
							transport,
						}),
					)
					let session = Context.get(services, DocumentSession)
					let detached = yield* session.replica.forkEffect(
						"other",
						"Other writer",
					)
					detached.edit("doc", "Detached 🌻")
					expect(session.replica.text("doc")).toBe("Original 😀")
					expect(detached.actor).toBe("other")
					expect(detached.author).toBe("Other writer")
					let action = yield* buildAction(
						session.replica,
						"doc",
						"Properties",
						build,
					)
					expect(action.accessGuards).toEqual([
						{ field: "access:reader", observed: "" },
					])
					expect(session.unsaved()).toBe(0)
				}),
			),
		)
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
})
