import type * as Context from "effect/Context"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Scope from "effect/Scope"
import type { BrowserAccount } from "../../../src/client/browser-account"
import { createWorkerSessionClient } from "./worker-client"
import { makeEditorQueue } from "./editor-queue"

export function verifyWorkerRecovery(
	account: Context.Service.Shape<typeof BrowserAccount>,
	check: (value: unknown, message: string) => void,
) {
	return Effect.scoped(
		Effect.gen(function* () {
			let document = crypto.randomUUID()
			let source = "Durable recovery foundation\n"
			let response = yield* Effect.tryPromise(() =>
				fetch("/__tests/seed", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ subject: account.subject, document, source }),
				}),
			)
			check(
				response.ok,
				"server provisions recovery fixture without main Replica",
			)
			let clientScope = yield* Scope.make()
			yield* Effect.addFinalizer(() => Scope.close(clientScope, Exit.void))
			let platformScope = yield* Scope.fork(clientScope)
			let sent = Deferred.makeUnsafe<void>()
			let replaceSent = 0
			let observation = {
				branch: "unresolved",
				durablePrefix: -1,
				replaceFrames: 0,
			}
			let client = yield* createWorkerSessionClient(
				new URL("/worker.js", location.origin).href,
				{
					platformScope,
					sent(message) {
						if (!Array.isArray(message)) return
						let request: unknown = message[1]
						if (
							typeof request !== "object" ||
							request === null ||
							!("_tag" in request) ||
							request._tag !== "Request" ||
							!("tag" in request) ||
							request.tag !== "ReplaceQueued"
						)
							return
						replaceSent++
						Deferred.doneUnsafe(sent, Effect.void)
					},
				},
			).pipe(Effect.provideService(Scope.Scope, clientScope))
			let opened = yield* client.Open({
				document,
				subject: account.subject,
				origin: location.origin,
			})
			let settled = yield* client.Replace({
				handle: opened.handle,
				ranges: [{ start: source.length, remove: 0, text: "ACKNOWLEDGED\n" }],
			})
			yield* client.Sync()
			let initial = yield* client.Begin()
			let mainDraft = initial.source + "INTERRUPTED\n"
			let rpc = yield* client
				.ReplaceQueued({
					epoch: initial.epoch,
					sequence: 1,
					ranges: [
						{ start: initial.source.length, remove: 0, text: "INTERRUPTED\n" },
					],
				})
				.pipe(Effect.forkScoped({ startImmediately: true }))
			yield* Deferred.await(sent)
			yield* Fiber.interrupt(rpc)
			check(
				replaceSent === 1 && Exit.hasInterrupts(yield* Fiber.await(rpc)),
				"actual ReplaceQueued RPC caller reaches interrupted exit",
			)
			let reconciled = yield* client.Read()
			check(
				reconciled.epoch === initial.epoch &&
					((reconciled.sequence === 0 &&
						reconciled.localSource === initial.source) ||
						(reconciled.sequence === 1 &&
							reconciled.localSource === mainDraft)),
				"surviving worker reconciles interrupted RPC to unchanged or once-applied basis",
			)
			observation.branch =
				reconciled.sequence === 0 ? "not-applied" : "once-applied"
			yield* client.Release({ handle: reconciled.handle })
			yield* client.End({
				epoch: initial.epoch,
				sequence: reconciled.sequence ?? 0,
			})
			let basis = yield* client.Begin()
			let queueScope = yield* Scope.make()
			yield* Effect.addFinalizer(() => Scope.close(queueScope, Exit.void))
			sent = Deferred.makeUnsafe<void>()
			let beforeTerminationFrames = replaceSent
			let editor = yield* makeEditorQueue(client, basis).pipe(
				Effect.provideService(Scope.Scope, queueScope),
			)
			let drafts = [basis.source]
			let requests = []
			for (let index = 0; index < 8; index++) {
				let prior = drafts.at(-1) ?? basis.source
				let next = prior + "QUEUED-" + index + "\n"
				drafts.push(next)
				requests.push(
					editor.replace(
						[
							{
								start: prior.length,
								remove: 0,
								text: "QUEUED-" + index + "\n",
							},
						],
						next,
					),
				)
			}
			yield* Deferred.await(sent)
			let lastNativeDraft = editor.state().source
			// No Close RPC: client platform scope releases the native worker by terminate().
			yield* Scope.close(platformScope, Exit.void)
			yield* Scope.close(clientScope, Exit.void)
			yield* Scope.close(queueScope, Exit.void)
			let outcomes = []
			for (let request of requests)
				outcomes.push(yield* request.saved.pipe(Effect.exit))
			check(
				editor.state().closed &&
					editor.state().source === lastNativeDraft &&
					lastNativeDraft === drafts.at(-1),
				"abrupt worker termination preserves all eight main optimistic edits",
			)
			let delivered = replaceSent - beforeTerminationFrames
			check(
				delivered === 1 &&
					outcomes.every(Exit.isFailure) &&
					editor
						.state()
						.pending.map(edit => edit.delivery)
						.join(",") === ["unknown", ...Array(7).fill("blocked")].join(","),
				"one posted uncertain command and seven unsent suffix edits retain exact recovery statuses",
			)
			let restarted = yield* createWorkerSessionClient(
				new URL("/worker.js", location.origin).href,
			)
			yield* Effect.addFinalizer(() =>
				restarted.Close().pipe(Effect.catch(() => Effect.void)),
			)
			let durable = yield* restarted.Open({
				document,
				subject: account.subject,
				origin: location.origin,
			})
			observation.durablePrefix = drafts.indexOf(durable.source)
			observation.replaceFrames = delivered
			check(
				(durable.source === drafts[0] || durable.source === drafts[1]) &&
					durable.source.startsWith(settled.source),
				"restarted worker restores exact durable prefix including all acknowledged edits",
			)
			yield* restarted.Sync()
			let after = yield* restarted.Read()
			check(
				after.source === durable.source && after.pending === 0,
				"restarted worker accepts durable prefix without replaying unknown main commands",
			)
			check(
				editor.state().source === lastNativeDraft &&
					lastNativeDraft.length > durable.source.length,
				"all seven unsubmitted suffix edits remain available in complete main recovery draft",
			)
			let accepted = yield* account.api.documents.snapshot({
				params: { document },
				query: { encoding: "compact" },
			})
			let history = yield* account.api.documents.history({
				params: { document },
				query: { after: 0, log: accepted.log, limit: 100 },
			})
			window.workerRecoveryObservation = observation
			check(
				history.length ===
					(observation.branch === "once-applied" ? 3 : 2) +
						observation.durablePrefix,
				"server history contains only acknowledged and durable dispatched actions, not seven withheld intents",
			)
			yield* restarted.Close()
		}),
	)
}

declare global {
	interface Window {
		workerRecoveryObservation?: {
			branch: string
			durablePrefix: number
			replaceFrames: number
		}
	}
}
