import * as Effect from "effect/Effect"
import { DocumentConflict } from "./document-errors"
import { partitionTextOperations } from "./text-dependencies"
import { parseOperation } from "./model"
import type { Replica } from "./crdt"
import type { Operation } from "./model"

interface Rejection<Input> {
	operation: Input
	message: string
}

export function planTextAdmission<Input>(
	replica: Replica,
	input: readonly Input[],
) {
	return Effect.gen(function* () {
		let candidates: Operation[] = [],
			originals = new Map<Operation, Input>(),
			rejected: Rejection<Input>[] = []
		for (let operation of input) {
			let decoded = yield* attempt(() => parseOperation(operation)).pipe(
				Effect.result,
			)
			if (decoded._tag === "Failure")
				rejected.push({ operation, message: decoded.failure.message })
			else {
				candidates.push(decoded.success)
				originals.set(decoded.success, operation)
			}
		}
		let checked = yield* validate(replica, candidates).pipe(Effect.result)
		if (checked._tag === "Failure") {
			let healthy: Operation[] = [],
				known = new Map<string, Operation>()
			for (let operation of candidates) {
				let previous = known.get(operation.id)
				let checked = yield* validate(
					replica,
					previous ? [previous, operation] : [operation],
				).pipe(Effect.result)
				if (checked._tag === "Failure")
					rejected.push({
						operation: original(operation),
						message: checked.failure.message,
					})
				else {
					healthy.push(operation)
					known.set(operation.id, operation)
				}
			}
			candidates = healthy
			yield* validate(replica, candidates)
		}
		while (true) {
			let partition = yield* partitionTextOperations(replica, candidates)
			if (!partition.rejected.length) {
				yield* validate(replica, partition.ready)
				return {
					ready: partition.ready.map(original),
					deferred: partition.deferred.map(original),
					rejected,
				}
			}
			let invalid = new Map(
				partition.rejected.map(value => [value.operation.id, value.message]),
			)
			for (let operation of candidates) {
				let message = invalid.get(operation.id)
				if (message !== undefined)
					rejected.push({ operation: original(operation), message })
			}
			candidates = candidates.filter(operation => !invalid.has(operation.id))
		}
		function original(operation: Operation): Input {
			let value = originals.get(operation)
			if (value === undefined)
				throw new Error("Admission lost its input association")
			return value
		}
	})
}

function validate(replica: Replica, operations: Operation[]) {
	return attempt(() => replica.validate(operations))
}
function attempt<A>(work: () => A) {
	return Effect.try({
		try: work,
		catch: cause =>
			new DocumentConflict({
				message:
					cause instanceof Error ? cause.message : "Invalid operation identity",
			}),
	})
}
