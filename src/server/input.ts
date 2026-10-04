import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { CheckpointEnvelopeSchema } from "../shared/checkpoint"
import { PacketSchema, RoomSchema, parseRoom } from "../shared/model"

export let object = Schema.decodeUnknownEffect(
	Schema.Record(Schema.String, Schema.Unknown),
)
export let string = Schema.decodeUnknownEffect(Schema.String)
export let array = Schema.decodeUnknownEffect(Schema.Array(Schema.Unknown))
export let packet = Schema.decodeUnknownEffect(PacketSchema)
export let packets = Schema.decodeUnknownEffect(Schema.Array(PacketSchema))
let roomRecords = Schema.decodeUnknownEffect(Schema.Array(RoomSchema))
export function rooms(value: unknown) {
	return roomRecords(value).pipe(Effect.map(records => records.map(parseRoom)))
}

export let checkpoint = Schema.decodeUnknownEffect(CheckpointEnvelopeSchema)
