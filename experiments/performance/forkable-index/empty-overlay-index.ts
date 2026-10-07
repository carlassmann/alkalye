import * as Chunk from "effect/Chunk"
import * as HashMap from "effect/HashMap"
import * as Option from "effect/Option"

export class ForkableIndex<V> implements Iterable<[string, V]> {
	private mutable: Map<string, V> | undefined
	private base: ReadonlyMap<string, V>
	private updates = HashMap.empty<string, V>()
	private additions = Chunk.empty<string>()
	private overrides = new Set<string>()
	constructor() {
		let initial = new Map<string, V>()
		this.mutable = initial
		this.base = initial
	}
	get size() {
		return this.base.size + Chunk.size(this.additions)
	}
	get(key: string): V | undefined {
		if (!HashMap.size(this.updates)) return this.base.get(key)
		if (this.overrides.has(key)) return HashMap.getUnsafe(this.updates, key)
		let value = this.base.get(key)
		if (value !== undefined || this.base.has(key)) return value
		let updated = HashMap.get(this.updates, key)
		return Option.isSome(updated) ? updated.value : undefined
	}
	has(key: string) {
		return (
			this.base.has(key) ||
			(HashMap.size(this.updates) > 0 && HashMap.has(this.updates, key))
		)
	}
	set(key: string, value: V) {
		if (this.mutable) {
			this.mutable.set(key, value)
			return this
		}
		let inBase = this.base.has(key)
		if (!inBase && !HashMap.has(this.updates, key))
			this.additions = Chunk.append(this.additions, key)
		if (inBase) this.overrides.add(key)
		this.updates = HashMap.set(this.updates, key, value)
		return this
	}
	fork() {
		this.mutable = undefined
		let copied = new ForkableIndex<V>()
		copied.mutable = undefined
		copied.base = this.base
		copied.updates = this.updates
		copied.additions = this.additions
		copied.overrides = new Set(this.overrides)
		return copied
	}
	entries(): IterableIterator<[string, V]> {
		return HashMap.size(this.updates)
			? this.updatedEntries()
			: this.base.entries()
	}
	private *updatedEntries(): Generator<[string, V], void, void> {
		for (let [key, value] of this.base)
			yield [
				key,
				this.overrides.has(key) ? HashMap.getUnsafe(this.updates, key) : value,
			]
		for (let key of this.additions)
			yield [key, HashMap.getUnsafe(this.updates, key)]
	}
	values(): IterableIterator<V> {
		return HashMap.size(this.updates)
			? this.updatedValues()
			: this.base.values()
	}
	private *updatedValues(): Generator<V, void, void> {
		for (let [key, value] of this.base)
			yield this.overrides.has(key)
				? HashMap.getUnsafe(this.updates, key)
				: value
		for (let key of this.additions) yield HashMap.getUnsafe(this.updates, key)
	}
	[Symbol.iterator]() {
		return this.entries()
	}
}
