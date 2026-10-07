import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Scope from "effect/Scope"
import * as Exit from "effect/Exit"
import { makePassiveDocumentCache } from "../../src/client/passive-document-cache"
import { cliDocumentSessionLayer } from "../../src/cli/document-platform"
import { DocumentSession } from "../../src/shared/document-session"
import type {
	DocumentTransport,
	PassiveDocumentState,
} from "../../src/shared/document-session"
import { Replica } from "../../src/shared/crdt"
import { compactCheckpoint } from "../../src/shared/checkpoint"
import { setFields } from "../../src/shared/documents"
import { performanceFixture } from "./fixture"

let originalFork = Replica.prototype.forkEffect
let closed = new WeakSet<Replica>()
let transfer = false
let forks = { calls: 0, transferred: 0, milliseconds: 0 }
Replica.prototype.forkEffect = function (
	this: Replica,
	actor = this.actor,
	author = this.author,
) {
	let source = this
	return Effect.suspend(() => {
		forks.calls++
		if (transfer && actor === "accepted-document" && closed.has(source)) {
			closed.delete(source)
			forks.transferred++
			return Effect.succeed(source)
		}
		let started = performance.now()
		return originalFork.call(source, actor, author).pipe(
			Effect.ensuring(
				Effect.sync(() => {
					forks.milliseconds += performance.now() - started
				}),
			),
		)
	})
}
function snapshot(kilobytes: number) {
	let replica = new Replica("performance-subject-birth")
	setFields(replica, "doc", { type: "document" })
	let source = performanceFixture(
		kilobytes,
		kilobytes === 1024 ? "long-line" : "rich",
	)
	replica.edit("doc", source)
	return {
		source,
		value: {
			format: "document-state-v1",
			document: "doc",
			log: "performance-log",
			position: 1,
			state: JSON.stringify(compactCheckpoint(replica.checkpoint())),
		} satisfies Effect.Success<ReturnType<DocumentTransport["snapshot"]>>,
	}
}

try {
	for (let kilobytes of [128, 1024]) {
		let fixture = snapshot(kilobytes)
		Bun.gc(true)
		for (let reuseClosed of [false, true]) {
			transfer = reuseClosed
			let directory = await mkdtemp(join(tmpdir(), "alkalye-cached-probe-"))
			try {
				await Effect.runPromise(
					Effect.scoped(
						Effect.gen(function* () {
							let cache = (yield* makePassiveDocumentCache())("doc")
							let transport: DocumentTransport = {
								snapshot: () => Effect.succeed(fixture.value),
								commit: () => Effect.fail(new Error("Local reopen experiment")),
								history: () => Effect.succeed([]),
							}
							function open(scope: Scope.Scope) {
								return Layer.build(
									cliDocumentSessionLayer(directory, {
										document: "doc",
										subject: "performance-subject",
										cooperativeWork: true,
										passiveState: cache,
										transport,
									}),
								).pipe(
									Effect.provideService(Scope.Scope, scope),
									Effect.map(context => Context.get(context, DocumentSession)),
								)
							}
							function markClosed(state: PassiveDocumentState | undefined) {
								if (state?.replica) closed.add(state.replica)
							}
							let bootstrapScope = yield* Scope.make()
							let bootstrap = yield* open(bootstrapScope)
							if (bootstrap.replica.text("doc") !== fixture.source)
								throw Error("Bootstrap source differs")
							yield* Scope.close(bootstrapScope, Exit.void)
							markClosed(yield* cache.read)
							for (let iteration = 0; iteration < 3; iteration++) {
								forks = { calls: 0, transferred: 0, milliseconds: 0 }
								let scope = yield* Scope.make()
								let started = performance.now()
								let session = yield* open(scope)
								let openedMs = performance.now() - started
								if (session.replica.text("doc") !== fixture.source)
									throw Error("Reopen source differs")
								console.log(
									JSON.stringify({
										kind: "public SQLite session reopen; closed-source transfer microprototype only",
										cooperativeWork: true,
										kilobytes,
										reuseClosed,
										iteration,
										openedMs,
										forks,
									}),
								)
								yield* Scope.close(scope, Exit.void)
								markClosed(yield* cache.read)
							}
						}),
					),
				)
			} finally {
				await rm(directory, { recursive: true, force: true })
			}
		}
	}
} finally {
	Replica.prototype.forkEffect = originalFork
}
