import * as Schema from "effect/Schema"
import { IdentifierSchema } from "./model"

let coordinate = Schema.Finite.check(
	Schema.isBetween({ minimum: -1_000_000, maximum: 1_000_000 }),
)
let dimension = Schema.Int.check(
	Schema.isBetween({ minimum: 1, maximum: 100_000 }),
)
export let LivePresenceSchema = Schema.Struct({
	actor: Schema.String.check(Schema.isMaxLength(100)),
	name: Schema.String.check(Schema.isMaxLength(100)),
	document: IdentifierSchema,
	cursor: Schema.Natural,
	selectionEnd: Schema.optional(Schema.Natural),
	slide: Schema.Natural,
	item: Schema.optional(Schema.Natural),
	x: coordinate,
	y: coordinate,
	time: Schema.Natural,
	presenting: Schema.optional(Schema.Boolean),
	scroll: Schema.optional(
		Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
	),
	board: Schema.optional(IdentifierSchema),
	boardOpen: Schema.optional(Schema.Boolean),
	drawingActive: Schema.optional(Schema.Boolean),
	movedAt: Schema.optional(Schema.Natural),
	display: Schema.optional(
		Schema.Struct({
			width: dimension,
			height: dimension,
			appearance: Schema.Literals(["light", "dark"]),
		}),
	),
	target: Schema.optional(Schema.String.check(Schema.isMaxLength(100))),
	own: Schema.optional(Schema.Boolean),
})
export type LivePresence = typeof LivePresenceSchema.Type
export let LiveClientMessageSchema = Schema.Union([
	Schema.Struct({ type: Schema.Literal("watch"), document: IdentifierSchema }),
	Schema.Struct({
		type: Schema.Literal("unwatch"),
		document: IdentifierSchema,
	}),
	Schema.Struct({
		type: Schema.Literal("presence"),
		presence: LivePresenceSchema,
	}),
])
export let LiveServerMessageSchema = Schema.Union([
	Schema.Struct({ type: Schema.Literal("heartbeat") }),
	Schema.Struct({ type: Schema.Literal("connected"), actor: IdentifierSchema }),
	Schema.Struct({ type: Schema.Literal("advanced") }),
	Schema.Struct({ type: Schema.Literal("preferences") }),
	Schema.Struct({
		type: Schema.Literal("presence"),
		presence: LivePresenceSchema,
	}),
	Schema.Struct({
		type: Schema.Literal("gone"),
		document: IdentifierSchema,
		actor: IdentifierSchema,
	}),
	Schema.Struct({
		type: Schema.Literal("unavailable"),
		document: IdentifierSchema,
	}),
])
export type LiveServerMessage = typeof LiveServerMessageSchema.Type
export type LiveClientMessage = typeof LiveClientMessageSchema.Type

let pollAccount = Schema.String.check(Schema.isMaxLength(100))
let pollSession = Schema.String.check(Schema.isMaxLength(100))
export let livePollWait = 20_000
export let LivePollRequestSchema = Schema.Struct({
	account: pollAccount,
	session: Schema.optional(pollSession),
})
export let LiveSendRequestSchema = Schema.Struct({
	account: pollAccount,
	session: pollSession,
	messages: Schema.Array(LiveClientMessageSchema).check(Schema.isMaxLength(32)),
})
export let LiveCloseRequestSchema = Schema.Struct({
	account: pollAccount,
	session: pollSession,
})
export let LivePollResponseSchema = Schema.Struct({
	session: pollSession,
	messages: Schema.Array(LiveServerMessageSchema),
})
