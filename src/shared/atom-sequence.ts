import * as Chunk from "effect/Chunk"
import type { Atom } from "./model"

let sequences = new WeakMap<Atom[], Chunk.Chunk<Atom>>()
let views = new WeakMap<Atom[], Atom[]>()

export function immutableAtoms(atoms: Atom[]) {
	if (sequences.has(atoms)) return atoms
	let cached = views.get(atoms)
	if (cached) return cached
	let view = atomView(Chunk.fromIterable(atoms))
	views.set(atoms, view)
	return view
}

export function replaceAtoms(
	atoms: Atom[],
	replacements: { start: number; remove: number; inserted: Atom[] }[],
) {
	let sequence = sequences.get(atoms) ?? Chunk.fromIterable(atoms)
	for (let change of [...replacements].reverse()) {
		sequence = Chunk.appendAll(
			Chunk.appendAll(
				Chunk.take(sequence, change.start),
				Chunk.fromIterable(change.inserted),
			),
			Chunk.drop(sequence, change.start + change.remove),
		)
	}
	return atomView(sequence)
}

function atomView(sequence: Chunk.Chunk<Atom>): Atom[] {
	function index(property: string | symbol) {
		if (typeof property !== "string" || !/^(0|[1-9]\d*)$/.test(property))
			return undefined
		let value = Number(property)
		return Number.isSafeInteger(value) ? value : undefined
	}
	let target: Atom[] = []
	let view = new Proxy(target, {
		get(target, property, receiver) {
			if (property === "length") return sequence.length
			if (property === Symbol.iterator) return () => sequence[Symbol.iterator]()
			let position = index(property)
			if (position !== undefined)
				return position < sequence.length
					? Chunk.getUnsafe(sequence, position)
					: undefined
			return Reflect.get(target, property, receiver)
		},
		has(target, property) {
			let position = index(property)
			return position === undefined
				? Reflect.has(target, property)
				: position < sequence.length
		},
		getOwnPropertyDescriptor(target, property) {
			if (property === "length")
				return {
					value: sequence.length,
					writable: true,
					enumerable: false,
					configurable: false,
				}
			let position = index(property)
			if (position !== undefined && position < sequence.length)
				return {
					value: Chunk.getUnsafe(sequence, position),
					writable: false,
					enumerable: true,
					configurable: true,
				}
			return Reflect.getOwnPropertyDescriptor(target, property)
		},
		ownKeys() {
			let keys = Array.from({ length: sequence.length }, (_, position) =>
				String(position),
			)
			keys.push("length")
			return keys
		},
		set() {
			return false
		},
		deleteProperty() {
			return false
		},
		defineProperty() {
			return false
		},
		setPrototypeOf() {
			return false
		},
		preventExtensions() {
			return false
		},
	})
	sequences.set(view, sequence)
	return view
}
