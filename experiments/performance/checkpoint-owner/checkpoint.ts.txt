import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import {
	PacketSchema,
	AtomSchema,
	OperationEnvelopeSchema,
	TextAtomIdSchema,
	deletionIds,
	compactAtomSteps,
} from "./model"
import {
	VisibilitySnapshotSchema,
	decodeVisibilitySnapshotSteps,
} from "./text-visibility"
import type { TextVisibilitySnapshot } from "./text-visibility"
import type * as Context from "effect/Context"
import type { Cipher } from "../platform/cipher"
import * as Stream from "effect/Stream"
import { ApplicationError } from "../platform/errors"
import { attempt, promise, cooperative } from "../platform/effects"
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

let maximumCompactAtoms = 2_000_000
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
	let steps = compactCheckpointSteps(snapshot, false)
	let next = steps.next()
	while (!next.done) next = steps.next()
	return next.value
}
export function compactCheckpointEffect(snapshot: ReplicaCheckpoint) {
	return cooperative("checkpoint.compact", () =>
		compactCheckpointSteps(snapshot, true),
	)
}
function* compactCheckpointSteps(
	snapshot: ReplicaCheckpoint,
	cooperative: boolean,
): Generator<void, ReplicaCheckpoint | typeof CompactCheckpointSchema.Type> {
	if (
		snapshot.format === "alkalye-state-v1" ||
		snapshot.targets.reduce((count, target) => count + target.atoms.length, 0) >
			maximumCompactAtoms
	)
		return snapshot
	let targets: (typeof CompactCheckpointSchema.Type.targets)[number][] = []
	for (let target of snapshot.targets)
		targets.push({
			...target,
			atoms: yield* compactAtomSteps(target.atoms, cooperative),
		})
	return {
		format: "alkalye-state-v3",
		clock: snapshot.clock,
		restored: snapshot.restored,
		targets,
	}
}

