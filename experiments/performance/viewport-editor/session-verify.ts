import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Scope from "effect/Scope"
import { createViewportSession } from "./session-client"

export function verifySessionWorker(url: string, subject: string) {
	return Effect.scoped(
		Effect.gen(function* () {
			let owner = yield* Scope.make()
			yield* Effect.addFinalizer(() => Scope.close(owner, Exit.void))
			let client = yield* createViewportSession(url).pipe(Scope.provide(owner))
			let document = "worker-check-" + crypto.randomUUID(),
				epoch = crypto.randomUUID()
			let source = "# Worker\n\nBody"
			let opened = yield* client.Open({ document, subject, epoch, source })
			let revision = opened.revision
			for (let sequence = 1; sequence <= 3; sequence++) {
				let text = sequence === 2 ? " 🧠" : "x"
				let start = sequence === 3 ? source.indexOf("Body") : source.length
				let result = yield* client.Replace({
					epoch,
					sequence,
					baseRevision: revision,
					start,
					remove: 0,
					text,
				})
				if (!result.durable || result.sequence !== sequence)
					return yield* Effect.die(Error("Missing durable acknowledgement"))
				revision = result.revision
				source = source.slice(0, start) + text + source.slice(start)
			}
			let stale = yield* client
				.Replace({
					epoch,
					sequence: 4,
					baseRevision: opened.revision,
					start: 0,
					remove: 1,
					text: "wrong",
				})
				.pipe(Effect.result)
			if (stale._tag !== "Failure")
				return yield* Effect.die(Error("Stale revision accepted"))
			let wrongEpoch = yield* client
				.Read({ epoch: "obsolete" })
				.pipe(Effect.result)
			if (wrongEpoch._tag !== "Failure")
				return yield* Effect.die(Error("Obsolete epoch accepted"))
			let current = yield* client.Read({ epoch })
			if (current.content !== source)
				return yield* Effect.die(Error("Rejected transaction changed source"))
			let peer = yield* createViewportSession(url),
				peerEpoch = crypto.randomUUID()
			let peerOpened = yield* peer.Open({
				document,
				subject,
				epoch: peerEpoch,
				source: "Unused peer snapshot",
			})
			let peerSaved = yield* peer.Replace({
				epoch: peerEpoch,
				sequence: 1,
				baseRevision: peerOpened.revision,
				start: source.length,
				remove: 0,
				text: " peer",
			})
			if (!peerSaved.durable)
				return yield* Effect.die(Error("Peer edit was not durable"))
			for (let attempt = 0; attempt < 2; attempt++) {
				let unseen = yield* client
					.Replace({
						epoch,
						sequence: 4,
						baseRevision: current.revision,
						start: 0,
						remove: 0,
						text: "unsafe",
					})
					.pipe(Effect.result)
				if (unseen._tag !== "Failure")
					return yield* Effect.die(
						Error("Unseen peer text accepted offset replacement"),
					)
			}
			let refreshed = yield* client.Read({ epoch })
			source += " peer"
			if (refreshed.content !== source)
				return yield* Effect.die(Error("Read missed peer contribution"))
			let afterPeer = yield* client.Replace({
				epoch,
				sequence: 4,
				baseRevision: refreshed.revision,
				start: source.length,
				remove: 0,
				text: " after",
			})
			if (!afterPeer.durable)
				return yield* Effect.die(
					Error("Resynchronized replacement was not durable"),
				)
			source += " after"
			yield* peer.Close()
			yield* Scope.close(owner, Exit.void)
			let reopened = yield* createViewportSession(url)
			let nextEpoch = crypto.randomUUID()
			let restored = yield* reopened.Open({
				document,
				subject,
				epoch: nextEpoch,
				source: "Unused snapshot",
			})
			if (restored.content !== source)
				return yield* Effect.die(Error("Killed worker lost durable edits"))
			yield* reopened.Close()
			return {
				document,
				checks: 13,
				durableReopen: true,
				characters: source.length,
			}
		}),
	)
}
