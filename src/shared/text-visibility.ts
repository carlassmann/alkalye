import * as Schema from "effect/Schema"

import {
	TextOperationIdSchema,
	TextAtomIdSchema,
	DeletionRunSchema,
	compactDeletions,
	expandDeletions,
} from "./model"

let OperationId = TextOperationIdSchema
let AtomId = TextAtomIdSchema
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
	Schema.makeFilter(state => {
		let count = 0
		for (let run of state.legacyRemoved)
			count += typeof run === "string" ? 1 : run.count
		for (let [, runs] of state.removals)
			for (let run of runs) count += typeof run === "string" ? 1 : run.count
		return (
			count <= 4_000_000 ||
			"Checkpoint deletion provenance exceeds four million identities"
		)
	}),
	Schema.makeFilter(
		state =>
			state.legacyRemoved.every(
				atom => clock(typeof atom === "string" ? atom : atom.id) <= state.floor,
			) || "Legacy atom owner exceeds the migration floor",
	),
)

export type TextVisibilitySnapshot = typeof VisibilitySnapshotSchema.Type

export class TextVisibility {
	private removals = new Map<string, readonly string[]>()
	private removers = new Map<string, Set<string>>()
	private cancels = new Map<string, string>()
	private cancellers = new Map<string, Set<string>>()
	private activeCache = new Map<string, boolean>()
	private legacyRemoved: Set<string>
	private floor: number
	constructor(legacy: typeof LegacySchema.Type = { removed: [], clock: 0 }) {
		let state = Schema.decodeUnknownSync(LegacySchema)(legacy)
		this.legacyRemoved = new Set(state.removed)
		this.floor = state.clock
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
	private prepare(input: readonly VisibilityFact[]) {
		let removals = new Map<string, readonly string[]>()
		let legacyRemoved = new Set<string>()
		let cancels = new Map<string, string>()
		for (let value of input) {
			let fact = Schema.decodeUnknownSync(VisibilityFactSchema)(value)
			if (fact.kind === "remove") {
				let atoms = [...new Set(fact.atoms)].sort()
				let previous = removals.get(fact.id) ?? this.removals.get(fact.id)
				if (
					cancels.has(fact.id) ||
					this.cancels.has(fact.id) ||
					(previous && JSON.stringify(previous) !== JSON.stringify(atoms))
				)
					throw new Error("Removal identity is immutable")
				if (clock(fact.id) <= this.floor)
					for (let atom of atoms) legacyRemoved.add(atom)
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
		return () => {
			for (let atom of legacyRemoved) this.legacyRemoved.add(atom)
			for (let [id, atoms] of removals) {
				if (this.removals.has(id)) continue
				this.removals.set(id, atoms)
				for (let atom of atoms) {
					let removers = this.removers.get(atom) ?? new Set<string>()
					removers.add(id)
					this.removers.set(atom, removers)
				}
			}
			for (let [id, target] of cancels) {
				if (this.cancels.has(id)) continue
				this.cancels.set(id, target)
				let cancellers = this.cancellers.get(target) ?? new Set<string>()
				cancellers.add(id)
				this.cancellers.set(target, cancellers)
				this.activeCache.clear()
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
		if (clock(operation) <= this.floor || !this.cancellers.has(operation))
			return true
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
		return Schema.decodeUnknownSync(VisibilitySnapshotSchema)({
			legacyRemoved: compactDeletions([...this.legacyRemoved].sort()),
			floor: this.floor,
			removals: [...this.removals]
				.sort(byIdentity)
				.map(([id, atoms]) => [id, compactDeletions(atoms)]),
			cancels: [...this.cancels].sort(byIdentity),
		})
	}
	restore(input: unknown) {
		let snapshot = Schema.decodeUnknownSync(VisibilitySnapshotSchema)(input)
		if (snapshot.floor > this.floor && this.hasCancellations())
			throw new Error("An accepted cancellation fixes the migration floor")
		let next = new TextVisibility({
			removed: [
				...this.legacyRemoved,
				...expandDeletions(snapshot.legacyRemoved),
			],
			clock: Math.max(this.floor, snapshot.floor),
		})
		if (
			new Set(snapshot.removals.map(([id]) => id)).size !==
				snapshot.removals.length ||
			new Set(snapshot.cancels.map(([id]) => id)).size !==
				snapshot.cancels.length
		)
			throw new Error("Duplicate visibility identity")
		for (let [id, atoms] of this.removals) next.remove(id, atoms)
		for (let [id, target] of this.cancels) next.cancel(id, target)
		for (let [id, atoms] of snapshot.removals)
			next.remove(id, expandDeletions(atoms))
		for (let [id, target] of snapshot.cancels) next.cancel(id, target)
		this.removals = next.removals
		this.removers = next.removers
		this.cancels = next.cancels
		this.cancellers = next.cancellers
		this.legacyRemoved = next.legacyRemoved
		this.floor = next.floor
		this.activeCache.clear()
	}
	private node(id: string) {
		return { id, children: [...(this.cancellers.get(id) ?? [])], next: 0 }
	}
}
function clock(id: string) {
	return Number(id.slice(0, 16))
}
function byIdentity(
	left: readonly [string, unknown],
	right: readonly [string, unknown],
) {
	return left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0
}
