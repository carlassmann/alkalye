import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Queue from "effect/Queue"
import * as Option from "effect/Option"
import * as Schedule from "effect/Schedule"
import * as Semaphore from "effect/Semaphore"
import * as SubscriptionRef from "effect/SubscriptionRef"
import { documentFailureCategory } from "./document-observability"
import { LocalDocumentFailure, documentFailure } from "./document-failures"
import type { DocumentFailure } from "./document-failures"
import type { BlobFailure } from "./document-errors"

export interface DocumentFailures {
	readonly save?: DocumentFailure
	readonly projection?: DocumentFailure
	readonly snapshot?: DocumentFailure
	readonly notification?: DocumentFailure
	readonly synchronization?: BlobFailure
}
type RecoveryKind = Exclude<keyof DocumentFailures, "synchronization">
type RecoveryWork = Record<RecoveryKind, Effect.Effect<unknown, unknown>>

export function makeDocumentRecovery(
	work: RecoveryWork,
	locks: Partial<Record<RecoveryKind, Semaphore.Semaphore>> = {},
	ready: Partial<Record<RecoveryKind, Effect.Effect<void>>> = {},
) {
	return Effect.gen(function* () {
		let failures = yield* SubscriptionRef.make<DocumentFailures>(
			Object.freeze({}),
		)
		let requests = {
			save: yield* Queue.dropping<void>(1),
			projection: yield* Queue.dropping<void>(1),
			snapshot: yield* Queue.dropping<void>(1),
			notification: yield* Queue.dropping<void>(1),
		}
		for (let kind of [
			"save",
			"projection",
			"snapshot",
			"notification",
		] satisfies RecoveryKind[]) {
			yield* Effect.addFinalizer(() => Queue.shutdown(requests[kind]))
			let policy = Schedule.min([
				Schedule.exponential("100 millis"),
				Schedule.spaced(kind === "snapshot" ? "30 seconds" : "2 seconds"),
			]).pipe(Schedule.jittered)
			yield* Queue.take(requests[kind]).pipe(
				Effect.andThen(
					Effect.suspend(() => {
						if (!retryable(SubscriptionRef.getUnsafe(failures)[kind]))
							return Effect.void
						return Effect.sleep("100 millis").pipe(
							Effect.andThen(
								trackDefault(kind).pipe(
									Effect.retry({ schedule: policy, while: retryable }),
									Effect.catch(error =>
										Effect.logError("Document recovery needs attention", {
											category: documentFailureCategory(error),
											operation: kind,
										}),
									),
								),
							),
						)
					}),
				),
				Effect.forever,
				Effect.forkScoped({ startImmediately: true }),
			)
		}
		return {
			failures: Object.freeze({
				current: () => SubscriptionRef.getUnsafe(failures),
				changes: SubscriptionRef.changes(failures),
			}),
			attempt,
			run: (kind: RecoveryKind, task?: Effect.Effect<unknown, unknown>) =>
				attempt(kind, task).pipe(
					Effect.catch(error =>
						Effect.logError("Document recovery required", {
							category: documentFailureCategory(error),
							operation: kind,
						}),
					),
				),
			saveFailure: (failure?: DocumentFailure) => setFailure("save", failure),
			synchronizationFailure: (failure?: BlobFailure) =>
				SubscriptionRef.updateSome(failures, current =>
					current.synchronization === failure
						? Option.none()
						: Option.some(
								Object.freeze({ ...current, synchronization: failure }),
							),
				),
		}
		function attempt(
			kind: RecoveryKind,
			task?: Effect.Effect<unknown, unknown>,
		) {
			return (task ? track(kind, task) : trackDefault(kind)).pipe(
				Effect.tapError(error =>
					Effect.sync(() => {
						if (retryable(error)) Queue.offerUnsafe(requests[kind], undefined)
					}),
				),
			)
		}
		function trackDefault(kind: RecoveryKind) {
			let task = track(kind, work[kind])
			return (ready[kind] ?? Effect.void).pipe(
				Effect.andThen(locks[kind]?.withPermit(task) ?? task),
			)
		}
		function track(kind: RecoveryKind, task: Effect.Effect<unknown, unknown>) {
			return Effect.suspend(() => {
				let startedFailure = SubscriptionRef.getUnsafe(failures)[kind]
				return task.pipe(
					Effect.flatMap(outcome => {
						if (
							kind === "snapshot" &&
							Option.isOption(outcome) &&
							Option.isNone(outcome)
						) {
							let pendingFailure = SubscriptionRef.getUnsafe(failures)[kind]
							return pendingFailure ? Effect.fail(pendingFailure) : Effect.void
						}
						return SubscriptionRef.modifySome(failures, current => {
							if (current[kind] !== startedFailure)
								return [current[kind], Option.none()]
							return [
								undefined,
								current[kind] === undefined
									? Option.none()
									: Option.some(
											Object.freeze({ ...current, [kind]: undefined }),
										),
							]
						}).pipe(
							Effect.flatMap(newerFailure =>
								newerFailure ? Effect.fail(newerFailure) : Effect.void,
							),
						)
					}),
					Effect.catchCause(cause => {
						if (Cause.hasInterrupts(cause)) return Effect.interrupt
						let failure = documentFailure(kind, Cause.squash(cause))
						return setFailure(kind, failure).pipe(
							Effect.andThen(Effect.fail(failure)),
						)
					}),
				)
			})
		}
		function setFailure(
			kind: keyof DocumentFailures,
			failure?: DocumentFailure,
		) {
			return SubscriptionRef.updateSome(failures, current =>
				current[kind] === failure
					? Option.none()
					: Option.some(
							Object.freeze({
								...current,
								[kind]: failure ? Object.freeze(failure) : undefined,
							}),
						),
			)
		}
	})
}

function retryable(failure: unknown) {
	return failure instanceof LocalDocumentFailure && failure.retryable
}