let CheckpointHeaderFields = {
	clock: CheckpointClockSchema,
	restored: Schema.Array(Schema.Unknown),
	targets: Schema.Array(Schema.Unknown),
}
let CheckpointTargetFields = {
	id: CommonTargetFields.id,
	created: CommonTargetFields.created,
	updated: CommonTargetFields.updated,
	atoms: Schema.Array(Schema.Unknown),
	fields: Schema.Array(Schema.Unknown),
}
let LegacyHeaderSchema = Schema.Struct({
	...CheckpointHeaderFields,
	format: LegacyCheckpointSchema.fields.format,
})
let CausalHeaderSchema = Schema.Struct({
	...CheckpointHeaderFields,
	format: CausalCheckpointSchema.fields.format,
})
let CompactHeaderSchema = Schema.Struct({
	...CheckpointHeaderFields,
	format: CompactCheckpointSchema.fields.format,
})
let LegacyTargetHeaderSchema = Schema.Struct({
	...CheckpointTargetFields,
	removed: Schema.Array(Schema.Unknown),
})
let CausalTargetHeaderSchema = Schema.Struct({
	...CheckpointTargetFields,
	visibility: Schema.Unknown,
})
let RestoredIdentitySchema = Schema.Tuple([TextAtomIdSchema, TextAtomIdSchema])
function* decodeCheckpointArray<A>(
	values: readonly unknown[],
	decode: (value: unknown) => A,
): Generator<void, A[]> {
	let decoded: A[] = []
	for (let value of values) {
		decoded.push(decode(value))
		if (decoded.length % 128 === 0) yield
	}
	return decoded
}
function copyCheckpointAtom(atom: Atom): Atom {
	return {
		...atom,
		...(atom.order ? { order: [...atom.order] } : {}),
		...(atom.observed ? { observed: [...atom.observed] } : {}),
		...(atom.deleted ? { deleted: [...atom.deleted] } : {}),
	}
}
function decodeRestoredIdentity(value: unknown): [string, string] {
	let [previous, current] = Schema.decodeUnknownSync(RestoredIdentitySchema)(
		value,
	)
	return [previous, current]
}
let decodeCheckpointAtomValue = Schema.decodeUnknownSync(CheckpointAtomSchema)
let decodeCompactAtomValue = Schema.decodeUnknownSync(CompactAtomSchema)
function decodeCheckpointAtom(value: unknown) {
	return copyCheckpointAtom(decodeCheckpointAtomValue(value))
}
function decodeCompactAtom(value: unknown) {
	return copyCheckpointAtom(decodeCompactAtomValue(value))
}
function copyVisibility(
	visibility: TextVisibilitySnapshot,
): TextVisibilitySnapshot {
	return {
		floor: visibility.floor,
		legacyRemoved: visibility.legacyRemoved.map(run =>
			typeof run === "string" ? run : { ...run },
		),
		removals: visibility.removals.map(([id, runs]) => [
			id,
			[
				typeof runs[0] === "string" ? runs[0] : { ...runs[0] },
				...runs
					.slice(1)
					.map(run => (typeof run === "string" ? run : { ...run })),
			],
		]),
		cancels: visibility.cancels.map(([id, original]) => [id, original]),
	}
}
function* decodeLegacyCheckpointSteps(
	value: unknown,
): Generator<void, typeof LegacyCheckpointSchema.Type> {
	let header = Schema.decodeUnknownSync(LegacyHeaderSchema)(value)
	let restored = yield* decodeCheckpointArray(
		header.restored,
		decodeRestoredIdentity,
	)
	let targets: (typeof LegacyCheckpointSchema.Type.targets)[number][] = []
	for (let value of header.targets) {
		let target = Schema.decodeUnknownSync(LegacyTargetHeaderSchema)(value)
		let removed = yield* decodeCheckpointArray(
			target.removed,
			Schema.decodeUnknownSync(TextAtomIdSchema),
		)
		let atoms = yield* decodeCheckpointArray(target.atoms, decodeCheckpointAtom)
		let fields = yield* decodeCheckpointArray(target.fields, parseOperation)
		targets.push({ ...target, atoms, fields, removed })
	}
	return { ...header, restored, targets }
}
function* decodeCausalCheckpointSteps(
	value: unknown,
): Generator<void, typeof CausalCheckpointSchema.Type> {
	let header = Schema.decodeUnknownSync(CausalHeaderSchema)(value)
	let restored = yield* decodeCheckpointArray(
		header.restored,
		decodeRestoredIdentity,
	)
	let targets: (typeof CausalCheckpointSchema.Type.targets)[number][] = []
	for (let value of header.targets) {
		let target = Schema.decodeUnknownSync(CausalTargetHeaderSchema)(value)
		let visibility = yield* decodeVisibilitySnapshotSteps(
			target.visibility,
			true,
		)
		let atoms = yield* decodeCheckpointArray(target.atoms, decodeCheckpointAtom)
		let fields = yield* decodeCheckpointArray(target.fields, parseOperation)
		targets.push({ ...target, atoms, fields, visibility })
	}
	return { ...header, restored, targets }
}
function* decodeCompactCheckpointSteps(
	value: unknown,
): Generator<void, typeof CompactCheckpointSchema.Type> {
	let header = Schema.decodeUnknownSync(CompactHeaderSchema)(value)
	let restored = yield* decodeCheckpointArray(
		header.restored,
		decodeRestoredIdentity,
	)
	let targets: (typeof CompactCheckpointSchema.Type.targets)[number][] = []
	for (let value of header.targets) {
		let target = Schema.decodeUnknownSync(CausalTargetHeaderSchema)(value)
		let visibility = yield* decodeVisibilitySnapshotSteps(
			target.visibility,
			true,
		)
		let atoms = yield* decodeCheckpointArray(target.atoms, decodeCompactAtom)
		let fields = yield* decodeCheckpointArray(target.fields, parseOperation)
		targets.push({ ...target, atoms, fields, visibility })
	}
	return { ...header, restored, targets }
}
function* expandCompactCheckpointSteps(
	value: typeof CompactCheckpointSchema.Type,
	cooperative: boolean,
): Generator<void, CausalReplicaCheckpoint> {
	let count = 0,
		work = 0
	for (let target of value.targets)
		for (let run of target.atoms)
			for (let _character of run.value) {
				count++
				if (cooperative && ++work % 512 === 0) yield
				if (count > maximumCompactAtoms)
					throw new Error("Checkpoint expansion exceeds its atom limit")
			}
	let targets: TargetCheckpoint[] = []
	for (let target of value.targets) {
		let atoms: Atom[] = []
		for (let run of target.atoms) {
			let characters = run.value
			let length = 0
			for (let _character of characters) {
				length++
				if (cooperative && ++work % 512 === 0) yield
			}
			let prefix = run.id.slice(0, -8)
			let offset = Number(run.id.slice(-8))
			if (offset + length > 100_000_000)
				throw new Error("Checkpoint insertion exceeds its atom identity range")
			let previous = run.after
			let index = 0
			for (let value of characters) {
				let id = prefix + String(offset + index).padStart(8, "0")
				atoms.push(
					index === 0
						? {
								...run,
								value,
								...(run.order ? { order: [...run.order] } : {}),
								...(run.observed ? { observed: [...run.observed] } : {}),
								...(run.deleted ? { deleted: [...run.deleted] } : {}),
							}
						: { id, after: previous, value },
				)
				previous = id
				index++
				if (cooperative && ++work % 512 === 0) yield
			}
		}
		targets.push({
			id: target.id,
			created: target.created,
			updated: target.updated,
			atoms,
			fields: target.fields.map(parseOperation),
			visibility: target.visibility,
		})
	}
	return {
		format: "alkalye-state-v2",
		clock: value.clock,
		restored: value.restored.map(([left, right]) => [left, right]),
		targets,
	}
}
export function parseCheckpoint(value: unknown): ReplicaCheckpoint {
	let steps = parseCheckpointSteps(value, false)
	let next = steps.next()
	while (!next.done) next = steps.next()
	return next.value
}
export function parseCheckpointEffect(value: unknown) {
	return cooperative("checkpoint.parse", () =>
		parseCheckpointSteps(value, true),
	)
}

