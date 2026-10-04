import * as Schema from "effect/Schema"

let OperationId = Schema.String.check(
	Schema.isPattern(/^\d{16}:[\w-]{1,100}$/),
	Schema.makeFilter(value => validClock(value) || "Invalid contribution clock"),
)
let AtomId = Schema.String.check(
	Schema.isPattern(/^\d{16}:[\w-]{1,100}:\d{8}$/),
	Schema.makeFilter(value => validClock(value) || "Invalid atom owner clock"),
)
let RemovalSchema = Schema.Tuple([OperationId, Schema.NonEmptyArray(AtomId)])
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
type VisibilityFact = typeof VisibilityFactSchema.Type
export let VisibilitySnapshotSchema = Schema.Struct({
	format: Schema.Literal("text-visibility-experiment-v2"),
	legacyRemoved: Schema.Array(AtomId),
	floor: LegacySchema.fields.clock,
	removals: Schema.Array(RemovalSchema),
	cancels: Schema.Array(CancellationSchema),
}).check(
	Schema.makeFilter(
		state =>
			state.legacyRemoved.every(atom => clock(atom) <= state.floor) ||
			"Legacy atom owner exceeds the migration floor",
	),
)

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
		let removals = new Map<string, readonly string[]>()
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
				removals.set(fact.id, atoms)
			} else {
				if (clock(fact.id) <= clock(fact.target))
					throw new Error("Cancellation clock must exceed its target")
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
			format: "text-visibility-experiment-v2",
			legacyRemoved: [...this.legacyRemoved].sort(),
			floor: this.floor,
			removals: [...this.removals]
				.sort(byIdentity)
				.map(([id, atoms]) => [id, [...atoms]]),
			cancels: [...this.cancels].sort(byIdentity),
		})
	}
	restore(input: unknown) {
		let snapshot = Schema.decodeUnknownSync(VisibilitySnapshotSchema)(input)
		let next = new TextVisibility({
			removed: [...this.legacyRemoved, ...snapshot.legacyRemoved],
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
		for (let [id, atoms] of snapshot.removals) next.remove(id, atoms)
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
	return Number(id.split(":")[0])
}
function validClock(id: string) {
	let value = clock(id)
	return Number.isSafeInteger(value) && value >= 1
}
function byIdentity(
	left: readonly [string, unknown],
	right: readonly [string, unknown],
) {
	return left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0
}
