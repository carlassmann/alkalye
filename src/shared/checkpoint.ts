import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import {
	PacketSchema,
	AtomSchema,
	OperationEnvelopeSchema,
	TextAtomIdSchema,
	expandDeletions,
	compactAtoms,
} from "./model"
import { VisibilitySnapshotSchema } from "./text-visibility"
import type { TextVisibilitySnapshot } from "./text-visibility"
import type * as Context from "effect/Context"
import type { Cipher } from "../platform/cipher"
import * as Stream from "effect/Stream"
import { ApplicationError } from "../platform/errors"
import { attempt, promise } from "../platform/effects"
import { decode, encode } from "./base64"
import type { Atom, Operation, Packet } from "./model"
import { identifier, object, parseOperation, string } from "./model"

export let CheckpointEnvelopeSchema = Schema.Struct({
	sequence: Schema.Natural.check(
		Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
	),
	log: Schema.NonEmptyString,
	packet: PacketSchema,
}).check(
	Schema.makeFilter(
		value =>
			value.packet.id === `checkpoint:${value.sequence}` ||
			"Checkpoint identity must match its sequence",
	),
)
export let StoredCheckpointEnvelopeSchema = Schema.Struct({
	...CheckpointEnvelopeSchema.fields,
	packet: Schema.fromJsonString(PacketSchema),
}).pipe(Schema.decodeTo(CheckpointEnvelopeSchema))
export let CheckpointReceiptSchema = Schema.Struct({
	changed: Schema.Boolean,
	checkpoint: Schema.optional(
		Schema.Struct({
			sequence: CheckpointEnvelopeSchema.fields.sequence,
			log: CheckpointEnvelopeSchema.fields.log,
		}),
	),
})
export type CheckpointReceipt = typeof CheckpointReceiptSchema.Type
export type CheckpointEnvelope = typeof CheckpointEnvelopeSchema.Type

export interface LegacyReplicaCheckpoint {
	format: "alkalye-state-v1"
	clock: number
	restored: [string, string][]
	targets: LegacyTargetCheckpoint[]
}
export interface CausalReplicaCheckpoint {
	format: "alkalye-state-v2"
	clock: number
	restored: [string, string][]
	targets: TargetCheckpoint[]
}
export type ReplicaCheckpoint =
	LegacyReplicaCheckpoint | CausalReplicaCheckpoint
interface CommonTargetCheckpoint {
	id: string
	created: number
	updated: number
	atoms: Atom[]
	fields: Operation[]
}
export interface LegacyTargetCheckpoint extends CommonTargetCheckpoint {
	removed: string[]
}
export interface TargetCheckpoint extends CommonTargetCheckpoint {
	visibility: TextVisibilitySnapshot
}
let CheckpointClockSchema = Schema.Natural.check(
	Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
)
let CheckpointAtomSchema = Schema.Struct({
	...AtomSchema.fields,
	id: TextAtomIdSchema,
	after: Schema.Union([Schema.Literal(""), TextAtomIdSchema]),
	value: Schema.String.check(
		Schema.makeFilter(
			value => Array.from(value).length === 1 || "Invalid checkpoint atom",
		),
	),
})
let CommonTargetFields = {
	id: Schema.String,
	created: Schema.Finite,
	updated: Schema.Finite,
	atoms: Schema.Array(CheckpointAtomSchema),
	fields: Schema.Array(OperationEnvelopeSchema),
}
let CommonCheckpointFields = {
	clock: CheckpointClockSchema,
	restored: Schema.Array(Schema.Tuple([TextAtomIdSchema, TextAtomIdSchema])),
}
let LegacyCheckpointSchema = Schema.Struct({
	...CommonCheckpointFields,
	format: Schema.Literal("alkalye-state-v1"),
	targets: Schema.Array(
		Schema.Struct({
			...CommonTargetFields,
			removed: Schema.Array(TextAtomIdSchema),
		}),
	),
})
let CausalCheckpointSchema = Schema.Struct({
	...CommonCheckpointFields,
	format: Schema.Literal("alkalye-state-v2"),
	targets: Schema.Array(
		Schema.Struct({
			...CommonTargetFields,
			visibility: VisibilitySnapshotSchema,
		}),
	),
})