function* parseCheckpointSteps(
	value: unknown,
	cooperative: boolean,
): Generator<void, ReplicaCheckpoint> {
	let work = 0
	let record = object(value)
	if (
		record.format !== "alkalye-state-v1" &&
		record.format !== "alkalye-state-v2" &&
		record.format !== "alkalye-state-v3"
	)
		throw new Error("Unknown checkpoint format")
	let expanded =
		record.format === "alkalye-state-v3"
			? yield* expandCompactCheckpointSteps(
					cooperative
						? yield* decodeCompactCheckpointSteps(value)
						: Schema.decodeUnknownSync(CompactCheckpointSchema)(value),
					cooperative,
				)
			: undefined
	let decoded =
		expanded ??
		(record.format === "alkalye-state-v1"
			? cooperative
				? yield* decodeLegacyCheckpointSteps(value)
				: Schema.decodeUnknownSync(LegacyCheckpointSchema)(value)
			: cooperative
				? yield* decodeCausalCheckpointSteps(value)
				: Schema.decodeUnknownSync(CausalCheckpointSchema)(value))
	let targets = new Set<string>(),
		owners = new Map<string, string>()
	let operations = new Map<string, { target: string; kind: string }>()
	function claim(operation: string, target: string, kind: string) {
		let previous = operations.get(operation)
		if (
			previous &&
			(previous.target !== target || previous.kind !== kind || kind === "set")
		)
			throw new Error("Checkpoint operation identity is ambiguous")
		if (previous) return
		operations.set(operation, { target, kind })
	}
	let snapshots: (LegacyTargetCheckpoint | TargetCheckpoint)[] = []
	let targetIndex = 0
	for (let target of decoded.targets) {
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
		let expandedTarget = expanded?.targets[targetIndex++]
		let atoms = expandedTarget?.atoms ?? []
		if (!expandedTarget)
			for (let atom of target.atoms) {
				atoms.push(cooperative ? atom : copyCheckpointAtom(atom))
				if (cooperative && ++work % 512 === 0) yield
			}
		let indexed = new Map<string, Atom>()
		for (let atom of atoms) {
			if (cooperative && ++work % 512 === 0) yield
			indexed.set(atom.id, atom)
			if (cooperative && ++work % 512 === 0) yield
		}
		for (let atom of atoms) {
			if (cooperative && ++work % 512 === 0) yield
			if (owners.has(atom.id) || atom.id === atom.after)
				throw new Error("Invalid checkpoint atom identity")
			owners.set(atom.id, id)
			claim(atom.id.slice(0, -9), id, "text")
			if (atom.after && !indexed.has(atom.after))
				throw new Error("Checkpoint anchor belongs to no atom in this target")
			if (Number(atom.id.slice(0, 16)) > decoded.clock)
				throw new Error("Checkpoint clock precedes an insertion")
		}
		let complete = new Set<string>()
		for (let atom of atoms) {
			if (cooperative && ++work % 512 === 0) yield
			if (complete.has(atom.id)) continue
			let path = new Set<string>(),
				next = atom.id
			while (next && !complete.has(next)) {
				if (path.has(next)) throw new Error("Checkpoint anchor cycle")
				path.add(next)
				if (cooperative && ++work % 512 === 0) yield
				next = indexed.get(next)?.after ?? ""
			}
			for (let id of path) {
				complete.add(id)
				if (cooperative && ++work % 512 === 0) yield
			}
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
			snapshots.push({ ...common, removed: [...target.removed] })
			continue
		}
		let visibility = copyVisibility(target.visibility)
		let known = new Set<string>()
		for (let atom of atoms) {
			known.add(atom.id.slice(0, -9))
			if (cooperative && ++work % 512 === 0) yield
		}
		let removers = new Set<string>(),
			cancels = new Set<string>()
		for (let [id, runs] of visibility.removals) {
			if (removers.has(id))
				throw new Error("Duplicate checkpoint removal identity")
			removers.add(id)
			claim(id, common.id, "text")
			known.add(id)
			for (let atom of deletionIds(runs)) {
				if (!indexed.has(atom)) throw new Error("Unknown checkpoint deletion")
				if (cooperative && ++work % 512 === 0) yield
			}
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
		for (let atom of deletionIds(visibility.legacyRemoved)) {
			if (!indexed.has(atom))
				throw new Error("Unknown legacy checkpoint deletion")
			if (cooperative && ++work % 512 === 0) yield
		}
		for (let [id, original] of visibility.cancels) {
			if (
				!known.has(original) ||
				Number(original.slice(0, 16)) >= Number(id.slice(0, 16))
			)
				throw new Error("Invalid checkpoint cancellation target")
			if (Number(original.slice(0, 16)) <= visibility.floor)
				throw new Error("Checkpoint cancellation crosses its migration floor")
		}
		snapshots.push({ ...common, visibility })
	}
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
		if (owners.get(previous) !== owners.get(current))
			throw new Error("Restored atom identities belong to different targets")
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
