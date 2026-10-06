import * as Effect from "effect/Effect"
import * as Schedule from "effect/Schedule"
import * as Semaphore from "effect/Semaphore"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import type * as Context from "effect/Context"
import { mergeText } from "../shared/text-merge"
import type { DocumentSession } from "./document-session"
import type { LocalDirectories } from "./local-directories"
import { LocalFileUnavailable } from "./local-directories"
import type { Storage } from "./storage"

export type LocalFileSync = Effect.Success<ReturnType<typeof syncLocalFile>>
export interface LocalFileState {
	readonly status: "saved" | "saving" | "conflict" | "reconnect" | "error"
	readonly message?: string
	readonly recovery?: {
		readonly content: string
		readonly source: "editor" | "disk"
	}
}

// Keeps one open document and its file in agreement. Both sides may change:
// the editor through session actions, the disk through other programs. The
// last content both agreed on is the merge base, persisted so a reload can
// still tell which side changed.
export function syncLocalFile(options: {
	document: string
	session: Pick<
		Context.Service.Shape<typeof DocumentSession>,
		"replica" | "change" | "flush" | "changes"
	>
	folders: Pick<
		Context.Service.Shape<typeof LocalDirectories>,
		"read" | "write"
	>
	storage: Pick<Storage, "get" | "set">
}) {
	return Effect.gen(function* () {
		let { session, folders, storage } = options
		let id = options.document
		let baseKey = "local-file-base:" + id
		let stored = yield* storage.get(baseKey)
		let base = typeof stored === "string" ? stored : undefined
		let state = yield* SubscriptionRef.make<LocalFileState>({ status: "saved" })
		let syncing = yield* Semaphore.make(1)
		let reconcile = syncing
			.withPermit(
				Effect.gen(function* () {
					if (SubscriptionRef.getUnsafe(state).status === "conflict") return
					for (let attempt = 0; attempt < 3; attempt++) {
						let disk = yield* folders.read(id)
						let local = session.replica.text(id)
						if (local === disk.content) return yield* settle(disk.content)
						if (base === undefined) return yield* conflict()
						let agreed = base
						let merged = mergeText(agreed, local, disk.content)
						if (merged.conflict) return yield* conflict()
						if (merged.content !== local) {
							let mergeConflict = false
							yield* session
								.change("Merge changes from disk", staged => {
									let result = mergeText(agreed, staged.text(id), disk.content)
									mergeConflict = result.conflict
									return mergeConflict ? [] : [staged.edit(id, result.content)]
								})
								.pipe(
									Effect.catchIf(
										() => mergeConflict,
										() => Effect.void,
									),
								)
							if (mergeConflict) return yield* conflict()
						}
						// A journal commit can yield while another application writes the file.
						let latest = yield* folders.read(id)
						if (latest.content !== disk.content) continue
						let content = session.replica.text(id)
						if (content !== latest.content) {
							yield* publish({ status: "saving" })
							yield* folders
								.write(id, content)
								.pipe(Effect.andThen(settle(content)), Effect.uninterruptible)
						} else yield* settle(content)
						return
					}
					yield* conflict()
				}),
			)
			.pipe(
				Effect.catch(error =>
					publish(
						error instanceof LocalFileUnavailable
							? {
									status: error.reconnect ? "reconnect" : "error",
									message: error.message,
								}
							: {
									status: "error",
									message:
										error instanceof Error
											? error.message
											: "Could not save this file",
								},
					),
				),
			)
		yield* reconcile
		yield* session.changes.pipe(
			Stream.debounce("400 millis"),
			Stream.merge(Stream.fromEventListener(window, "focus")),
			Stream.merge(
				Stream.fromEventListener(document, "visibilitychange").pipe(
					Stream.filter(() => document.visibilityState === "visible"),
				),
			),
			Stream.merge(
				Stream.fromSchedule(Schedule.spaced("3 seconds")).pipe(
					Stream.filter(() => document.visibilityState === "visible"),
				),
			),
			Stream.buffer({ capacity: 1, strategy: "sliding" }),
			Stream.runForEach(() => reconcile),
			Effect.forkScoped({ startImmediately: true }),
		)
		yield* Effect.addFinalizer(() =>
			session.flush.pipe(
				Effect.andThen(reconcile),
				Effect.timeout("5 seconds"),
				Effect.ignore,
			),
		)
		return Object.freeze({
			current: () => SubscriptionRef.getUnsafe(state),
			changes: SubscriptionRef.changes(state),
			reconcile,
			// Either choice keeps the other version as a recovery copy.
			resolve: (choice: "editor" | "disk") =>
				syncing.withPermit(
					Effect.gen(function* () {
						let disk = yield* folders.read(id)
						let local = session.replica.text(id)
						if (choice === "disk") {
							if (local !== disk.content)
								yield* session.change("Use the version on disk", staged => [
									staged.edit(id, disk.content),
								])
							yield* settle(disk.content, { content: local, source: "editor" })
						} else {
							yield* folders.write(id, local)
							yield* settle(local, { content: disk.content, source: "disk" })
						}
					}),
				),
			restoreRecovery: Effect.gen(function* () {
				let recovery = SubscriptionRef.getUnsafe(state).recovery
				if (!recovery) return
				yield* session.change("Restore the other version", staged => [
					staged.edit(id, recovery.content),
				])
				yield* publish({ status: "saved" })
				yield* reconcile
			}),
		})
		function settle(content: string, recovery?: LocalFileState["recovery"]) {
			return Effect.gen(function* () {
				base = content
				yield* storage.set(baseKey, content)
				yield* publish({
					status: "saved",
					recovery: recovery ?? SubscriptionRef.getUnsafe(state).recovery,
				})
			})
		}
		function conflict() {
			return publish({
				status: "conflict",
				message:
					"This file changed on disk and in the editor at the same place",
			})
		}
		function publish(value: LocalFileState) {
			return SubscriptionRef.set(state, Object.freeze(value))
		}
	})
}
