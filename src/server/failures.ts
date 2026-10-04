import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as SqlError from "effect/sql/SqlError"
import { CryptoError, StorageError } from "../platform/errors"

export function decodeStored<A, E, R>(effect: Effect.Effect<A, E, R>) {
	return effect.pipe(
		Effect.mapError(cause =>
			Schema.isSchemaError(cause) ||
			Cause.isNoSuchElementError(cause) ||
			cause instanceof CryptoError
				? new StorageError({ operation: "decode stored data", cause })
				: cause,
		),
	)
}
export function isInfrastructureFailure(cause: Cause.Cause<unknown>) {
	return (
		Cause.hasDies(cause) ||
		cause.reasons.some(
			reason =>
				Cause.isFailReason(reason) &&
				(reason.error instanceof StorageError ||
					reason.error instanceof CryptoError ||
					SqlError.isSqlError(reason.error)),
		)
	)
}
