import * as Cause from "effect/Cause"
import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Headers from "effect/http/Headers"
import { accountHeader } from "./authentication"
import * as Metric from "effect/Metric"
import * as Option from "effect/Option"
import * as Ref from "effect/Ref"

export type DocumentBoundary = "client" | "server"
export type DocumentOperation =
	| "open"
	| "sync"
	| "create"
	| "snapshot"
	| "commit"
	| "withdraw"
	| "history"
	| "action"
	| "chain"
	| "other"

export class DocumentObservability extends Context.Service<
	DocumentObservability,
	Effect.Success<ReturnType<typeof makeDocumentObservability>>
>()("alkalye/DocumentObservability") {
	static layer(boundary: DocumentBoundary) {
		return Layer.effect(
			DocumentObservability,
			makeDocumentObservability(boundary),
		)
	}
}

export function makeDocumentObservability(boundary: DocumentBoundary) {
	return Effect.gen(function* () {
		let registry: Metric.MetricRegistry = new Map()
		let alerts = yield* Ref.make(new Map<DocumentOperation, number>())
		let outages = yield* Ref.make(new Set<DocumentOperation>())
		let calls = Metric.counter("alkalye_document_calls", {
			description:
				"Completed document operations, including failed and interrupted calls",
			attributes: { boundary },
		})
		let duration = Metric.histogram("alkalye_document_duration_ms", {
			description: "Document boundary latency in milliseconds",
			attributes: { boundary },
			boundaries: [10, 25, 50, 100, 250, 500, 1000, 2000, 5000, 10000, 20000],
		})
		function observe(operation: DocumentOperation) {
			return function <A, E, R>(work: Effect.Effect<A, E, R>) {
				return Effect.gen(function* () {
					let started = yield* Clock.currentTimeNanos
					return yield* work.pipe(
						Effect.onExit(exit =>
							Effect.gen(function* () {
								let ended = yield* Clock.currentTimeNanos
								let elapsed = Number(ended - started) / 1_000_000
								let outcome = observationOutcome(exit)
								yield* Effect.annotateCurrentSpan("outcome", outcome)
								let span = yield* Effect.currentSpan.pipe(Effect.option)
								let correlation = Option.isSome(span)
									? { traceId: span.value.traceId, spanId: span.value.spanId }
									: {}
								yield* Metric.update(
									Metric.withAttributes(calls, { operation, outcome }),
									1,
								)
								yield* Metric.update(
									Metric.withAttributes(duration, { operation }),
									elapsed,
								)
								let changed = yield* Ref.modify(outages, current => {
									let next = new Set(current)
									if (outcome === "storage") next.add(operation)
									else if (outcome === "success") next.delete(operation)
									return [current.has(operation) !== next.has(operation), next]
								})
								if (changed && boundary === "server")
									yield* (
										outcome === "storage"
											? Effect.logError("Document storage unavailable")
											: Effect.logInfo("Document storage recovered")
									).pipe(
										Effect.annotateLogs({
											boundary,
											...correlation,
											operation,
											outcome,
										}),
									)
								if (elapsed < 2000 || outcome !== "success") return
								let now = yield* Clock.currentTimeMillis
								let alert = yield* Ref.modify(alerts, current => {
									let previous = current.get(operation)
									if (previous !== undefined && now - previous < 60_000)
										return [false, current]
									return [true, new Map(current).set(operation, now)]
								})
								if (alert)
									yield* Effect.logWarning("Slow document operation").pipe(
										Effect.annotateLogs({
											boundary,
											...correlation,
											operation,
											outcome,
											durationMs: Math.round(elapsed),
										}),
									)
							}).pipe(Effect.provideService(Metric.MetricRegistry, registry)),
						),
					)
				}).pipe(
					Effect.withSpan("document." + operation, {
						attributes: { boundary },
					}),
					Effect.provideService(Headers.CurrentRedactedNames, [
						"authorization",
						"cookie",
						"set-cookie",
						"x-api-key",
						accountHeader,
					]),
				)
			}
		}
		return {
			observe,
			snapshot: Metric.snapshot.pipe(
				Effect.provideService(Metric.MetricRegistry, registry),
			),
		}
	})
}

function observationOutcome<A, E>(exit: Exit.Exit<A, E>) {
	if (Exit.isSuccess(exit)) return "success"
	if (Cause.hasInterruptsOnly(exit.cause)) return "interrupted"
	let failure = Cause.findErrorOption(exit.cause)
	if (Option.isNone(failure)) return "defect"
	return documentFailureCategory(failure.value)
}

export function documentFailureCategory(error: unknown) {
	if (Cause.isTimeoutError(error)) return "network"
	let tag =
		typeof error === "object" && error !== null && "_tag" in error
			? error._tag
			: undefined
	switch (tag) {
		case "PermissionDenied":
		case "AuthenticationRequired":
		case "ResourceUnavailable":
			return "access"
		case "AccessConflict":
		case "DocumentConflict":
		case "StaleRevision":
		case "UndoUnavailable":
		case "CausalDependencyMissing":
			return "conflict"
		case "LocalDocumentFailure":
		case "StoreUnavailable":
		case "SqlError":
			return "storage"
		case "HttpClientError":
		case "TimeoutError":
			return "network"
		default:
			return "failure"
	}
}
