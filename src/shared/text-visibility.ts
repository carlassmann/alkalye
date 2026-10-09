import * as Schema from "effect/Schema"
import { copyMapSteps, copySetSteps, finishSteps } from "./collection-copy"

import {
	TextOperationIdSchema,
	TextAtomIdSchema,
	DeletionRunSchema,
	compactDeletionSteps,
	deletionIds,
} from "./model"

let OperationId = TextOperationIdSchema
let AtomId = TextAtomIdSchema
let decodeAtomIdentity = Schema.decodeUnknownSync(AtomId)
let RemovalAtomSchema = Schema.Union([
	AtomId,
	Schema.Struct({ ...DeletionRunSchema.fields, id: AtomId }).check(
		Schema.makeFilter(
			run =>
				Number(run.id.slice(-8)) + run.count <= 100_000_000 ||
				"Deletion run exceeds its atom identity range",
		),
	),
])
let RemovalSchema = Schema.Tuple([
	OperationId,
	Schema.NonEmptyArray(RemovalAtomSchema),
])
let CancellationSchema = Schema.Tuple([OperationId, OperationId])
let LegacySchema = Schema.Struct({
	removed: Schema.Array(AtomId),
	clock: Schema.Natural.check(
		Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
	),
}).check(
	Schema.makeFilter(
		state =>
			state.removed.every(atom => clock(atom) <= state.clock) ||
			"Legacy atom owner exceeds the migration floor",
	),
)
let VisibilityFactSchema = Schema.Union([
	Schema.Struct({
		kind: Schema.Literal("remove"),
		id: OperationId,
		atoms: Schema.NonEmptyArray(AtomId),
	}),
	Schema.Struct({
		kind: Schema.Literal("cancel"),
		id: OperationId,
		target: OperationId,
	}),
])
export type VisibilityFact = typeof VisibilityFactSchema.Type
export let VisibilitySnapshotSchema = Schema.Struct({
	legacyRemoved: Schema.Array(RemovalAtomSchema),
	floor: LegacySchema.fields.clock,
	removals: Schema.Array(RemovalSchema),
	cancels: Schema.Array(CancellationSchema),
}).check(
	Schema.makeFilter(state =>
		finishSteps(validateVisibilitySnapshotSteps(state, false)),
	),
)

export type TextVisibilitySnapshot = typeof VisibilitySnapshotSchema.Type

