import * as Chunk from "effect/Chunk"
import * as HashMap from "effect/HashMap"
import * as Option from "effect/Option"

export class ForkableIndex<V> implements Iterable<[string, V]> {
	private mutable: Map<string, V> | undefined
	private base: ReadonlyMap<string, V>
	private updates = HashMap.empty<string, V>()
	private additions = Chunk.empty<string>()
	private replacesBase = false
	constructor() {
		let initial = new Map<string, V>()
		this.mutable = initial
		this.base = initial
	}
	get size() {
		return this.base.size + Chunk.size(this.additions)
	}
	get(key: string): V | undefined {
		if (!this.replacesBase) {
			let value = this.base.get(key)
			if (value !== undefined || this.base.has(key)) return value
		}
		if (HashMap.size(this.updates)) {
			let updated = HashMap.get(this.updates, key)
			if (Option.isSome(updated)) return updated.value
		}
		return this.base.get(key)
	}
	has(key: string) {
		return this.base.has(key) || HashMap.has(this.updates, key)
	}
	set(key: string, value: V) {
		if (this.mutable) {
			this.mutable.set(key, value)
			return this
		}
		let inBase = this.base.has(key)
		if (!inBase && !HashMap.has(this.updates, key))
			this.additions = Chunk.append(this.additions, key)
		if (inBase) this.replacesBase = true
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
		copied.replacesBase = this.replacesBase
		return copied
	}
	*entries(): Generator<[string, V], void, void> {
		if (!this.replacesBase) yield* this.base
		else
			for (let [key, value] of this.base) {
				let updated = HashMap.get(this.updates, key)
				yield [key, Option.isSome(updated) ? updated.value : value]
			}
		for (let key of this.additions)
			yield [key, HashMap.getUnsafe(this.updates, key)]
	}
	*values() {
		for (let [, value] of this.entries()) yield value
	}
	[Symbol.iterator]() {
		return this.entries()
	}
}
