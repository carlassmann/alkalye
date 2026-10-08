import * as Rpc from "effect/rpc/Rpc"
import * as RpcGroup from "effect/rpc/RpcGroup"
import * as Schema from "effect/Schema"

export class WorkerDocumentFailure extends Schema.TaggedError<WorkerDocumentFailure>()(
	"WorkerDocumentFailure",
	{
		reason: Schema.Literals([
			"Closed",
			"AlreadyOpen",
			"HandleUnavailable",
			"HandleCapacity",
			"Rejected",
			"Unsaved",
			"SessionFailure",
		]),
		category: Schema.String,
	},
) {}

let view = Schema.Struct({
	handle: Schema.String,
	revision: Schema.Natural,
	source: Schema.String,
	unsaved: Schema.Natural,
	pending: Schema.Natural,
	rejected: Schema.Natural,
})
export let WorkerDocumentRpc = RpcGroup.make(
	Rpc.make("Open", {
		payload: {
			document: Schema.String,
			subject: Schema.String,
			origin: Schema.String,
		},
		success: view,
		error: WorkerDocumentFailure,
	}),
	Rpc.make("Read", { success: view, error: WorkerDocumentFailure }),
	Rpc.make("Replace", {
		payload: {
			handle: Schema.String,
			ranges: Schema.Array(
				Schema.Struct({
					start: Schema.Natural,
					remove: Schema.Natural,
					text: Schema.String,
				}),
			),
		},
		success: view,
		error: WorkerDocumentFailure,
	}),
	Rpc.make("Release", {
		payload: { handle: Schema.String },
		error: WorkerDocumentFailure,
	}),
	Rpc.make("Sync", { error: WorkerDocumentFailure }),
	Rpc.make("Flush", { error: WorkerDocumentFailure }),
	Rpc.make("Close", { error: WorkerDocumentFailure }),
)