export class TextVisibility {
	private removals = new Map<string, readonly string[]>()
	private removers = new Map<string, ReadonlySet<string>>()
	private cancels = new Map<string, string>()
	private cancellers = new Map<string, ReadonlySet<string>>()
	private activeCache = new Map<string, boolean>()
	private lastActiveOperation: string | undefined
	private legacyRemoved: Set<string>
	private floor: number
	private generation = 0
	constructor(legacy: typeof LegacySchema.Type = { removed: [], clock: 0 }) {
		let state = Schema.decodeUnknownSync(LegacySchema)(legacy)
		this.legacyRemoved = new Set(state.removed)
		this.floor = state.clock
	}
	fork() {
		return finishSteps(this.forkSteps(false))
	}
	*forkSteps(cooperative: boolean) {
		let visibility = new TextVisibility()
		visibility.removals = yield* copyMapSteps(this.removals, cooperative)
		visibility.removers = yield* copyMapSteps(this.removers, cooperative)
		visibility.cancels = yield* copyMapSteps(this.cancels, cooperative)
		visibility.cancellers = yield* copyMapSteps(this.cancellers, cooperative)
		visibility.activeCache = yield* copyMapSteps(this.activeCache, cooperative)
		visibility.lastActiveOperation = this.lastActiveOperation
		visibility.legacyRemoved = yield* copySetSteps(
			this.legacyRemoved,
			cooperative,
		)
		visibility.floor = this.floor
		return visibility
	}
	remove(operation: string, atoms: readonly string[]) {
		let [first, ...rest] = atoms
		if (first === undefined) return
		this.apply([{ kind: "remove", id: operation, atoms: [first, ...rest] }])
	}
	cancel(operation: string, target: string) {
		this.apply([{ kind: "cancel", id: operation, target }])
	}
	apply(input: readonly VisibilityFact[]) {
		this.prepare(input)()
	}
	validate(input: readonly VisibilityFact[]) {
		this.prepare(input)
	}
	// Prepared facts can only publish once against the state they validated.
	prepare(input: readonly VisibilityFact[]) {
		let generation = this.generation
		let committed = false
		let commit = finishSteps(this.prepareSteps(input, false))
		return () => {
			if (committed || generation !== this.generation)
				throw new Error("Prepared visibility changes are stale")
			committed = true
			finishSteps(commit)
		}
	}
	private *prepareSteps(
		input: readonly VisibilityFact[],
		cooperative: boolean,
	): Generator<void, Generator<void>> {
		let work = 0
		let removals = new Map<string, readonly string[]>()
		let legacyRemoved = new Set<string>()
		let cancels = new Map<string, string>()
		for (let value of input) {
			let fact = yield* visibilityFactSteps(value, cooperative)
			if (fact.kind === "remove") {
				let atoms = yield* sortedIdentitySteps(fact.atoms, cooperative)
				let previous = removals.get(fact.id) ?? this.removals.get(fact.id)
				if (
					cancels.has(fact.id) ||
					this.cancels.has(fact.id) ||
					(previous &&
						!(yield* equalIdentitySteps(previous, atoms, cooperative)))
				)
					throw new Error("Removal identity is immutable")
				if (clock(fact.id) <= this.floor)
					for (let atom of atoms) {
						legacyRemoved.add(atom)
						if (cooperative && ++work % 512 === 0) yield
					}
				else removals.set(fact.id, atoms)
			} else {
				if (clock(fact.id) <= clock(fact.target))
					throw new Error("Cancellation clock must exceed its target")
				if (clock(fact.target) <= this.floor)
					throw new Error(
						"Text undo below the migration floor lacks deletion provenance",
					)
				let previous = cancels.get(fact.id) ?? this.cancels.get(fact.id)
				if (
					removals.has(fact.id) ||
					this.removals.has(fact.id) ||
					(previous && previous !== fact.target)
				)
					throw new Error("Cancellation identity is immutable")
				cancels.set(fact.id, fact.target)
			}
		}
		let visibility = this
		return commit()
		function* commit(): Generator<void> {
			visibility.generation++
			for (let atom of legacyRemoved) {
				visibility.legacyRemoved.add(atom)
				if (cooperative && ++work % 512 === 0) yield
			}
			for (let [id, atoms] of removals) {
				if (visibility.removals.has(id)) continue
				visibility.removals.set(id, atoms)
				for (let atom of atoms) {
					let removers = new Set(visibility.removers.get(atom))
					removers.add(id)
					visibility.removers.set(atom, removers)
					if (cooperative && ++work % 512 === 0) yield
				}
			}
			for (let [id, target] of cancels) {
				if (visibility.cancels.has(id)) continue
				visibility.cancels.set(id, target)
				let cancellers = new Set(visibility.cancellers.get(target))
				cancellers.add(id)
				visibility.cancellers.set(target, cancellers)
				visibility.activeCache.clear()
				visibility.lastActiveOperation = undefined
			}
		}
	}

