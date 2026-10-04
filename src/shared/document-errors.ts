import * as Schema from "effect/Schema"
import { IdentifierSchema } from "./model"

export class DocumentConflict extends Schema.TaggedError<DocumentConflict>()(
	"DocumentConflict",
	{ message: Schema.String },
) {}
export let DocumentRevisionSchema = Schema.Struct({
	log: IdentifierSchema,
	position: Schema.Natural,
})
export type DocumentRevision = typeof DocumentRevisionSchema.Type
export class StaleRevision extends Schema.TaggedError<StaleRevision>()(
	"StaleRevision",
	{
		message: Schema.String,
		expected: DocumentRevisionSchema,
		current: DocumentRevisionSchema,
	},
) {}
export class UndoUnavailable extends Schema.TaggedError<UndoUnavailable>()(
	"UndoUnavailable",
	{
		reason: Schema.Literals([
			"BirthRoot",
			"BelowFloor",
			"Exhausted",
			"Stale",
			"Superseded",
		]),
		message: Schema.String,
	},
) {}
export class DocumentHistoryUnavailable extends Schema.TaggedError<DocumentHistoryUnavailable>()(
	"DocumentHistoryUnavailable",
	{
		document: IdentifierSchema,
		reason: Schema.Literals(["EpochChanged", "CursorInvalid", "ActionPruned"]),
		position: Schema.Natural,
		action: Schema.optional(Schema.String),
		message: Schema.String,
	},
) {}
export class ResourceUnavailable extends Schema.TaggedError<ResourceUnavailable>()(
	"ResourceUnavailable",
	{ message: Schema.String },
) {}
export class PermissionDenied extends Schema.TaggedError<PermissionDenied>()(
	"PermissionDenied",
	{ message: Schema.String },
) {}
export class AccessConflict extends Schema.TaggedError<AccessConflict>()(
	"AccessConflict",
	{ message: Schema.String },
) {}
export class BlobBytesMissing extends Schema.TaggedError<BlobBytesMissing>()(
	"BlobBytesMissing",
	{
		document: IdentifierSchema,
		digest: Schema.String,
		message: Schema.String,
	},
) {}
export class CausalDependencyMissing extends Schema.TaggedError<CausalDependencyMissing>()(
	"CausalDependencyMissing",
	{
		document: IdentifierSchema,
		target: IdentifierSchema,
		atom: Schema.String,
		message: Schema.String,
	},
) {}
export class BlobCorrupt extends Schema.TaggedError<BlobCorrupt>()(
	"BlobCorrupt",
	{
		digest: Schema.String,
		message: Schema.String,
	},
) {}
export class BlobQuotaExceeded extends Schema.TaggedError<BlobQuotaExceeded>()(
	"BlobQuotaExceeded",
	{
		scope: Schema.Literals(["document", "account", "server"]),
		limit: Schema.Natural,
		message: Schema.String,
	},
) {}
export let BlobFailureSchema = Schema.Union([
	BlobBytesMissing,
	BlobCorrupt,
	BlobQuotaExceeded,
])
export type BlobFailure = typeof BlobFailureSchema.Type
export function isBlobFailure(value: unknown): value is BlobFailure {
	return (
		value instanceof BlobBytesMissing ||
		value instanceof BlobCorrupt ||
		value instanceof BlobQuotaExceeded
	)
}
