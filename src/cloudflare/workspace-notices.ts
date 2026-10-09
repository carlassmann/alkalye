import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as PubSub from "effect/PubSub"
import * as Schema from "effect/Schema"

export let WorkspaceNoticeSchema = Schema.Union([
	Schema.Struct({
		kind: Schema.Literal("document"),
		document: Schema.String,
		subjects: Schema.Array(Schema.String),
	}),
	Schema.Struct({
		kind: Schema.Literal("workspace"),
		subjects: Schema.Array(Schema.String),
		documents: Schema.Array(Schema.String),
	}),
	Schema.Struct({
		kind: Schema.Literal("preferences"),
		subject: Schema.String,
		subjects: Schema.Array(Schema.String),
	}),
])
export type WorkspaceNotice = typeof WorkspaceNoticeSchema.Type

export class WorkspaceNotices extends Context.Service<
	WorkspaceNotices,
	Effect.Success<ReturnType<typeof makeNotices>>
>()("CloudflareWorkspaceNotices") {
	static layer = Layer.effect(WorkspaceNotices, makeNotices())
}

function makeNotices() {
	return Effect.gen(function* () {
		let notices = yield* PubSub.sliding<WorkspaceNotice>(64)
		yield* Effect.addFinalizer(() => PubSub.shutdown(notices))
		return {
			publish: (notice: WorkspaceNotice) => PubSub.publish(notices, notice),
			subscribe: PubSub.subscribe(notices),
		}
	})
}
