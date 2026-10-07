import * as Rpc from "effect/rpc/Rpc"
import * as RpcGroup from "effect/rpc/RpcGroup"
import * as Schema from "effect/Schema"

let counts = Schema.Struct({
	words: Schema.Natural,
	sentences: Schema.Natural,
	tasks: Schema.Natural,
	completedTasks: Schema.Natural,
})
export let DocumentDerivationsRpc = RpcGroup.make(
	Rpc.make("Reset", {
		payload: { revision: Schema.Natural, source: Schema.String },
		success: Schema.Struct({ revision: Schema.Natural, counts }),
		error: Schema.Literals([
			"Revision unavailable",
			"Replacement outside document",
		]),
	}),
	Rpc.make("Replace", {
		payload: {
			baseRevision: Schema.Natural,
			revision: Schema.Natural,
			start: Schema.Natural,
			end: Schema.Natural,
			insert: Schema.String,
		},
		success: Schema.Struct({ revision: Schema.Natural, counts }),
		error: Schema.Literals([
			"Revision unavailable",
			"Replacement outside document",
		]),
	}),
)