	matchesRemoval(operation: string, atoms: readonly string[]) {
		return (
			JSON.stringify(this.removals.get(operation) ?? []) ===
			JSON.stringify([...new Set(atoms)].sort())
		)
	}
	known(operation: string) {
		return this.removals.has(operation) || this.cancels.has(operation)
	}
	hasCancellations() {
		return this.cancels.size > 0
	}
	isCancellation(operation: string) {
		return this.cancels.has(operation)
	}
	get migrationFloor() {
		return this.floor
	}
	canUndo(operation: string) {
		Schema.decodeUnknownSync(OperationId)(operation)
		return clock(operation) > this.floor
	}
	active(operation: string) {
		if (
			this.lastActiveOperation !== undefined &&
			this.lastActiveOperation === operation
		)
			return true
		let cached = this.activeCache.get(operation)
		if (cached !== undefined) return cached
		if (clock(operation) <= this.floor || !this.cancellers.has(operation)) {
			if (typeof operation === "string") this.lastActiveOperation = operation
			return true
		}
		let stack = [this.node(operation)]
		while (stack.length) {
			let node = stack.at(-1)
			if (!node) break
			if (this.activeCache.has(node.id)) {
				stack.pop()
				continue
			}
			let child = node.children[node.next]
			if (!child) {
				this.activeCache.set(node.id, true)
				stack.pop()
				continue
			}
			let active = this.activeCache.get(child)
			if (active === true) {
				this.activeCache.set(node.id, false)
				stack.pop()
			} else if (active === false) node.next++
			else stack.push(this.node(child))
		}
		return this.activeCache.get(operation) ?? true
	}
	hidden(atom: string) {
		if (this.legacyRemoved.has(atom)) return true
		if (!this.active(atom.slice(0, -9))) return true
		for (let remover of this.removers.get(atom) ?? [])
			if (this.active(remover)) return true
		return false
	}
	checkpoint() {
		return finishSteps(this.checkpointSteps(false))
	}
	*checkpointSteps(
		cooperative: boolean,
	): Generator<void, TextVisibilitySnapshot> {
		let legacy = yield* sortedIdentitySteps(this.legacyRemoved, cooperative)
		let legacyRemoved = yield* compactDeletionSteps(legacy, cooperative)
		let removals: [
			string,
			[
				string | typeof DeletionRunSchema.Type,
				...(string | typeof DeletionRunSchema.Type)[],
			],
		][] = []
		let entries = 0
		for (let id of yield* sortedIdentitySteps(
			this.removals.keys(),
			cooperative,
		)) {
			let atoms = this.removals.get(id) ?? []
			let runs = yield* compactDeletionSteps(atoms, cooperative)
			let first = runs[0]
			if (!first) throw new Error("Empty removal provenance")
			removals.push([id, [first, ...runs.slice(1)]])
			if (cooperative && ++entries % 128 === 0) yield
		}
		let cancels: [string, string][] = []
		for (let id of yield* sortedIdentitySteps(
			this.cancels.keys(),
			cooperative,
		)) {
			let original = this.cancels.get(id)
			if (original) cancels.push([id, original])
			if (cooperative && ++entries % 128 === 0) yield
		}
		return yield* decodeVisibilitySnapshotSteps(
			{
				legacyRemoved,
				floor: this.floor,
				removals,
				cancels,
			},
			cooperative,
		)
	}
	restore(input: unknown) {
		finishSteps(this.restoreSteps(input, false))
	}
	*restoreSteps(input: unknown, cooperative: boolean): Generator<void> {
		let snapshot = yield* decodeVisibilitySnapshotSteps(input, cooperative)
		if (snapshot.floor > this.floor && this.hasCancellations())
			throw new Error("An accepted cancellation fixes the migration floor")
		let next = new TextVisibility()
		next.floor = Math.max(this.floor, snapshot.floor)
		next.legacyRemoved = yield* copySetSteps(this.legacyRemoved, cooperative)
		let work = 0
		for (let atom of deletionIds(snapshot.legacyRemoved)) {
			if (clock(atom) > next.floor)
				throw new Error("Legacy atom owner exceeds the migration floor")
			next.legacyRemoved.add(atom)
			if (cooperative && ++work % 512 === 0) yield
		}
		let removals = new Set<string>(),
			cancels = new Set<string>()
		for (let [id] of snapshot.removals) {
			if (removals.has(id)) throw new Error("Duplicate visibility identity")
			removals.add(id)
			if (cooperative && ++work % 128 === 0) yield
		}
		for (let [id] of snapshot.cancels) {
			if (cancels.has(id)) throw new Error("Duplicate visibility identity")
			cancels.add(id)
			if (cooperative && ++work % 128 === 0) yield
		}
		for (let [id, atoms] of this.removals) {
			yield* next.removeSteps(id, atoms, cooperative)
			if (cooperative && ++work % 128 === 0) yield
		}
		for (let [id, target] of this.cancels) {
			next.cancel(id, target)
			if (cooperative && ++work % 128 === 0) yield
		}
		for (let [id, runs] of snapshot.removals) {
			yield* next.removeSteps(id, deletionIds(runs), cooperative)
			if (cooperative && ++work % 128 === 0) yield
		}
		for (let [id, target] of snapshot.cancels) {
			next.cancel(id, target)
			if (cooperative && ++work % 128 === 0) yield
		}
		this.generation++
		this.removals = next.removals
		this.removers = next.removers
		this.cancels = next.cancels
		this.cancellers = next.cancellers
		this.legacyRemoved = next.legacyRemoved
		this.floor = next.floor
		this.activeCache.clear()
		this.lastActiveOperation = undefined
	}
	private *removeSteps(
		operation: string,
		values: Iterable<string>,
		cooperative: boolean,
	): Generator<void> {
		let atoms: string[] = []
		for (let atom of values) {
			atoms.push(atom)
			if (cooperative && atoms.length % 512 === 0) yield
		}
		let first = atoms[0]
		if (first === undefined) return
		let commit = yield* this.prepareSteps(
			[{ kind: "remove", id: operation, atoms: [first, ...atoms.slice(1)] }],
			cooperative,
		)
		yield* commit
	}

