import { expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Schema from "effect/Schema"
import {
	PacketSchema,
	RoleSchema,
	parsePacket,
	parseRole,
	parseRoom,
	parsePresence,
	parseOperation,
	compactOperation,
	RoomSchema,
	PresenceSchema,
	OperationEnvelopeSchema,
} from "../src/shared/model"

test("encrypted packet decoding preserves compatible packets and rejects malformed envelopes", async () => {
	let packet = { id: "actor:1", iv: "AAAAAAAAAAAAAAAA", body: "encrypted" }
	expect(parsePacket({ ...packet, legacy: "ignored" })).toEqual(packet)
	for (let invalid of [
		null,
		[],
		{},
		{ ...packet, id: "../other-room" },
		{ ...packet, iv: "short" },
		{ ...packet, body: 42 },
		{ ...packet, body: "x".repeat(8_000_001) },
	]) {
		let result = await Effect.runPromise(
			Schema.decodeUnknownEffect(PacketSchema)(invalid).pipe(Effect.exit),
		)
		expect(Exit.isFailure(result)).toBe(true)
	}
})

test("workspace roles use the same schema across synchronous and Effect boundaries", async () => {
	for (let role of ["reader", "writer", "manager", "admin"]) {
		expect(role).toBe(parseRole(role))
		expect(role).toBe(
			await Effect.runPromise(Schema.decodeUnknownEffect(RoleSchema)(role)),
		)
	}
	for (let role of ["owner", "ADMIN", "", null, 1])
		expect(() => parseRole(role)).toThrow()
})

test("room decoding preserves legacy flag normalization without accepting missing credentials", async () => {
	let room = {
		id: "room:one",
		key: "key",
		read: "reader",
		write: "",
		admin: "",
		name: "Room",
	}
	expect(parseRoom(room)).toEqual({ ...room, local: false })
	expect(parseRoom({ ...room, local: "true", personal: 1 })).toEqual({
		...room,
		local: false,
	})
	expect(parseRoom({ ...room, local: true, personal: true })).toEqual({
		...room,
		local: true,
		personal: true,
	})
	for (let invalid of [
		null,
		[],
		{ ...room, id: "../private" },
		{ ...room, key: null },
		{ ...room, read: undefined },
	]) {
		expect(() => parseRoom(invalid)).toThrow()
		expect(
			Exit.isFailure(
				await Effect.runPromise(
					Schema.decodeUnknownEffect(RoomSchema)(invalid).pipe(Effect.exit),
				),
			),
		).toBe(true)
	}
})

test("presence uses finite coordinates and compatible defaults for older clients", async () => {
	let presence = {
		actor: "actor",
		name: "Writer",
		document: "doc",
		cursor: 12,
		slide: 0,
		x: 0.5,
		y: 0.25,
		time: 10,
	}
	expect(parsePresence(presence)).toEqual({
		...presence,
		presenting: false,
		boardOpen: false,
		drawingActive: false,
		board: "",
		selectionEnd: 12,
		scroll: 0,
	})
	expect(
		parsePresence({
			...presence,
			selectionEnd: null,
			board: null,
			scroll: null,
		}).selectionEnd,
	).toBe(12)
	for (let field of [
		"cursor",
		"selectionEnd",
		"scroll",
		"slide",
		"x",
		"y",
		"time",
	])
		for (let value of [NaN, Infinity, -Infinity, "12"])
			expect(
				Exit.isFailure(
					await Effect.runPromise(
						Schema.decodeUnknownEffect(PresenceSchema)({
							...presence,
							[field]: value,
						}).pipe(Effect.exit),
					),
				),
			).toBe(true)
})

test("operation schema accepts compact Unicode runs and rejects invalid deletion envelopes", async () => {
	let id = "0000000000000001:writer"
	let first = id + ":00000000"
	let operation = {
		id,
		clock: 1,
		actor: "writer",
		time: 10,
		author: "Writer",
		target: "doc",
		kind: "text",
		insert: [{ id: first, after: "", value: "A🦊B" }],
		remove: [{ id: "0000000000000002:other:00000003", count: 3 }],
		field: "",
		value: "",
	}
	let decoded = parseOperation(operation)
	expect(decoded.insert.map(atom => atom.value)).toEqual(["A", "🦊", "B"])
	expect(decoded.insert[1]?.after).toBe(first)
	expect(decoded.remove).toHaveLength(3)
	expect(parseOperation(compactOperation(decoded))).toEqual(decoded)
	for (let remove of [
		[{ id: first, count: 0 }],
		[{ id: first, count: 1.5 }],
		[{ id: first, count: 2_000_001 }],
		[{ id: "invalid", count: 1 }],
		[null],
	])
		expect(
			Exit.isFailure(
				await Effect.runPromise(
					Schema.decodeUnknownEffect(OperationEnvelopeSchema)({
						...operation,
						remove,
					}).pipe(Effect.exit),
				),
			),
		).toBe(true)
	for (let invalid of [
		{ ...operation, clock: NaN },
		{ ...operation, kind: "erase" },
		{ ...operation, target: "<script>" },
		{ ...operation, insert: [{ id: first, after: "", value: 1 }] },
	])
		expect(() => parseOperation(invalid)).toThrow()
	for (let invalid of [
		{ ...operation, clock: 2 },
		{ ...operation, insert: [{ id: first, after: first, value: "A" }] },
		{
			...operation,
			insert: [
				{ id: first, after: "", value: "A" },
				{ id: first, after: "", value: "B" },
			],
		},
	])
		expect(() => parseOperation(invalid)).toThrow()
})
