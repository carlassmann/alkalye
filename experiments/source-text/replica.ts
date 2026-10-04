import * as Schema from "effect/Schema"
import { textSplices } from "../../src/shared/text-splices"

let SlotSchema = Schema.Struct({
	name: Schema.String,
	supersedes: Schema.Array(Schema.String),
})
let CharacterSchema = Schema.Struct({
	id: Schema.String,
	after: Schema.String,
	value: Schema.String,
})
export let SourceChangeSchema = Schema.Struct({
	id: Schema.String,
	clock: Schema.Int,
	insert: Schema.Array(CharacterSchema),
	remove: Schema.Array(Schema.String),
	slot: Schema.optional(SlotSchema),
	activity: Schema.optional(
		Schema.Struct({ operation: Schema.String, enabled: Schema.Boolean }),
	),
})
export let SourceSnapshotSchema = Schema.Struct({
	clock: Schema.Int,
	atoms: Schema.Array(CharacterSchema),
	removals: Schema.Array(
		Schema.Struct({ atom: Schema.String, operation: Schema.String }),
	),
	slots: Schema.Array(
		Schema.Struct({
			id: Schema.String,
			name: Schema.String,
			supersedes: Schema.Array(Schema.String),
		}),
	),
	activities: Schema.Array(
		Schema.Struct({
			operation: Schema.String,
			id: Schema.String,
			enabled: Schema.Boolean,
		}),
	),
})
export type SourceChange = typeof SourceChangeSchema.Type
type Character = typeof CharacterSchema.Type