	private node(id: string) {
		return { id, children: [...(this.cancellers.get(id) ?? [])], next: 0 }
	}
}
function clock(id: string) {
	return Number(id.slice(0, 16))
}

let RemovalFactHeaderSchema = Schema.Struct({
	kind: Schema.Literal("remove"),
	id: OperationId,
	atoms: Schema.NonEmptyArray(Schema.Unknown),
})
function* visibilityFactSteps(
	value: VisibilityFact,
	cooperative: boolean,
): Generator<void, VisibilityFact> {
	if (!cooperative || value.kind !== "remove")
		return Schema.decodeUnknownSync(VisibilityFactSchema)(value)
	let header = Schema.decodeUnknownSync(RemovalFactHeaderSchema)(value)
	let atoms: string[] = []
	for (let value of header.atoms) {
		atoms.push(decodeAtomIdentity(value))
		if (atoms.length % 512 === 0) yield
	}
	let first = atoms[0]
	if (!first) throw new Error("Empty removal provenance")
	return { ...header, atoms: [first, ...atoms.slice(1)] }
}
function* sortedIdentitySteps(
	values: Iterable<string>,
	cooperative: boolean,
): Generator<void, string[]> {
	if (!cooperative) return [...new Set(values)].sort()
	let atoms: string[] = [],
		ordered = true
	for (let atom of values) {
		let previous = atoms.at(-1)
		if (previous && previous > atom) ordered = false
		if (atom !== previous) atoms.push(atom)
		if (atoms.length % 512 === 0) yield
	}
	if (ordered) return atoms
	let chunks: string[][] = []
	for (let offset = 0; offset < atoms.length; offset += 512) {
		chunks.push([...new Set(atoms.slice(offset, offset + 512).sort())])
		yield
	}
	let work = 0
	while (chunks.length > 1) {
		let merged: string[][] = []
		for (let index = 0; index < chunks.length; index += 2) {
			let left = chunks[index] ?? [],
				right = chunks[index + 1] ?? []
			let output: string[] = [],
				a = 0,
				b = 0
			while (a < left.length || b < right.length) {
				let first = left[a],
					second = right[b]
				let atom: string | undefined
				if (second === undefined || (first !== undefined && first <= second)) {
					atom = first
					a++
				} else {
					atom = second
					b++
				}
				if (atom !== undefined && output.at(-1) !== atom) output.push(atom)
				if (++work % 512 === 0) yield
			}
			merged.push(output)
		}
		chunks = merged
	}
	return chunks[0] ?? []
}
function* equalIdentitySteps(
	first: readonly string[],
	second: readonly string[],
	cooperative: boolean,
): Generator<void, boolean> {
	if (first.length !== second.length) return false
	for (let index = 0; index < first.length; index++) {
		if (first[index] !== second[index]) return false
		if (cooperative && index % 512 === 0) yield
	}
	return true
}

