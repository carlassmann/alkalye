import * as Rpc from "effect/rpc/Rpc"
import * as RpcGroup from "effect/rpc/RpcGroup"
import * as Schema from "effect/Schema"

export let Replacement = Schema.Struct({
	epoch: Schema.String,
	baseRevision: Schema.Natural,
	sequence: Schema.Natural,
	start: Schema.Natural,
	remove: Schema.Natural,
	text: Schema.String,
})
export let SessionRpc = RpcGroup.make(
	Rpc.make("Open", {
		payload: {
			document: Schema.String,
			subject: Schema.String,
			epoch: Schema.String,
			source: Schema.String,
			origin: Schema.optional(Schema.String),
			create: Schema.optional(Schema.Boolean),
		},
		success: Schema.Struct({
			epoch: Schema.String,
			revision: Schema.Natural,
			content: Schema.String,
		}),
		error: Schema.String,
	}),
	Rpc.make("Replace", {
		payload: Replacement,
		success: Schema.Struct({
			epoch: Schema.String,
			revision: Schema.Natural,
			sequence: Schema.Natural,
			durable: Schema.Boolean,
			milliseconds: Schema.Number,
			patch: Replacement,
		}),
		error: Schema.String,
	}),
	Rpc.make("Read", {
		payload: { epoch: Schema.String },
		success: Schema.Struct({
			epoch: Schema.String,
			revision: Schema.Natural,
			content: Schema.String,
		}),
		error: Schema.String,
	}),
	Rpc.make("Sync", {
		payload: { epoch: Schema.String },
		success: Schema.Struct({
			epoch: Schema.String,
			revision: Schema.Natural,
			content: Schema.String,
		}),
		error: Schema.String,
	}),
	Rpc.make("Close", { success: Schema.Void, error: Schema.String }),
)
