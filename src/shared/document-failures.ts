import * as SqlError from "effect/sql/SqlError"
import * as Schema from "effect/Schema"
import * as EventJournal from "effect/eventlog/EventJournal"
import { StorageError } from "../platform/errors"
import {
	BlobFailureSchema,
	isBlobFailure,
	CausalDependencyMissing,
	UndoUnavailable,
} from "./document-errors"
import {
	AccessConflict,
	DocumentConflict,
	DocumentHistoryUnavailable,
} from "./document-actions"

export class LocalDocumentFailure extends Schema.TaggedError<LocalDocumentFailure>()(
	"LocalDocumentFailure",
	{
		operation: Schema.String,
		message: Schema.String,
		retryable: Schema.Boolean,
	},
) {}
export let DocumentFailureSchema = Schema.Union([
	UndoUnavailable,
	CausalDependencyMissing,
	BlobFailureSchema,
	LocalDocumentFailure,
	DocumentConflict,
	DocumentHistoryUnavailable,
	AccessConflict,
])
export type DocumentFailure = typeof DocumentFailureSchema.Type

export function documentFailure(
	operation: string,
	cause: unknown,
): DocumentFailure {
	if (
		cause instanceof UndoUnavailable ||
		cause instanceof CausalDependencyMissing ||
		isBlobFailure(cause) ||
		cause instanceof DocumentConflict ||
		cause instanceof AccessConflict ||
		cause instanceof DocumentHistoryUnavailable ||
		cause instanceof LocalDocumentFailure
	)
		return cause
	let underlying = journalCause(cause)
	return new LocalDocumentFailure({
		operation,
		message:
			underlying instanceof Error
				? underlying.message || underlying.name
				: String(underlying),
		retryable:
			(SqlError.isSqlError(underlying) && underlying.isRetryable) ||
			(underlying instanceof DOMException &&
				["AbortError", "QuotaExceededError", "UnknownError"].includes(
					underlying.name,
				)),
	})
}
function journalCause(cause: unknown) {
	let visited = new Set<unknown>()
	while (
		cause instanceof EventJournal.EventJournalError ||
		cause instanceof StorageError
	) {
		if (visited.has(cause)) return cause
		visited.add(cause)
		cause = cause.cause
	}
	return cause
}