let VisibilityHeaderSchema = Schema.Struct({
	legacyRemoved: Schema.Array(Schema.Unknown),
	floor: LegacySchema.fields.clock,
	removals: Schema.Array(Schema.Unknown),
	cancels: Schema.Array(Schema.Unknown),
})
let RemovalHeaderSchema = Schema.Tuple([
	OperationId,
	Schema.NonEmptyArray(Schema.Unknown),
])
export function* decodeVisibilitySnapshotSteps(
	input: unknown,
	cooperative: boolean,
): Generator<void, TextVisibilitySnapshot> {
	if (!cooperative)
		return Schema.decodeUnknownSync(VisibilitySnapshotSchema)(input)
	let header = Schema.decodeUnknownSync(VisibilityHeaderSchema)(input)
	let legacyRemoved = yield* decodeRemovalRuns(header.legacyRemoved)
	let removals: [
		string,
		[typeof RemovalAtomSchema.Type, ...(typeof RemovalAtomSchema.Type)[]],
	][] = []
	for (let value of header.removals) {
		let [id, input] = Schema.decodeUnknownSync(RemovalHeaderSchema)(value)
		let runs = yield* decodeRemovalRuns(input)
		let first = runs[0]
		if (!first) throw new Error("Empty removal provenance")
		removals.push([id, [first, ...runs.slice(1)]])
		if (removals.length % 128 === 0) yield
	}
	let cancels: [string, string][] = []
	for (let value of header.cancels) {
		let [id, target] = Schema.decodeUnknownSync(CancellationSchema)(value)
		cancels.push([id, target])
		if (cancels.length % 128 === 0) yield
	}
	let snapshot = { floor: header.floor, legacyRemoved, removals, cancels }
	let valid = yield* validateVisibilitySnapshotSteps(snapshot, true)
	if (valid !== true) throw new Error(valid)
	return snapshot
}
let decodeRemovalAtom = Schema.decodeUnknownSync(RemovalAtomSchema)
function* decodeRemovalRuns(
	values: readonly unknown[],
): Generator<void, (typeof RemovalAtomSchema.Type)[]> {
	let runs: (typeof RemovalAtomSchema.Type)[] = []
	for (let value of values) {
		let run = decodeRemovalAtom(value)
		runs.push(typeof run === "string" ? run : { ...run })
		if (runs.length % 128 === 0) yield
	}
	return runs
}
function* validateVisibilitySnapshotSteps(
	state: TextVisibilitySnapshot,
	cooperative: boolean,
): Generator<void, true | string> {
	let count = 0,
		work = 0
	for (let run of state.legacyRemoved) {
		count += typeof run === "string" ? 1 : run.count
		if (cooperative && ++work % 512 === 0) yield
	}
	for (let [, runs] of state.removals)
		for (let run of runs) {
			count += typeof run === "string" ? 1 : run.count
			if (cooperative && ++work % 512 === 0) yield
		}
	if (count > 4_000_000)
		return "Checkpoint deletion provenance exceeds four million identities"
	for (let run of state.legacyRemoved) {
		if (clock(typeof run === "string" ? run : run.id) > state.floor)
			return "Legacy atom owner exceeds the migration floor"
		if (cooperative && ++work % 512 === 0) yield
	}
	return true
}