export class SourceReplica {
	clock = 0
	private atoms = new Map<string, Character>()
	private children = new Map<string, Character[]>()
	private removals = new Map<string, Set<string>>()
	private slots = new Map<string, typeof SlotSchema.Type>()
	private activities = new Map<string, { id: string; enabled: boolean }>()
	constructor(public actor: string) {}
	apply(change: SourceChange) {
		let incoming = new Map<string, Character>()
		for (let atom of change.insert) {
			let previous = this.atoms.get(atom.id) ?? incoming.get(atom.id)
			if (
				previous &&
				(previous.after !== atom.after || previous.value !== atom.value)
			)
				throw new Error("Source atom identity is immutable")
			incoming.set(atom.id, atom)
		}
		this.clock = Math.max(this.clock, change.clock)
		for (let atom of change.insert) {
			if (this.atoms.has(atom.id)) continue
			atom = Object.freeze({ ...atom })
			this.atoms.set(atom.id, atom)
			let siblings = this.children.get(atom.after) ?? []
			siblings.push(atom)
			siblings.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
			this.children.set(atom.after, siblings)
		}
		for (let id of change.remove) {
			let removals = this.removals.get(id) ?? new Set<string>()
			removals.add(change.id)
			this.removals.set(id, removals)
		}
		if (change.slot)
			this.slots.set(change.id, {
				name: change.slot.name,
				supersedes: [...change.slot.supersedes],
			})
		if (change.activity) {
			let previous = this.activities.get(change.activity.operation)
			if (!previous || change.id > previous.id)
				this.activities.set(change.activity.operation, {
					id: change.id,
					enabled: change.activity.enabled,
				})
		}
	}
	edit(
		next: string,
		base = this.visible(),
		slot?: string,
	): SourceChange | null {
		let splices = textSplices(
			base.map(atom => atom.value),
			Array.from(next),
		)
		if (!splices.length) return null
		let clock = ++this.clock,
			id = String(clock).padStart(16, "0") + ":" + this.actor
		let insert: Character[] = [],
			remove: string[] = []
		for (let splice of splices) {
			remove.push(
				...base
					.slice(splice.start, splice.start + splice.remove)
					.map(atom => atom.id),
			)
			let anchor = base[splice.start - 1]?.id ?? ""
			for (let value of splice.insert) {
				let atom = {
					id: id + ":" + String(insert.length).padStart(8, "0"),
					after: anchor,
					value,
				}
				insert.push(atom)
				anchor = atom.id
			}
		}
		let previous = slot ? this.slotWinner(slot) : undefined
		let change = {
			id,
			clock,
			insert,
			remove,
			...(slot
				? { slot: { name: slot, supersedes: previous ? [previous] : [] } }
				: {}),
		}
		this.apply(change)
		return change
	}
	inverse(change: SourceChange): SourceChange {
		let clock = ++this.clock,
			id = String(clock).padStart(16, "0") + ":" + this.actor
		let activity = change.activity
			? {
					operation: change.activity.operation,
					enabled: !change.activity.enabled,
				}
			: { operation: change.id, enabled: false }
		let inverse = { id, clock, insert: [], remove: [], activity }
		this.apply(inverse)
		return inverse
	}
	visible() {
		let kept = this.keptSlots()
		let enabled = (operation: string) =>
			this.slots.has(operation) ? kept.has(operation) : this.enabled(operation)
		let result: Character[] = [],
			stack = [...(this.children.get("") ?? [])].reverse()
		while (stack.length) {
			let atom = stack.pop()
			if (!atom) break
			if (
				enabled(atom.id.slice(0, -9)) &&
				![...(this.removals.get(atom.id) ?? [])].some(operation =>
					enabled(operation),
				)
			)
				result.push(atom)
			let children = this.children.get(atom.id) ?? []
			for (let index = children.length - 1; index >= 0; index--) {
				let child = children[index]
				if (child) stack.push(child)
			}
		}
		return result
	}
	text() {
		return this.visible()
			.map(atom => atom.value)
			.join("")
	}
	snapshot(): typeof SourceSnapshotSchema.Type {
		return {
			clock: this.clock,
			atoms: [...this.atoms.values()].map(atom => ({ ...atom })),
			removals: [...this.removals].flatMap(([atom, operations]) =>
				[...operations].map(operation => ({ atom, operation })),
			),
			slots: [...this.slots].map(([id, slot]) => ({
				id,
				name: slot.name,
				supersedes: [...slot.supersedes],
			})),
			activities: [...this.activities].map(([operation, activity]) => ({
				operation,
				...activity,
			})),
		}
	}
	restore(snapshot: typeof SourceSnapshotSchema.Type) {
		this.apply({
			id: "snapshot",
			clock: snapshot.clock,
			insert: snapshot.atoms,
			remove: [],
		})
		for (let removal of snapshot.removals)
			this.apply({
				id: removal.operation,
				clock: snapshot.clock,
				insert: [],
				remove: [removal.atom],
			})
		for (let slot of snapshot.slots)
			this.apply({
				id: slot.id,
				clock: snapshot.clock,
				insert: [],
				remove: [],
				slot,
			})
		for (let activity of snapshot.activities)
			this.apply({
				id: activity.id,
				clock: snapshot.clock,
				insert: [],
				remove: [],
				activity,
			})
	}
	private slotWinner(name: string) {
		let candidates = [...this.slots].filter(
			([id, slot]) => slot.name === name && this.enabled(id),
		)
		let superseded = new Set(candidates.flatMap(([, slot]) => slot.supersedes))
		return candidates
			.filter(([id]) => !superseded.has(id))
			.map(([id]) => id)
			.sort()
			.at(-1)
	}
	private keptSlots() {
		let kept = new Set<string>()
		for (let name of new Set([...this.slots.values()].map(slot => slot.name))) {
			let winner = this.slotWinner(name)
			let pending = winner ? [winner] : []
			while (pending.length) {
				let id = pending.pop()
				if (!id || kept.has(id)) continue
				kept.add(id)
				pending.push(...(this.slots.get(id)?.supersedes ?? []))
			}
		}
		return kept
	}
	private enabled(operation: string) {
		return this.activities.get(operation)?.enabled ?? true
	}
}