let maximumCompactAtoms = 1_000_000
let CompactAtomSchema = Schema.Struct({
	...CheckpointAtomSchema.fields,
	value: Schema.NonEmptyString.check(Schema.isMaxLength(2_000_000)),
})
let CompactCheckpointSchema = Schema.Struct({
	...CommonCheckpointFields,
	format: Schema.Literal("alkalye-state-v3"),
	targets: Schema.Array(
		Schema.Struct({
			...CommonTargetFields,
			atoms: Schema.Array(CompactAtomSchema),
			visibility: VisibilitySnapshotSchema,
		}),
	),
})
export function compactCheckpoint(
	snapshot: ReplicaCheckpoint,
): ReplicaCheckpoint | typeof CompactCheckpointSchema.Type {
	if (
		snapshot.format === "alkalye-state-v1" ||
		snapshot.targets.reduce((count, target) => count + target.atoms.length, 0) >
			maximumCompactAtoms
	)
		return snapshot
	return {
		format: "alkalye-state-v3",
		clock: snapshot.clock,
		restored: snapshot.restored,
		targets: snapshot.targets.map(target => ({
			...target,
			atoms: compactAtoms(target.atoms),
		})),
	}
}
function expandCompactCheckpoint(
	value: typeof CompactCheckpointSchema.Type,
): CausalReplicaCheckpoint {
	let count = 0
	for (let target of value.targets)
		for (let run of target.atoms)
			for (let _character of run.value) {
				count++
				if (count > maximumCompactAtoms)
					throw new Error("Checkpoint expansion exceeds its atom limit")
			}
	let targets = value.targets.map(target => {
		let atoms: Atom[] = []
		for (let run of target.atoms) {
			let characters = Array.from(run.value)
			let prefix = run.id.slice(0, -8)
			let offset = Number(run.id.slice(-8))
			if (offset + characters.length > 100_000_000)
				throw new Error("Checkpoint insertion exceeds its atom identity range")
			let previous = run.after
			for (let [index, value] of characters.entries()) {
				let id = prefix + String(offset + index).padStart(8, "0")
				atoms.push(
					index === 0 ? { ...run, value } : { id, after: previous, value },
				)
				previous = id
			}
		}
		return {
			id: target.id,
			created: target.created,
			updated: target.updated,
			atoms,
			fields: target.fields.map(parseOperation),
			visibility: target.visibility,
		}
	})
	return {
		format: "alkalye-state-v2",
		clock: value.clock,
		restored: value.restored.map(([left, right]) => [left, right]),
		targets,
	}
}
export function parseCheckpoint(value: unknown): ReplicaCheckpoint {
	let record = object(value)
	if (
		record.format !== "alkalye-state-v1" &&
		record.format !== "alkalye-state-v2" &&
		record.format !== "alkalye-state-v3"
	)
		throw new Error("Unknown checkpoint format")
	let decoded =
		record.format === "alkalye-state-v3"
			? expandCompactCheckpoint(
					Schema.decodeUnknownSync(CompactCheckpointSchema)(value),
				)
			: record.format === "alkalye-state-v1"
				? Schema.decodeUnknownSync(LegacyCheckpointSchema)(value)
				: Schema.decodeUnknownSync(CausalCheckpointSchema)(value)
	let targets = new Set<string>(),
		owners = new Set<string>()
	let operations = new Map<string, { target: string; kind: string }>()
	function claim(operation: string, target: string, kind: string) {
		let previous = operations.get(operation)
		if (
			previous &&
			(previous.target !== target || previous.kind !== kind || kind === "set")
		)
			throw new Error("Checkpoint operation identity is ambiguous")
		operations.set(operation, { target, kind })
	}
	let snapshots = decoded.targets.map(target => {
		let id = identifier(target.id)
		if (targets.has(id)) throw new Error("Duplicate checkpoint target")
		targets.add(id)
		let fields = target.fields.map(parseOperation)
		if (
			new Set(fields.map(field => field.field)).size !== fields.length ||
			fields.some(field => field.kind !== "set" || field.target !== id)
		)
			throw new Error("Invalid checkpoint registers")
		for (let field of fields) claim(field.id, id, "set")
		let atoms = target.atoms.map(atom => ({ ...atom }))
		let indexed = new Map(atoms.map(atom => [atom.id, atom]))
		for (let atom of atoms) {
			if (owners.has(atom.id) || atom.id === atom.after)
				throw new Error("Invalid checkpoint atom identity")
			owners.add(atom.id)
			claim(atom.id.slice(0, -9), id, "text")
			if (atom.after && !indexed.has(atom.after))
				throw new Error("Checkpoint anchor belongs to no atom in this target")
			if (Number(atom.id.slice(0, 16)) > decoded.clock)
				throw new Error("Checkpoint clock precedes an insertion")
		}
		let complete = new Set<string>()
		for (let atom of atoms) {
			let path = new Set<string>(),
				next = atom.id
			while (next && !complete.has(next)) {
				if (path.has(next)) throw new Error("Checkpoint anchor cycle")
				path.add(next)
				next = indexed.get(next)?.after ?? ""
			}
			for (let id of path) complete.add(id)
		}
		if (fields.some(field => field.clock > decoded.clock))
			throw new Error("Checkpoint clock precedes a register")
		let common = {
			id,
			created: target.created,
			updated: target.updated,
			atoms,
			fields,
		}
		if ("removed" in target) {
			if (target.removed.some(id => !indexed.has(id)))
				throw new Error("Unknown legacy checkpoint deletion")
			return { ...common, removed: [...target.removed] }
		}
		let visibility = target.visibility
		let known = new Set(atoms.map(atom => atom.id.slice(0, -9)))
		let removers = new Set<string>(),
			cancels = new Set<string>()
		for (let [id, runs] of visibility.removals) {
			if (removers.has(id))
				throw new Error("Duplicate checkpoint removal identity")
			removers.add(id)
			claim(id, common.id, "text")
			known.add(id)
			for (let atom of expandDeletions(runs))
				if (!indexed.has(atom)) throw new Error("Unknown checkpoint deletion")
		}
		for (let [id] of visibility.cancels) {
			if (cancels.has(id) || known.has(id))
				throw new Error("Duplicate checkpoint cancellation identity")
			cancels.add(id)
			claim(id, common.id, "cancel")
		}
		for (let id of cancels) known.add(id)
		if (
			visibility.floor > decoded.clock ||
			[...known].some(id => Number(id.slice(0, 16)) > decoded.clock)
		)
			throw new Error("Checkpoint clock precedes its causal facts")
		for (let atom of expandDeletions(visibility.legacyRemoved))
			if (!indexed.has(atom))
				throw new Error("Unknown legacy checkpoint deletion")
		for (let [id, original] of visibility.cancels) {
			if (
				!known.has(original) ||
				Number(original.slice(0, 16)) >= Number(id.slice(0, 16))
			)
				throw new Error("Invalid checkpoint cancellation target")
			if (Number(original.slice(0, 16)) <= visibility.floor)
				throw new Error("Checkpoint cancellation crosses its migration floor")
		}
		return { ...common, visibility }
	})
	let restored: [string, string][] = decoded.restored.map(
		([previous, current]) => [previous, current],
	)
	let aliases = new Map(restored)
	if (aliases.size !== restored.length)
		throw new Error("Duplicate restored atom identity")
	let checked = new Set<string>()
	for (let [previous, current] of restored) {
		if (!owners.has(previous) || !owners.has(current))
			throw new Error("Unknown restored atom identity")
		let path = new Set<string>(),
			next = previous
		while (next && !checked.has(next)) {
			if (path.has(next)) throw new Error("Restored atom identity cycle")
			path.add(next)
			next = aliases.get(next) ?? ""
		}
		for (let id of path) checked.add(id)
	}
	for (let [previous, current] of restored)
		if (Number(current.slice(0, 16)) <= Number(previous.slice(0, 16)))
			throw new Error("Restored atom identities must advance their clock")
	if (decoded.format === "alkalye-state-v1") {
		return {
			format: decoded.format,
			clock: decoded.clock,
			restored,
			targets: snapshots.map(target => {
				if (!("removed" in target))
					throw new Error("Invalid legacy checkpoint target")
				return target
			}),
		}
	}
	return {
		format: decoded.format,
		clock: decoded.clock,
		restored,
		targets: snapshots.map(target => {
			if (!("visibility" in target))
				throw new Error("Invalid causal checkpoint target")
			return target
		}),
	}
}
export function sealCheckpoint(
	key: string,
	id: string,
	snapshot: ReplicaCheckpoint,
	room: string,
	cipher: Pick<Context.Service.Shape<typeof Cipher>, "seal">,
) {
	return Effect.gen(function* () {
		let source = new Blob([JSON.stringify(snapshot)])
			.stream()
			.pipeThrough(new CompressionStream("gzip"))
		let bytes = yield* promise("checkpoint.compress", () =>
			new Response(source).arrayBuffer(),
		)
		return yield* cipher.seal(
			key,
			id,
			{ format: "alkalye-gzip-v1", body: encode(new Uint8Array(bytes)) },
			room,
		)
	})
}
export function openCheckpoint(
	key: string,
	packet: Packet,
	room: string,
	cipher: Pick<Context.Service.Shape<typeof Cipher>, "open">,
) {
	return cipher.open(key, packet, room).pipe(Effect.flatMap(decodeCheckpoint))
}
export function decodeCheckpoint(value: unknown) {
	return Effect.gen(function* () {
		let compressed = yield* attempt("checkpoint.header", () => {
			let record = object(value)
			if (record.format !== "alkalye-gzip-v1")
				throw new Error("Unknown compressed checkpoint")
			return decode(string(record.body))
		})
		let size = 0
		let chunks = yield* Stream.fromReadableStream({
			evaluate: () =>
				new Blob([compressed])
					.stream()
					.pipeThrough(new DecompressionStream("gzip")),
			onError: cause =>
				new ApplicationError({ operation: "checkpoint.decompress", cause }),
		}).pipe(
			Stream.mapEffect(bytes =>
				attempt("checkpoint.size", () => {
					size += bytes.length
					if (size > 64_000_000) throw new Error("Checkpoint exceeds 64 MB")
					return new Uint8Array(bytes)
				}),
			),
			Stream.runCollect,
		)
		let bytes = yield* promise("checkpoint.decode", () =>
			new Blob([...chunks]).text(),
		)
		return yield* attempt("checkpoint.parse", () =>
			parseCheckpoint(JSON.parse(bytes)),
		)
	})
}

export interface StoredCheckpoint {
	witness?: Packet
	snapshot: ReplicaCheckpoint
	sequence: number
	log: string
	remoteHistory: boolean
}
